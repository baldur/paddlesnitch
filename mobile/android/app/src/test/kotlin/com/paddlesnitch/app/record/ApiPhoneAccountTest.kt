package com.paddlesnitch.app.record

import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.auth.MemoryTokenStore
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

// The phone's calls on the wire (mobile/contract/README.md § Phone recording), answered
// with the contract's own fixtures, which lead checked against the real routes.
class ApiPhoneAccountTest {
    private val server = MockWebServer()
    private val tokens = MemoryTokenStore()
    private lateinit var account: ApiPhoneAccount
    private val dir: File = Files.createTempDirectory("acct").toFile()
    private val fixtures = File("../../contract/fixtures/api")

    @Before fun start() {
        server.start()
        tokens.save("id-1", "r-1")
        account = ApiPhoneAccount(Api(server.url("/").toString(), tokens, "0.1.0"))
    }
    @After fun stop() { server.close(); dir.deleteRecursively() }

    private fun answer(code: Int, fixture: String) = server.enqueue(MockResponse.Builder().code(code).body(fixtures.resolve(fixture).readText()).build())

    @Test fun addingThePhoneSendsTheInstallIdAndModelOnly() = runTest {
        answer(201, "account.phone.json")
        val phone = account.addPhone("install-id-0123456789")
        assertEquals("P3F2A9C41B7E0D865", phone.deviceId)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/account/devices/phone", req.url.encodedPath)
        assertEquals("Bearer id-1", req.headers["Authorization"])
        val body = Json.parseToJsonElement(req.body!!.utf8()).jsonObject
        assertEquals(setOf("installId", "model"), body.keys)
        assertEquals("phone-android", body.getValue("model").jsonPrimitive.content)
    }

    @Test fun aFileGoesAsItsOwnBytesWithItsName() = runTest {
        answer(201, "account.phone-upload.json")
        val r = account.upload("P3F2A9C41B7E0D865", "track_20261101_070211.csv", "timestamp,lat\n".toByteArray())
        assertEquals(UploadReply(201), r)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/account/devices/P3F2A9C41B7E0D865/sessions", req.url.encodedPath)
        assertEquals("track_20261101_070211.csv", req.url.queryParameter("filename"))
        assertEquals(null, req.url.queryParameter("part"))
        assertEquals("timestamp,lat\n", req.body!!.utf8())   // not multipart
        assertTrue(req.headers["Content-Type"]!!.startsWith("text/csv"))
    }

    @Test fun aPieceCarriesItsNumberTheCountAndTheWholeFilesSha() = runTest {
        answer(202, "account.phone-upload.piece.json")
        assertEquals(UploadReply(202), account.upload("P3F2A9C41B7E0D865", "track_x.csv", ByteArray(10), 1, 4, "ab".repeat(32)))
        val url = server.takeRequest().url
        assertEquals("1", url.queryParameter("part")); assertEquals("4", url.queryParameter("parts")); assertEquals("ab".repeat(32), url.queryParameter("sha256"))
    }

    @Test fun theAnswersWordsAreRead() = runTest {
        answer(409, "account.phone-upload.already-uploaded.json")
        assertEquals(UploadReply(409, "already_uploaded"), account.upload("P1", "track_x.csv", ByteArray(1)))
        answer(422, "account.phone-upload.no-points.json")
        assertEquals(UploadReply(422, "no_points"), account.upload("P1", "track_x.csv", ByteArray(1)))
        answer(409, "account.phone-upload.track-not-uploaded.json")
        assertEquals(UploadReply(409, "track_not_uploaded"), account.upload("P1", "track_x_imu.csv", ByteArray(1)))
        answer(404, "account.phone-upload.not-found.json")
        assertEquals(UploadReply(404, "not_found"), account.upload("P1", "track_x.csv", ByteArray(1)))
        server.enqueue(MockResponse.Builder().code(409).body("""{"error":"parts_missing","missing":[2,3],"parts":4}""").build())
        assertEquals(UploadReply(409, "parts_missing", listOf(2, 3)), account.upload("P1", "track_x.csv", ByteArray(1), 4, 4, "ab"))
    }

    @Test fun theHeldPiecesComeFromTheSameAddress() = runTest {
        answer(200, "account.phone-upload.held.json")
        assertEquals(listOf(1, 2), account.held("P3F2A9C41B7E0D865", "track_x.csv"))
        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("/api/account/devices/P3F2A9C41B7E0D865/sessions", req.url.encodedPath)
        assertEquals("track_x.csv", req.url.queryParameter("filename"))
    }

    // End to end against the fixtures: add the phone, the track, then the motion file.
    @Test fun aRecordingFromStopToSent() = runTest {
        File(dir, "track_20261101_070211.csv").writeText("timestamp,lat\n1,2\n")
        File(dir, "track_20261101_070211_i10.csv").writeText("t_ms,ax\n1,0\n")
        answer(201, "account.phone.json")
        answer(201, "account.phone-upload.json")
        answer(201, "account.phone-upload.motion.json")
        assertTrue(PhoneUploader(dir, account, { "install-id-0123456789" }).run())
        assertEquals(listOf("/api/account/devices/phone", "/api/account/devices/P3F2A9C41B7E0D865/sessions", "/api/account/devices/P3F2A9C41B7E0D865/sessions"),
            List(3) { server.takeRequest().url.encodedPath })
        assertEquals(listOf("phone"), dir.list()!!.toList())
    }

    @Test fun tenPhonesIsSaidInTheServersWords() = runTest {
        File(dir, "track_20261101_070211.csv").writeText("timestamp,lat\n1,2\n")
        answer(409, "account.phone.too-many.json")
        assertTrue(PhoneUploader(dir, account, { "install-id-0123456789" }).run())
        val said = Json.parseToJsonElement(fixtures.resolve("account.phone.too-many.json").readText()).jsonObject.getValue("error").jsonPrimitive.content
        assertEquals(listOf(UploadLine.PhoneOff(said)), PhoneUploader.lines(dir, null))
        assertTrue(File(dir, "track_20261101_070211.csv").exists())
    }

    @Test fun aRemovedPhoneKeepsItsRecordings() = runTest {
        File(dir, "track_20261101_070211.csv").writeText("timestamp,lat\n1,2\n")
        File(dir, "phone").writeText("P3F2A9C41B7E0D865")
        answer(404, "account.phone-upload.not-found.json")
        assertTrue(PhoneUploader(dir, account, { "install-id-0123456789" }).run())
        assertEquals(listOf(UploadLine.PhoneOff(null)), PhoneUploader.lines(dir, null))
        assertFalse(File(dir, "phone").exists())
        assertTrue(File(dir, "track_20261101_070211.csv").exists())
    }
}
