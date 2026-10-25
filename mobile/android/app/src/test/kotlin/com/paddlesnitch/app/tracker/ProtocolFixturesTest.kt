package com.paddlesnitch.app.tracker

import java.io.File
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// The protocol layer against mobile/contract/fixtures/tracker, which pnpm test
// checks against the firmware and the website.
class ProtocolFixturesTest {
    private val dir = File("../../contract/fixtures/tracker")
    private fun fx(name: String) = Json.parseToJsonElement(dir.resolve(name).readText()).jsonObject
    private fun cases(kind: String) = fx("replies.json").getValue(kind).jsonArray.map { it.jsonObject }
    private fun JsonObject.raw() = getValue("raw").jsonPrimitive.content.encodeToByteArray()
    private fun JsonObject.out(): JsonElement = getValue("out")
    private fun JsonElement.str(k: String) = jsonObject.getValue(k).jsonPrimitive.content

    @Test fun theIdsAndSizesAreTheFirmwares() {
        val g = fx("gatt.json")
        val c = g.getValue("characteristics").jsonObject
        assertEquals(Gatt.SERVICE, g.getValue("service").jsonPrimitive.content)
        assertEquals(listOf("about", "paired", "link", "wifi", "sync", "data").map { c.getValue(it).jsonPrimitive.content }, Gatt.ITEMS)
        assertEquals(listOf(Gatt.ABOUT, Gatt.PAIRED, Gatt.LINK, Gatt.WIFI, Gatt.SYNC, Gatt.DATA), Gatt.ITEMS)
        assertEquals(g.getValue("layout").jsonPrimitive.content, Gatt.LAYOUT)
        assertEquals(g.getValue("namePrefix").jsonPrimitive.content, Gatt.NAME_PREFIX)
        assertEquals(g.getValue("pageData").jsonPrimitive.int, Gatt.PAGE_DATA)
        assertEquals(g.getValue("pieceBytes").jsonPrimitive.int, FakeTracker.PIECE)
        val wifi = g.getValue("wifi").jsonObject
        assertEquals(wifi.getValue("ssidMaxBytes").jsonPrimitive.int, Gatt.SSID_MAX_BYTES)
        assertEquals(wifi.getValue("passMaxBytes").jsonPrimitive.int, Gatt.PASS_MAX_BYTES)
    }

    @Test fun theAppWaitsAsLongAsTheWebsite() {
        val w = fx("gatt.json").getValue("waits").jsonObject
        fun wait(k: String) = w.getValue(k).jsonObject.let {
            Wait(it.getValue("tries").jsonPrimitive.int, it.getValue("delayMs").jsonPrimitive.long, it["readTimeoutMs"]?.jsonPrimitive?.long ?: 3000)
        }
        assertEquals(Waits(wait("pairing"), wait("wifi"), wait("sync")), Waits())
    }

    @Test fun aboutReadsLikeTheWebsite() {
        for (c in cases("about")) {
            val o = c.out()
            val want = if (o is JsonNull) null else TrackerAbout(o.str("id"), o.str("firmware"), o.str("model"),
                o.jsonObject.getValue("waiting").let { if (it is JsonNull) null else it.jsonPrimitive.int }, o.jsonObject.getValue("linked").jsonPrimitive.boolean)
            assertEquals(c.toString(), want, parseAbout(c.raw()))
        }
    }

    @Test fun pairedReadsLikeTheWebsite() {
        for (c in cases("paired")) assertEquals(c.toString(), c.out().jsonPrimitive.boolean, isPairedReply(c.raw()))
    }

    @Test fun linkReadsLikeTheWebsite() {
        for (c in cases("link")) {
            val o = c.out()
            val want = if (o is JsonNull) null else LinkStatus(o.str("id"), LinkState.valueOf(o.str("state").replaceFirstChar(Char::uppercase)), o.str("tokenHash"), o.str("sig"))
            assertEquals(c.toString(), want, parseLinkStatus(c.raw()))
        }
    }

    @Test fun wifiAndSyncReadLikeTheWebsite() {
        for (c in cases("wifi")) {
            val o = c.out()
            assertEquals(c.toString(), if (o is JsonNull) null else WifiState.entries.first { it.wire == o.jsonPrimitive.content }, parseWifiState(c.raw()))
        }
        for (c in cases("sync")) {
            val o = c.out()
            val want = if (o is JsonNull) null else o.jsonObject.let {
                SyncStatus(SyncState.entries.first { s -> s.wire == it.getValue("state").jsonPrimitive.content }, it.getValue("len").jsonPrimitive.int,
                    it.getValue("part").jsonPrimitive.int, it.getValue("parts").jsonPrimitive.int, it.getValue("compressed").jsonPrimitive.boolean)
            }
            assertEquals(c.toString(), want, parseSyncStatus(c.raw()))
        }
    }

    @Test fun theListDropsAnythingNotAPlainFileName() {
        for (c in cases("list")) {
            val want = c.out().jsonArray.map { e -> PendingRecording(e.str("name"), e.str("upload"), e.jsonObject.getValue("size").jsonPrimitive.long) }
            assertEquals(c.toString(), want, parsePendingList(c.raw()))
        }
    }

    @Test fun everyWriteIsTheJsonTheFirmwareReads() {
        val c = fx("commands.json")
        fun same(name: String, sent: String) = assertEquals(name, c.getValue(name), Json.parseToJsonElement(sent))
        val hash = c.getValue("linkCommit").str("tokenHash")
        same("linkBegin", Command.linkBegin)
        same("linkCommit", Command.linkCommit(hash))
        same("wifi", Command.wifi("Boathouse", "s3cret pass"))
        same("syncList", Command.list)
        same("syncPiece", Command.piece("track_20261005_061002.csv", 1))
        same("syncDone", Command.done("track_20261005_061002_i10.csv", c.getValue("syncDone").str("receipt")))
        same("dataSeek", Command.seek(1500))
    }

    @Test fun aPageStartsWithItsOffsetLittleEndian() = runTest {
        val p = fx("pages.json").getValue("page").jsonObject
        val bytes = p.getValue("hex").jsonPrimitive.content.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        assertEquals(p.getValue("offset").jsonPrimitive.long, pageOffset(bytes))
        // Read as a 3-byte payload starting at that offset: one page, nothing to seek.
        var reads = 0
        val shifted = readPayload({ reads++; byteArrayOf(0, 0, 0, 0) + bytes.copyOfRange(4, bytes.size) }, { error("no seek") }, 3)
        assertArrayEquals(p.getValue("data").jsonPrimitive.content.encodeToByteArray(), shifted)
        assertEquals(1, reads)
    }

    @Test fun theFakesReceiptIsTheServers() {
        val r = fx("receipt.json")
        assertEquals(r.getValue("tokenHash").jsonPrimitive.content, sha256Hex(r.getValue("token").jsonPrimitive.content))
        for (c in r.getValue("cases").jsonArray.map { it.jsonObject }) {
            assertEquals(c.getValue("receipt").jsonPrimitive.content,
                receiptFor(r.getValue("tokenHash").jsonPrimitive.content, r.getValue("deviceId").jsonPrimitive.content, c.getValue("upload").jsonPrimitive.content))
        }
    }

    @Test fun aRepliesTrailingZeroByteIsTrimmed() {
        assertNull(parseAbout("{}".encodeToByteArray()))
        assertEquals(WifiState.Joined, parseWifiState("{\"v\":1,\"state\":\"joined\"}\u0000\u0000 ".encodeToByteArray()))
    }
}
