package com.paddlesnitch.app.tracker

import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.zip.Deflater
import java.util.zip.Inflater
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.awaitCancellation
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

fun sha256Hex(s: String) = MessageDigest.getInstance("SHA-256").digest(s.encodeToByteArray()).joinToString("") { "%02x".format(it) }

/** The server's uploadReceipt (packages/core/src/devices.ts): HMAC-SHA256 keyed with the hex token hash. */
fun receiptFor(tokenHash: String, deviceId: String, upload: String): String {
    val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(tokenHash.encodeToByteArray(), "HmacSHA256")) }
    return mac.doFinal("ps-receipt:v1|$deviceId|$upload".encodeToByteArray()).joinToString("") { "%02x".format(it) }
}

fun zlib(b: ByteArray): ByteArray {
    val d = Deflater().apply { setInput(b); finish() }
    val out = ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (!d.finished()) out.write(buf, 0, d.deflate(buf))
    return out.toByteArray()
}

fun unzlib(b: ByteArray): ByteArray {
    val i = Inflater().apply { setInput(b) }
    val out = ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (!i.finished()) out.write(buf, 0, i.inflate(buf))
    return out.toByteArray()
}

/**
 * A tracker on the other end of the link, behaving like firmware/src/ble.cpp
 * and uplink.cpp: About open to anyone, everything else paired-only; a link
 * token it makes and keeps; WiFi tried before saving; 64 KB pieces, zlib when
 * that helps, pages of [u32 offset][<=500 bytes]; "marked" only for the right receipt.
 */
class FakeTracker(
    val id: String = "435AC17C",
    var files: MutableMap<String, String> = mutableMapOf(),
    var linked: Boolean = false,
    /** Paired-only reads Android refuses before pairing finishes. */
    var refusals: Int = 0,
    /** Paired-only reads that never answer at all. */
    var hangs: Int = 0,
    var neverPairs: Boolean = false,
    var wifi: (ssid: String, pass: String) -> WifiState = { _, _ -> WifiState.Joined },
    var wifiReadsToDecide: Int = 3,
    var recording: Boolean = false,
    /** Drop the page at this offset once, as a lost read would. */
    var skipPageAt: Int? = null,
    var missing: Set<String> = emptySet(),
    token: String? = null,
) : TrackerLink {
    override val name = "PT-" + id.takeLast(3)
    var paired = false
    var pairingAsked = 0
    var token: String? = token
    val marked = mutableListOf<String>()
    val writes = mutableListOf<Pair<String, String>>()
    var closed = false

    private var pendingToken: String? = null
    private var committed = false
    private var wifiState = WifiState.Idle
    private var wifiReads = 0
    private var wifiTrial: WifiState = WifiState.Idle
    private var savedWifi: String? = null
    private var state = "idle"
    private var data = ByteArray(0)
    private var cursor = 0
    private var part = 0
    private var parts = 0
    private var compressed = false

    val savedNetwork get() = savedWifi

    override suspend fun startPairing() { pairingAsked++ }

    private suspend fun guard(uuid: String) {
        if (uuid in missing) throw TrackerError.NotThere(uuid)
        if (uuid == Gatt.ABOUT) return
        if (!paired) {
            if (hangs > 0) { hangs--; awaitCancellation() }
            if (refusals > 0 || neverPairs) { if (refusals > 0) refusals--; throw TrackerError.NotPaired(5) }
            paired = true
        }
    }

    override suspend fun read(uuid: String): ByteArray {
        guard(uuid)
        return when (uuid) {
            Gatt.ABOUT -> """{"v":1,"id":"$id","fw":"0.19.3","model":"lilygo-tbeam-s3-supreme","waiting":${files.size},"linked":${linked || token != null}}"""
            Gatt.PAIRED -> "{\"v\":1,\"paired\":true}\u0000"
            Gatt.LINK -> {
                val st = if (committed) "committed" else if (pendingToken != null) "pending" else "idle"
                val hash = if (committed) "" else pendingToken?.let(::sha256Hex) ?: ""
                """{"v":1,"id":"$id","state":"$st","tokenHash":"$hash","sig":"${if (hash.isEmpty()) "" else "c2lnbmF0dXJl"}"}"""
            }
            Gatt.WIFI -> {
                if (wifiState == WifiState.Trying && ++wifiReads >= wifiReadsToDecide) {
                    wifiState = wifiTrial
                }
                """{"v":1,"state":"${wifiState.wire}"}"""
            }
            Gatt.SYNC -> """{"v":1,"state":"${if (recording) "busy" else state}","len":${data.size},"part":$part,"parts":$parts,"compressed":$compressed}"""
            Gatt.DATA -> {
                if (state != "ready") return ByteArray(0)
                if (skipPageAt == cursor && cursor < data.size) { skipPageAt = null; cursor = minOf(data.size, cursor + Gatt.PAGE_DATA) }
                val n = minOf(Gatt.PAGE_DATA, data.size - cursor)
                val p = ByteArray(4 + n)
                p[0] = cursor.toByte(); p[1] = (cursor shr 8).toByte(); p[2] = (cursor shr 16).toByte(); p[3] = (cursor shr 24).toByte()
                data.copyInto(p, 4, cursor, cursor + n)
                cursor += n
                p
            }
            else -> throw TrackerError.NotThere(uuid)
        }.let { if (it is String) it.encodeToByteArray() else it as ByteArray }
    }

    override suspend fun write(uuid: String, value: ByteArray) {
        guard(uuid)
        val text = value.decodeToString()
        writes += uuid to text
        val o = Json.parseToJsonElement(text).jsonObject
        fun s(k: String) = o[k]?.jsonPrimitive?.content ?: ""
        when (uuid) {
            Gatt.LINK -> when (s("op")) {
                "begin" -> { pendingToken = "tok-" + System.nanoTime(); committed = false }
                "commit" -> if (pendingToken != null && sha256Hex(pendingToken!!) == s("tokenHash")) { token = pendingToken; pendingToken = null; committed = true }
            }
            Gatt.WIFI -> {
                val ssid = s("ssid"); val pass = s("pass")
                if (ssid.isEmpty() || ssid.length > 32 || pass.length > 64) return
                wifiTrial = wifi(ssid, pass); wifiState = WifiState.Trying; wifiReads = 0
                if (wifiTrial == WifiState.Joined) savedWifi = ssid
            }
            Gatt.SYNC -> command(o, s("op"), s("name"))
            Gatt.DATA -> if (s("op") == "seek") cursor = minOf(o["offset"]!!.jsonPrimitive.int, data.size)
        }
    }

    private fun upload(n: String) = n.replace(Regex("_i10\\.csv$"), "_imu.csv")

    private fun command(o: JsonObject, op: String, name: String) {
        cursor = 0
        when (op) {
            "list" -> {
                val names = files.keys.sortedBy { it.contains("_i10") }
                data = names.joinToString(",", "[", "]") { """{"n":"$it","u":"${upload(it)}","s":${files.getValue(it).length}}""" }.encodeToByteArray()
                state = "ready"; compressed = false; parts = 0
            }
            "piece" -> {
                val raw = files.getValue(name).encodeToByteArray()
                parts = maxOf(1, (raw.size + PIECE - 1) / PIECE); part = o["part"]!!.jsonPrimitive.int
                val slice = raw.copyOfRange(minOf(raw.size, (part - 1) * PIECE), minOf(raw.size, part * PIECE))
                val z = zlib(slice)
                compressed = z.size < slice.size
                data = if (compressed) z else slice
                state = "ready"
            }
            "done" -> {
                val ok = token != null && o["receipt"]?.jsonPrimitive?.content == receiptFor(sha256Hex(token!!), id, upload(name))
                if (ok) { marked += name; files.remove(name) }
                state = if (ok) "marked" else "bad_receipt"
            }
        }
    }

    override fun close() { closed = true }

    companion object { const val PIECE = 64 * 1024 }
}

/**
 * paddlesnitch.com's side: link-bluetooth registers the hash, the relay
 * route keeps pieces until the last arrives with all the others (like
 * storeUploadPart), and answers with the receipt.
 */
class FakeAccount(var mine: MutableSet<String> = mutableSetOf(), var tokenHash: String? = null) : TrackerAccount {
    val staged = mutableMapOf<String, MutableMap<Int, ByteArray>>()
    val assembled = mutableMapOf<String, String>()
    val uploads = mutableListOf<Pair<String, Int>>()
    var linkError: Pair<Int, String>? = null
    var failAt: Int? = null
    var reject: Map<String, Reply> = emptyMap()
    val linkCalls = mutableListOf<List<String>>()

    override suspend fun myTrackerIds() = mine.toSet()

    override suspend fun linkBluetooth(deviceId: String, tokenHash: String, signature: String, model: String, firmware: String): Reply {
        linkCalls += listOf(deviceId, tokenHash, signature, model, firmware)
        linkError?.let { return Reply(it.first, it.second) }
        this.tokenHash = tokenHash; mine += deviceId
        return Reply(200)
    }

    override suspend fun upload(about: TrackerAbout, rec: PendingRecording, part: Int, parts: Int, bytes: ByteArray, compressed: Boolean): Reply {
        if (failAt == part) { failAt = null; throw java.io.IOException("connection dropped") }
        reject[rec.name]?.let { return it }
        uploads += rec.upload to part
        if (assembled.containsKey(rec.upload)) return Reply(409, "already_uploaded", receiptFor(tokenHash!!, about.id, rec.upload))
        val m = staged.getOrPut(rec.upload) { mutableMapOf() }
        m[part] = if (compressed) unzlib(bytes) else bytes
        if (part < parts) return Reply(202)
        if (m.size < parts) return Reply(409, "parts_missing")
        assembled[rec.upload] = (1..parts).fold(ByteArray(0)) { acc, k -> acc + m.getValue(k) }.decodeToString()
        staged.remove(rec.upload)
        return Reply(201, receipt = receiptFor(tokenHash!!, about.id, rec.upload))
    }

    override suspend fun staged(about: TrackerAbout, rec: PendingRecording) = staged[rec.upload]?.keys?.toList() ?: emptyList()
}
