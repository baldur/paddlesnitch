package com.paddlesnitch.app.record

import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.Phone
import com.paddlesnitch.app.api.SignedOut
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Uploading a phone's recordings (mobile/contract/README.md § Phone recording): every
// answer in the contract's table, and what the phone keeps or deletes after each.
class PhoneUploaderTest {
    private val dir: File = Files.createTempDirectory("acct").toFile()
    @After fun tearDown() { dir.deleteRecursively() }

    private val phone = ApiJson.decodeFromString(Phone.serializer(), File("../../contract/fixtures/api/account.phone.json").readText())

    /** A server that answers each file by name (and piece), and keeps a log of what it was sent. */
    private inner class Server : PhoneAccount {
        val sent = mutableListOf<String>()
        val adds = mutableListOf<String>()
        var addFails: ApiFailure? = null
        var held = emptyList<Int>()
        val answers = mutableMapOf<String, ArrayDeque<UploadReply>>()
        val bodies = mutableMapOf<String, MutableList<ByteArray>>()
        var sha: String? = null
        fun answer(name: String, vararg r: UploadReply) { answers.getOrPut(name) { ArrayDeque() }.addAll(r) }

        override suspend fun addPhone(installId: String): Phone { adds += installId; addFails?.let { throw it }; return phone }
        override suspend fun upload(deviceId: String, filename: String, bytes: ByteArray, part: Int?, parts: Int?, sha256: String?): UploadReply {
            assertEquals(phone.deviceId, deviceId)
            sent += if (part == null) filename else "$filename#$part/$parts"
            bodies.getOrPut(filename) { mutableListOf() } += bytes
            if (sha256 != null) sha = sha256
            val q = answers[filename]
            return q?.removeFirstOrNull() ?: if (part != null && part < parts!!) UploadReply(202) else UploadReply(201)
        }
        override suspend fun held(deviceId: String, filename: String) = held
    }

    private val server = Server()
    private var running: File? = null
    private var sentTracks = 0
    private fun uploader() = PhoneUploader(dir, server, installId = { "install-id-0123456789" }, recording = { running }, changed = { if (it) sentTracks++ })
    private fun run() = runBlocking { uploader().run() }

    private fun recording(base: String = "track_20261101_070211", track: String = "timestamp,lat\n1,2\n", motion: String? = "t_ms,ax\n1,0\n") {
        File(dir, "$base.csv").writeText(track)
        motion?.let { File(dir, "${base}_i10.csv").writeText(it) }
        File(dir, "$base.log").writeText("dropped_late,0\n")
    }
    private fun has(name: String) = File(dir, name).exists()

    @Test fun theTrackGoesFirstThenTheMotionFileUnderTheTrackersName() {
        recording()
        assertTrue(run())
        assertEquals(listOf("track_20261101_070211.csv", "track_20261101_070211_imu.csv"), server.sent)
        // The server has both: the phone keeps nothing of it, not even the log.
        assertEquals(listOf("phone"), dir.list()!!.toList())
        assertEquals(1, sentTracks)
    }

    @Test fun thePhoneIsAddedOnceAndItsIdKept() {
        recording()
        run()
        recording("track_20261101_090000")
        run()
        assertEquals(listOf("install-id-0123456789"), server.adds)
        assertEquals(phone.deviceId, File(dir, "phone").readText())
    }

    @Test fun afterASignInThePhoneIsAskedForAgain() {
        recording(); run()
        PhoneUploader.signedIn(dir)
        recording("track_20261101_090000"); run()
        assertEquals(2, server.adds.size)
    }

    @Test fun alreadyUploadedCountsAsSent() {
        recording()
        server.answer("track_20261101_070211.csv", UploadReply(409, "already_uploaded"))
        server.answer("track_20261101_070211_imu.csv", UploadReply(409, "already_uploaded"))
        assertTrue(run())
        assertFalse(has("track_20261101_070211.csv")); assertFalse(has("track_20261101_070211_i10.csv"))
    }

    @Test fun noPointsCountsAsSentAndSaysNoGpsFixUntilDismissed() {
        recording()
        server.answer("track_20261101_070211.csv", UploadReply(422, "no_points"))
        assertTrue(run())
        assertEquals("the motion file isn't sent", listOf("track_20261101_070211.csv"), server.sent)
        assertFalse(has("track_20261101_070211.csv")); assertFalse(has("track_20261101_070211_i10.csv"))
        assertEquals(listOf(UploadLine.NoFix("track_20261101_070211", "2026-11-01T07:02:11Z")), PhoneUploader.lines(dir, null))
        PhoneUploader.dismiss(dir, "track_20261101_070211")
        assertEquals(emptyList<UploadLine>(), PhoneUploader.lines(dir, null))
    }

    @Test fun anEmptyMotionFileCountsAsSent() {
        recording()
        server.answer("track_20261101_070211_imu.csv", UploadReply(422, "no_motion_rows"))
        assertTrue(run())
        assertFalse(has("track_20261101_070211_i10.csv"))
        assertEquals(emptyList<UploadLine>(), PhoneUploader.lines(dir, null))
    }

    @Test fun aRemovedPhoneStopsEverythingAndKeepsTheFiles() {
        recording(); recording("track_20261101_090000")
        server.answer("track_20261101_070211.csv", UploadReply(404, "not_found"))
        assertTrue("nothing more to do in the background", run())
        assertEquals(listOf("track_20261101_070211.csv"), server.sent)
        assertTrue(has("track_20261101_070211.csv")); assertTrue(has("track_20261101_090000.csv"))
        assertEquals(listOf(UploadLine.PhoneOff(null)), PhoneUploader.lines(dir, null))
        // Never added again in the background...
        assertTrue(run())
        assertEquals(1, server.sent.size)
        assertEquals(1, server.adds.size)
        // ...only when the owner starts a recording or taps Upload now.
        PhoneUploader.allowAdding(dir)
        assertTrue(run())
        assertEquals(2, server.adds.size)
        assertEquals(listOf("phone"), dir.list()!!.toList())
    }

    @Test fun anAccountWithTenPhonesSaysSoInTheServersWords() {
        recording()
        server.addFails = ApiFailure("Couldn't add this phone: your account has 10 already. Remove one on Devices, then try again.", 409)
        assertTrue(run())
        assertEquals(emptyList<String>(), server.sent)
        assertEquals(listOf(UploadLine.PhoneOff("Couldn't add this phone: your account has 10 already. Remove one on Devices, then try again.")),
            PhoneUploader.lines(dir, null))
    }

    @Test fun noNetworkWhileAddingThePhoneIsTriedAgainLater() {
        recording()
        server.addFails = ApiFailure("Couldn’t reach paddlesnitch. Check your connection and try again.")
        assertFalse(run())
        assertEquals(listOf(UploadLine.Waiting("track_20261101_070211", "2026-11-01T07:02:11Z")), PhoneUploader.lines(dir, null))
    }

    @Test fun anyOtherRefusalKeepsTheFileStopsRetryingItAndSaysSo() {
        recording(); recording("track_20261101_090000")
        server.answer("track_20261101_070211.csv", UploadReply(413, "too_large"))
        assertTrue(run())
        assertTrue(has("track_20261101_070211.csv"))
        assertFalse("the next one still goes", has("track_20261101_090000.csv"))
        assertEquals(listOf(UploadLine.Failed("track_20261101_070211", "2026-11-01T07:02:11Z")), PhoneUploader.lines(dir, null))
        server.sent.clear()
        assertTrue(run())
        assertEquals("never retried by itself", emptyList<String>(), server.sent)
    }

    @Test fun aServerErrorIsTriedAgainLaterAndKeepsEverything() {
        recording()
        server.answer("track_20261101_070211.csv", UploadReply(503))
        assertFalse(run())
        assertTrue(has("track_20261101_070211.csv"))
        assertTrue(run())
        assertFalse(has("track_20261101_070211.csv"))
    }

    @Test fun noNetworkMidUploadIsTriedAgainLater() {
        recording()
        val flaky = object : PhoneAccount by server {
            override suspend fun upload(deviceId: String, filename: String, bytes: ByteArray, part: Int?, parts: Int?, sha256: String?): UploadReply =
                throw ApiFailure("Couldn’t reach paddlesnitch. Check your connection and try again.")
        }
        assertFalse("tried again later", runBlocking { PhoneUploader(dir, flaky, { "install-id-0123456789" }).run() })
        assertTrue(has("track_20261101_070211.csv"))
    }

    @Test fun signedOutStopsAndKeepsEverything() {
        recording()
        val out = object : PhoneAccount by server { override suspend fun addPhone(installId: String): Phone = throw SignedOut() }
        val r = runBlocking { runCatching { PhoneUploader(dir, out, { "install-id-0123456789" }).run() } }
        assertTrue(r.exceptionOrNull() is SignedOut)
        assertTrue(has("track_20261101_070211.csv"))
    }

    @Test fun theMotionFileBeforeItsTrackIsSentAgainAfterIt() {
        // The track went on an earlier run; the motion file was refused for want of it.
        File(dir, "track_20261101_070211_i10.csv").writeText("t_ms,ax\n1,0\n")
        server.answer("track_20261101_070211_imu.csv", UploadReply(409, "track_not_uploaded"))
        assertTrue(run())
        // Its track has left the phone, so it can't go first: kept, and said.
        assertTrue(has("track_20261101_070211_i10.csv"))
        assertEquals(listOf(UploadLine.Failed("track_20261101_070211", "2026-11-01T07:02:11Z")), PhoneUploader.lines(dir, null))
    }

    @Test fun theRecordingStillRunningIsNeverUploaded() {
        recording(); recording("track_20261101_090000")
        running = File(dir, "track_20261101_090000.csv")
        assertTrue(run())
        assertEquals(listOf("track_20261101_070211.csv", "track_20261101_070211_imu.csv"), server.sent)
        assertTrue(has("track_20261101_090000.csv"))
        assertEquals("nor shown as waiting", emptyList<UploadLine>(), PhoneUploader.lines(dir, running))
    }

    @Test fun waitingRecordingsShowOldestFirstWithTheirStart() {
        recording("track_20261101_090000"); recording("track_20261101_070211"); recording("track_20261101_070211_1")
        assertEquals(listOf("track_20261101_070211", "track_20261101_070211_1", "track_20261101_090000"),
            PhoneUploader.lines(dir, null).map { (it as UploadLine.Waiting).base })
        assertEquals("2026-11-01T07:02:11Z", PhoneUploader.startedAt("track_20261101_070211_1"))
    }

    // 64 KB pieces, as the tracker sends them, with the sha256 of the whole file.
    private val big = "timestamp,lat\n" + "1730444531,51.4567890,-0.9876543\n".repeat(5000)   // ~165 KB: 3 pieces

    @Test fun aBigFileGoesInPiecesWithTheWholeFilesSha256() {
        recording(track = big, motion = null)
        assertTrue(run())
        assertEquals(listOf("track_20261101_070211.csv#1/3", "track_20261101_070211.csv#2/3", "track_20261101_070211.csv#3/3"), server.sent)
        assertEquals(big, server.bodies.getValue("track_20261101_070211.csv").fold(ByteArray(0)) { a, b -> a + b }.decodeToString())
        assertEquals(PhoneUploader.PIECE, server.bodies.getValue("track_20261101_070211.csv")[0].size)
        assertEquals(MessageDigest.getInstance("SHA-256").digest(big.toByteArray()).joinToString("") { "%02x".format(it) }, server.sha)
    }

    @Test fun piecesTheServerHoldsFromABrokenUploadArentSentAgain() {
        recording(track = big, motion = null)
        server.held = listOf(1, 2)
        assertTrue(run())
        assertEquals(listOf("track_20261101_070211.csv#3/3"), server.sent)
    }

    @Test fun piecesLostOnTheWayAreSentAgainThenTheLast() {
        recording(track = big, motion = null)
        server.answer("track_20261101_070211.csv", UploadReply(202), UploadReply(202), UploadReply(409, "parts_missing", listOf(2)))
        assertTrue(run())
        assertEquals(listOf("track_20261101_070211.csv#1/3", "track_20261101_070211.csv#2/3", "track_20261101_070211.csv#3/3",
            "track_20261101_070211.csv#2/3", "track_20261101_070211.csv#3/3"), server.sent)
        assertFalse(has("track_20261101_070211.csv"))
    }

    @Test fun aShaMismatchSendsTheWholeFileAgainOnceFromPieceOne() {
        recording(track = big, motion = null)
        server.held = listOf(1, 2)
        server.answer("track_20261101_070211.csv", UploadReply(422, "sha256_mismatch"))
        assertTrue(run())
        assertEquals(listOf("track_20261101_070211.csv#3/3",
            "track_20261101_070211.csv#1/3", "track_20261101_070211.csv#2/3", "track_20261101_070211.csv#3/3"), server.sent)
        assertFalse(has("track_20261101_070211.csv"))
    }

    @Test fun aSecondShaMismatchIsADeadEnd() {
        recording(track = big, motion = null)
        server.answer("track_20261101_070211.csv", UploadReply(202), UploadReply(202), UploadReply(422, "sha256_mismatch"),
            UploadReply(202), UploadReply(202), UploadReply(422, "sha256_mismatch"))
        assertTrue(run())
        assertTrue(has("track_20261101_070211.csv"))
        assertEquals(listOf(UploadLine.Failed("track_20261101_070211", "2026-11-01T07:02:11Z")), PhoneUploader.lines(dir, null))
    }

    @Test fun aSmallFileGoesWholeWithNoPieces() {
        recording(motion = null)
        run()
        assertEquals(listOf("track_20261101_070211.csv"), server.sent)
        assertEquals(null, server.sha)
    }
}
