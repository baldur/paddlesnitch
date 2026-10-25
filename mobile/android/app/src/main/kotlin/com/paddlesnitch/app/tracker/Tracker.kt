package com.paddlesnitch.app.tracker

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout

/** The paddlesnitch.com calls tracker setup and sync make, as the signed-in person. */
interface TrackerAccount {
    suspend fun myTrackerIds(): Set<String>
    /** POST /api/account/devices/link-bluetooth: HTTP status and the server's error code. */
    suspend fun linkBluetooth(deviceId: String, tokenHash: String, signature: String, model: String, firmware: String): Reply
    /** POST /api/account/devices/{id}/sessions: one piece of a recording. */
    suspend fun upload(about: TrackerAbout, rec: PendingRecording, part: Int, parts: Int, bytes: ByteArray, compressed: Boolean): Reply
    /** GET /api/account/devices/{id}/sessions?filename=: the pieces the server already has. */
    suspend fun staged(about: TrackerAbout, rec: PendingRecording): List<Int>
}

data class Reply(val status: Int, val error: String? = null, val receipt: String? = null)

enum class Ownership { Yours, Elsewhere, Unlinked }

fun ownership(a: TrackerAbout, mine: Set<String>) = when {
    a.id in mine -> Ownership.Yours
    a.linked -> Ownership.Elsewhere
    else -> Ownership.Unlinked
}

sealed interface LinkOutcome {
    data object Linked : LinkOutcome
    data class Refused(val message: String) : LinkOutcome
}

data class SyncProgress(val index: Int, val total: Int, val name: String, val part: Int, val parts: Int)
enum class FailReason { Unusable, Receipt, Failed }
data class SyncResult(val sent: Int, val failed: List<Pair<String, FailReason>>)

/** The protocol over one connection, ported from the website's lib/tracker-ble.ts. */
class Tracker(private val link: TrackerLink, private val waits: Waits = Waits()) {
    val name get() = link.name

    suspend fun about(): TrackerAbout? = parseAbout(link.read(Gatt.ABOUT))

    /**
     * Read the paired-only item until it answers. Android refuses the first
     * protected read while its pairing carries on in the background, and a
     * read sometimes never answers at all: each try has its own limit.
     */
    suspend fun waitUntilPaired(): Boolean {
        runCatching { link.startPairing() }
        val w = waits.pairing
        repeat(w.tries) { i ->
            try {
                if (isPairedReply(withTimeout(w.readTimeoutMs) { link.read(Gatt.PAIRED) })) return true
            } catch (e: CancellationException) {
                if (e !is kotlinx.coroutines.TimeoutCancellationException) throw e
            } catch (_: Exception) {
            }
            if (i < w.tries - 1) delay(w.delayMs)
        }
        return false
    }

    private suspend fun write(uuid: String, json: String) = link.write(uuid, json.encodeToByteArray())

    /**
     * Add the tracker to the signed-in account. The tracker makes a token and
     * keeps it; only its hash comes here, gets registered, and then the
     * tracker commits. The token never crosses Bluetooth.
     */
    suspend fun linkTo(account: TrackerAccount, about: TrackerAbout): LinkOutcome {
        write(Gatt.LINK, Command.linkBegin)
        val st = parseLinkStatus(link.read(Gatt.LINK))
        if (st == null || st.state != LinkState.Pending || st.tokenHash.isEmpty()) throw TrackerError.Unexpected("no hash")
        val r = account.linkBluetooth(st.id, st.tokenHash, st.sig, about.model, about.firmware)
        if (r.status !in 200..299) return LinkOutcome.Refused(Messages.linkError(r.status, r.error))
        write(Gatt.LINK, Command.linkCommit(st.tokenHash))
        if (parseLinkStatus(link.read(Gatt.LINK))?.state != LinkState.Committed) throw TrackerError.Unexpected("not committed")
        return LinkOutcome.Linked
    }

    /** Send WiFi details; the tracker tries them and keeps them only if it joins. Null = no answer in time. */
    suspend fun tryWifi(ssid: String, pass: String): WifiState? {
        write(Gatt.WIFI, Command.wifi(ssid, pass))
        repeat(waits.wifi.tries) {
            delay(waits.wifi.delayMs)
            val st = parseWifiState(link.read(Gatt.WIFI))
            if (st != null && st != WifiState.Trying && st != WifiState.Idle) return st
        }
        return null
    }

    private suspend fun status() = parseSyncStatus(link.read(Gatt.SYNC))

    private suspend fun waitFor(vararg want: SyncState): SyncStatus {
        repeat(waits.sync.tries) {
            val st = status()
            if (st?.state == SyncState.Busy) throw TrackerError.Recording()
            if (st != null && st.state in want) return st
            if (st?.state == SyncState.Error) throw TrackerError.Unexpected("tracker error")
            delay(waits.sync.delayMs)
        }
        throw TrackerError.NoAnswer()
    }

    private suspend fun payload(len: Int) =
        readPayload({ link.read(Gatt.DATA) }, { write(Gatt.DATA, Command.seek(it)) }, len)

    suspend fun pending(): List<PendingRecording> {
        write(Gatt.SYNC, Command.list)
        return parsePendingList(payload(waitFor(SyncState.Ready).len))
    }

    /**
     * Bring every waiting recording home: read each piece off the tracker,
     * upload it as the signed-in person, and hand the server's receipt back so
     * the tracker marks it sent. A sync that broke off carries on from the
     * pieces the server already has. One recording failing doesn't stop the rest.
     */
    suspend fun sync(account: TrackerAccount, about: TrackerAbout, onProgress: (SyncProgress) -> Unit = {}): SyncResult {
        val list = pending()
        var sent = 0
        val failed = mutableListOf<Pair<String, FailReason>>()
        list.forEachIndexed { i, rec ->
            try {
                val have = runCatching { account.staged(about, rec) }.getOrDefault(emptyList()).toSet()
                // Asking for piece 1 tells us how many there are; nothing crosses Bluetooth until it's read.
                write(Gatt.SYNC, Command.piece(rec.name, 1))
                var st = waitFor(SyncState.Ready)
                val parts = maxOf(1, st.parts)
                // The last piece always goes: its arrival is what makes the server put the file together.
                val todo = (1..parts).filter { it !in have || it == parts }
                var receipt: String? = null
                for (part in todo) {
                    if (part != 1) {
                        write(Gatt.SYNC, Command.piece(rec.name, part))
                        st = waitFor(SyncState.Ready)
                    }
                    onProgress(SyncProgress(i + 1, list.size, rec.name, part, parts))
                    val r = account.upload(about, rec, part, parts, payload(st.len), st.compressed)
                    if (r.status == 202) continue
                    if ((r.status == 201 || (r.status == 409 && r.error == "already_uploaded")) && r.receipt != null) {
                        receipt = r.receipt
                        break
                    }
                    failed += rec.name to if (r.status in setOf(400, 413, 422)) FailReason.Unusable else FailReason.Failed
                    break
                }
                if (receipt == null) return@forEachIndexed
                write(Gatt.SYNC, Command.done(rec.name, receipt))
                if (waitFor(SyncState.Marked, SyncState.BadReceipt).state == SyncState.Marked) sent++
                else failed += rec.name to FailReason.Receipt
            } catch (e: TrackerError.Recording) {
                throw e
            } catch (e: TrackerError.Gone) {
                throw e
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                failed += rec.name to FailReason.Failed
            }
        }
        return SyncResult(sent, failed)
    }
}
