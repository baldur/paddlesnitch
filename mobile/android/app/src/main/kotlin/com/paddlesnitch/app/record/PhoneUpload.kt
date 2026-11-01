package com.paddlesnitch.app.record

import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.Phone
import java.io.File
import java.security.MessageDigest

/** One answer to an upload: the status and the contract's `error` word (and `missing` for parts_missing). */
data class UploadReply(val code: Int, val error: String? = null, val missing: List<Int> = emptyList())

/**
 * What uploading a phone recording asks of the server (mobile/contract/README.md § Phone
 * recording): Api in the app, a fake in the tests. Network failures throw ApiFailure with
 * status 0; a refused sign-in throws SignedOut.
 */
interface PhoneAccount {
    /** POST /api/account/devices/phone: this install's phone on the signed-in account. */
    suspend fun addPhone(installId: String): Phone
    /** POST /api/account/devices/{deviceId}/sessions?filename=: a whole file, or piece [part] of [parts]. */
    suspend fun upload(deviceId: String, filename: String, bytes: ByteArray, part: Int? = null, parts: Int? = null, sha256: String? = null): UploadReply
    /** GET the same address: the pieces the server already holds from a broken upload. */
    suspend fun held(deviceId: String, filename: String): List<Int>
}

/**
 * Uploads one account's recordings from its folder (RecordingFiles.accountDir), as the
 * tracker does: the track first, then its motion file under the name `_imu.csv`, in 64 KB
 * pieces. What the server has is deleted from the phone; everything else stays. The state
 * between runs lives in the folder itself, so it goes with the account:
 *
 * - `phone`: this phone's deviceId on the account (asked again after every sign-in).
 * - `phone-off`: the phone was removed on Devices (empty) or couldn't be added (the server's
 *   words). Nothing uploads until the owner starts a recording or taps Upload now.
 * - `track_<stamp>.failed`: the server will never take this one; kept, never retried by itself.
 * - `track_<stamp>.nofix`: the track had no GPS fix, so it didn't become a paddle (until dismissed).
 */
class PhoneUploader(
    private val dir: File,
    private val account: PhoneAccount,
    private val installId: () -> String,
    /** The track being written now: never uploaded while it runs. */
    private val recording: () -> File? = { null },
    /** Called each time a file leaves the phone or a line changes. */
    private val changed: (sentTrack: Boolean) -> Unit = {},
) {
    /** Uploads what's waiting. True when there's nothing more to do for now; false to try again later (backoff). */
    suspend fun run(): Boolean {
        if (offFile(dir).exists()) return true
        val waiting = waiting(dir, recording())
        if (waiting.isEmpty()) return true
        val deviceId = deviceId() ?: return offFile(dir).exists()
        for (base in waiting) {
            // No network (Api's failure with no status): what's sent so far stays sent; the rest waits.
            val sent = try { uploadOne(deviceId, base) } catch (e: ApiFailure) { Sent.Retry }
            when (sent) {
                Sent.Removed -> {
                    offFile(dir).writeText("")
                    phoneFile(dir).delete()
                    changed(false)
                    return true
                }
                Sent.Retry -> return false
                else -> {}
            }
        }
        return true
    }

    /** The phone's id on the account, adding it if this sign-in hasn't yet; null when it couldn't be (see `phone-off`). */
    private suspend fun deviceId(): String? {
        phoneFile(dir).takeIf { it.exists() }?.readText()?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        return try {
            account.addPhone(installId()).deviceId.also { dir.mkdirs(); phoneFile(dir).writeText(it) }
        } catch (e: ApiFailure) {
            // 409 (ten phones) and 400 say why in their own words; anything else (a server
            // without the call yet, 5xx, no network) is tried again later.
            if (e.status == 400 || e.status == 409) { offFile(dir).writeText(if (e.generic) PHONE_NOT_ADDED else e.message.orEmpty()); changed(false) }
            null
        }
    }

    private suspend fun uploadOne(deviceId: String, base: String): Sent {
        val track = File(dir, "$base.csv")
        val motion = File(dir, "${base}_i10.csv")
        if (track.exists()) {
            when (val r = send(deviceId, track, "$base.csv")) {
                Sent.Ok -> { track.delete(); changed(true) }
                Sent.NoData -> {
                    // No GPS fix at all: the server keeps nothing, so neither does the phone.
                    track.delete(); motion.delete()
                    File(dir, "$base.nofix").writeText("")
                    changed(false)
                }
                Sent.Refused, Sent.TrackFirst -> return refused(base)
                else -> return r
            }
        }
        if (motion.exists()) {
            when (val r = send(deviceId, motion, "${base}_imu.csv")) {
                Sent.Ok, Sent.NoData -> { motion.delete(); changed(false) }
                // The track left this phone, so it can't be sent first: a dead end.
                Sent.Refused, Sent.TrackFirst -> return refused(base)
                else -> return r
            }
        }
        File(dir, "$base.log").delete()
        return Sent.Ok
    }

    private fun refused(base: String): Sent {
        File(dir, "$base.failed").writeText("")
        changed(false)
        return Sent.Refused
    }

    /** One file, whole or in pieces, read as the contract's table of answers says. */
    private suspend fun send(deviceId: String, file: File, name: String): Sent {
        val bytes = file.readBytes()
        var fresh = false
        repeat(2) {
            val r = if (bytes.size < PIECE) account.upload(deviceId, name, bytes) else pieces(deviceId, name, bytes, fresh)
            when {
                r.code in 200..299 || r.code == 409 && r.error == "already_uploaded" -> return Sent.Ok
                r.code == 422 && (r.error == "no_points" || r.error == "no_motion_rows") -> return Sent.NoData
                r.code == 404 -> return Sent.Removed
                r.code == 409 && r.error == "track_not_uploaded" -> return Sent.TrackFirst
                // The pieces didn't make the file: once more from piece 1, then it's a dead end.
                r.code == 422 && r.error == "sha256_mismatch" && !fresh -> fresh = true
                r.code in 400..499 -> return Sent.Refused
                else -> return Sent.Retry
            }
        }
        return Sent.Refused
    }

    /** The pieces the server doesn't hold yet, then the last; any lost on the way are sent again. */
    private suspend fun pieces(deviceId: String, name: String, bytes: ByteArray, fresh: Boolean): UploadReply {
        val parts = (bytes.size + PIECE - 1) / PIECE
        val sha = sha256(bytes)
        val held = if (fresh) emptySet() else account.held(deviceId, name).toSet()
        var todo = (1..parts).filter { it !in held || it == parts }
        repeat(3) {
            var lost: List<Int>? = null
            for (p in todo) {
                val r = account.upload(deviceId, name, bytes.copyOfRange((p - 1) * PIECE, minOf(p * PIECE, bytes.size)), p, parts, sha)
                if (r.code == 202) continue
                if (r.code == 409 && r.error == "parts_missing") { lost = r.missing; break }
                return r
            }
            todo = (lost ?: return UploadReply(500)).filter { it in 1 until parts } + parts
        }
        return UploadReply(500)
    }

    private enum class Sent { Ok, NoData, Removed, TrackFirst, Refused, Retry }

    companion object {
        const val PHONE_NOT_ADDED = "Couldn’t add this phone to your account."

        /** The tracker's piece size (docs/features/device-uplink.md). */
        const val PIECE = 64 * 1024

        private val NAME = Regex("""^(track_[A-Za-z0-9_]+?)(_i10)?\.csv$""")

        fun phoneFile(dir: File) = File(dir, "phone")
        fun offFile(dir: File) = File(dir, "phone-off")

        /** Recordings with a file still to send, oldest first, leaving out [running] and any the server refused. */
        fun waiting(dir: File, running: File?): List<String> = recordings(dir)
            .filter { File(dir, "$it.csv") != running && !File(dir, "$it.failed").exists() }

        private fun recordings(dir: File): List<String> =
            dir.list().orEmpty().mapNotNull { NAME.find(it)?.groupValues?.get(1) }.distinct().sorted()

        /** Signed in again: ask the server for this phone's id before the next upload (README § The phone on the account). */
        fun signedIn(dir: File) { phoneFile(dir).delete() }

        /** The owner started a recording or tapped Upload now: a removed phone may be added again. */
        fun allowAdding(dir: File) { offFile(dir).delete() }

        /** What Paddles shows for this account's recordings (README § After Stop). */
        fun lines(dir: File, running: File?): List<UploadLine> = buildList {
            val off = offFile(dir).takeIf { it.exists() }?.readText()
            if (off != null && waiting(dir, running).isNotEmpty()) add(UploadLine.PhoneOff(off.ifBlank { null }))
            for (base in recordings(dir) + nofix(dir)) {
                if (File(dir, "$base.csv") == running) continue
                val at = startedAt(base)
                when {
                    File(dir, "$base.failed").exists() -> add(UploadLine.Failed(base, at))
                    File(dir, "$base.nofix").exists() && !File(dir, "$base.csv").exists() -> add(UploadLine.NoFix(base, at))
                    off == null -> add(UploadLine.Waiting(base, at))
                }
            }
        }.distinct()

        private fun nofix(dir: File) = dir.list().orEmpty().filter { it.endsWith(".nofix") }.map { it.removeSuffix(".nofix") }

        /** Dismissed: the "No GPS fix" line goes. */
        fun dismiss(dir: File, base: String) { File(dir, "$base.nofix").delete() }

        /** track_20261101_070211(_1) → 2026-11-01T07:02:11Z, the UTC start the name was made from. */
        fun startedAt(base: String): String? = Regex("""^track_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})""").find(base)?.groupValues
            ?.let { g -> "${g[1]}-${g[2]}-${g[3]}T${g[4]}:${g[5]}:${g[6]}Z" }

        private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    }
}

/** One line on Paddles about a recording that hasn't become a paddle yet. [at]: its start, ISO UTC. */
sealed interface UploadLine {
    /** "Uploading…", or "Waiting to upload" while offline. */
    data class Waiting(val base: String, val at: String?) : UploadLine
    /** "No GPS fix, so this didn't become a paddle", until dismissed. */
    data class NoFix(val base: String, val at: String?) : UploadLine
    /** "Couldn't upload this recording. It's kept on this phone.", with Report an issue. */
    data class Failed(val base: String, val at: String?) : UploadLine
    /** Removed on Devices ([said] null), or the server's reason it couldn't be added. Upload now adds it again. */
    data class PhoneOff(val said: String?) : UploadLine
}
