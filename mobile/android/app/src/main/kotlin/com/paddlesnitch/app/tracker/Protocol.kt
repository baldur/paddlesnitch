package com.paddlesnitch.app.tracker

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * The tracker's Bluetooth service (mobile/contract/fixtures/tracker, from
 * firmware/include/ble_about.h and the website's lib/tracker-ble.ts). Pure
 * Kotlin: no Android types, so the JVM tests drive it with a fake tracker.
 */
object Gatt {
    const val SERVICE = "04dd0a01-9cd1-403e-a461-0b4af515a1b4"
    const val ABOUT = "04dd0a02-9cd1-403e-a461-0b4af515a1b4"
    /** Readable only over a paired connection; reading it is what starts pairing. */
    const val PAIRED = "04dd0a03-9cd1-403e-a461-0b4af515a1b4"
    const val LINK = "04dd0a04-9cd1-403e-a461-0b4af515a1b4"
    const val WIFI = "04dd0a05-9cd1-403e-a461-0b4af515a1b4"
    const val SYNC = "04dd0a06-9cd1-403e-a461-0b4af515a1b4"
    const val DATA = "04dd0a07-9cd1-403e-a461-0b4af515a1b4"
    /** firmware/src/ble.cpp BLE_LAYOUT: the items a phone should find. */
    const val LAYOUT = "about,paired,link,wifi,sync,data/v2"
    val ITEMS = listOf(ABOUT, PAIRED, LINK, WIFI, SYNC, DATA)
    const val NAME_PREFIX = "PT-"
    const val PAGE_DATA = 500
    const val SSID_MAX_BYTES = 32
    const val PASS_MAX_BYTES = 64
}

data class Wait(val tries: Int, val delayMs: Long, val readTimeoutMs: Long = 3000)

/** How long to keep asking, as the website does (gatt.json "waits"). */
data class Waits(
    val pairing: Wait = Wait(8, 1500, 3000),
    val wifi: Wait = Wait(30, 1500),
    val sync: Wait = Wait(120, 250),
)

data class TrackerAbout(val id: String, val firmware: String, val model: String, val waiting: Int?, val linked: Boolean)

enum class LinkState { Idle, Pending, Committed }
data class LinkStatus(val id: String, val state: LinkState, val tokenHash: String, val sig: String)

enum class WifiState(val wire: String) {
    Idle("idle"), Trying("trying"), Joined("joined"), WrongPassword("wrong_password"), NotFound("not_found"), Failed("failed")
}

enum class SyncState(val wire: String) {
    Idle("idle"), Working("working"), Ready("ready"), Marked("marked"), BadReceipt("bad_receipt"), Busy("busy"), Error("error")
}
data class SyncStatus(val state: SyncState, val len: Int, val part: Int, val parts: Int, val compressed: Boolean)

/** A waiting recording: `name` on the tracker's card, `upload` the name the server knows it by. */
data class PendingRecording(val name: String, val upload: String, val size: Long)

private val ID = Regex("^[0-9A-F]{8}$")
private val HASH = Regex("^([0-9a-f]{64})?$")
private val SIG = Regex("^[A-Za-z0-9+/]{0,200}={0,2}$")
private val SAFE_NAME = Regex("^[\\w.-]{1,64}$")

// A value set from a C string can carry its terminating zero byte.
private fun text(raw: ByteArray) = raw.decodeToString().trimEnd { it == '\u0000' || it.isWhitespace() }
private fun json(raw: ByteArray): JsonElement? = runCatching { Json.parseToJsonElement(text(raw)) }.getOrNull()
private fun obj(raw: ByteArray): JsonObject? = json(raw) as? JsonObject
private fun JsonElement?.prim() = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }
private fun JsonElement?.str() = prim()?.takeIf { it.isString }?.content
private fun JsonElement?.num() = prim()?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it.isFinite() }
private fun JsonElement?.bool() = prim()?.takeIf { !it.isString }?.booleanOrNull
private fun JsonObject.v1() = this["v"].num() == 1.0

fun parseAbout(raw: ByteArray): TrackerAbout? {
    val o = obj(raw)?.takeIf { it.v1() } ?: return null
    val id = o["id"].str()?.takeIf { ID.matches(it) } ?: return null
    val fw = o["fw"].str() ?: return null
    val model = o["model"].str() ?: return null
    val linked = o["linked"].bool() ?: return null
    val w = o["waiting"]
    val waiting = if (w is JsonNull) null else w.num()?.toInt() ?: return null
    return TrackerAbout(id, fw, model, waiting, linked)
}

fun isPairedReply(raw: ByteArray): Boolean = obj(raw)?.let { it.v1() && it["paired"].bool() == true } ?: false

fun parseLinkStatus(raw: ByteArray): LinkStatus? {
    val o = obj(raw)?.takeIf { it.v1() } ?: return null
    val id = o["id"].str()?.takeIf { ID.matches(it) } ?: return null
    val state = when (o["state"].str()) { "idle" -> LinkState.Idle; "pending" -> LinkState.Pending; "committed" -> LinkState.Committed; else -> return null }
    val hash = o["tokenHash"].str()?.takeIf { HASH.matches(it) } ?: return null
    val s = o["sig"]
    val sig = if (s == null || s is JsonNull) "" else s.str()?.takeIf { SIG.matches(it) } ?: return null
    return LinkStatus(id, state, hash, sig)
}

fun parseWifiState(raw: ByteArray): WifiState? {
    val o = obj(raw)?.takeIf { it.v1() } ?: return null
    return WifiState.entries.firstOrNull { it.wire == o["state"].str() }
}

fun parseSyncStatus(raw: ByteArray): SyncStatus? {
    val o = obj(raw)?.takeIf { it.v1() } ?: return null
    val state = SyncState.entries.firstOrNull { it.wire == o["state"].str() } ?: return null
    fun n(k: String) = o[k].num()?.toInt() ?: 0
    return SyncStatus(state, n("len"), n("part"), n("parts"), o["compressed"].bool() == true)
}

/** Tracks before motion files, as the tracker lists them; anything not a plain file name is dropped. */
fun parsePendingList(raw: ByteArray): List<PendingRecording> {
    val arr = json(raw) as? JsonArray ?: return emptyList()
    return arr.mapNotNull { e ->
        val o = e as? JsonObject ?: return@mapNotNull null
        val n = o["n"].str()?.takeIf { SAFE_NAME.matches(it) && !it.startsWith(".") } ?: return@mapNotNull null
        val u = o["u"].str()?.takeIf { SAFE_NAME.matches(it) } ?: return@mapNotNull null
        val s = o["s"].num() ?: return@mapNotNull null
        PendingRecording(n, u, s.toLong())
    }
}

/** What each write sends (commands.json). */
object Command {
    private fun q(s: String) = JsonPrimitive(s).toString()
    val linkBegin = """{"op":"begin"}"""
    fun linkCommit(hash: String) = """{"op":"commit","tokenHash":${q(hash)}}"""
    fun wifi(ssid: String, pass: String) = """{"ssid":${q(ssid)},"pass":${q(pass)}}"""
    val list = """{"op":"list"}"""
    fun piece(name: String, part: Int) = """{"op":"piece","name":${q(name)},"part":$part}"""
    fun done(name: String, receipt: String) = """{"op":"done","name":${q(name)},"receipt":${q(receipt)}}"""
    fun seek(offset: Int) = """{"op":"seek","offset":$offset}"""
}

/** The offset a DATA page starts at: its first 4 bytes, little-endian. */
fun pageOffset(page: ByteArray): Long =
    (page[0].toLong() and 0xff) or ((page[1].toLong() and 0xff) shl 8) or ((page[2].toLong() and 0xff) shl 16) or ((page[3].toLong() and 0xff) shl 24)

/**
 * Read `len` bytes off DATA. A page that doesn't start where we are (a read
 * lost or repeated) makes us seek back rather than splice the wrong bytes in.
 */
suspend fun readPayload(readPage: suspend () -> ByteArray, seek: suspend (Int) -> Unit, len: Int, maxMisses: Int = 20): ByteArray {
    val out = ByteArray(len)
    var at = 0
    var misses = 0
    while (at < len) {
        val p = readPage()
        if (p.size < 4) throw TrackerError.Unexpected("empty page")
        val n = p.size - 4
        if (pageOffset(p) != at.toLong() || n == 0) {
            if (++misses > maxMisses) throw TrackerError.Unexpected("pages out of place at $at")
            seek(at)
            continue
        }
        val take = minOf(n, len - at)
        p.copyInto(out, at, 4, 4 + take)
        at += n
    }
    return out
}
