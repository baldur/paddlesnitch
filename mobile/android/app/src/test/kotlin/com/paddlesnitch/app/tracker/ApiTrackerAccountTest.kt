package com.paddlesnitch.app.tracker

import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.auth.MemoryTokenStore
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

// The website routes the app calls for tracker setup and sync, as the
// signed-in person: what goes over the wire, and how the answers are read.
class ApiTrackerAccountTest {
    private val server = MockWebServer()
    private val tokens = MemoryTokenStore()
    private lateinit var account: ApiTrackerAccount
    private val about = TrackerAbout("435AC17C", "0.19.3", "lilygo-tbeam-s3-supreme", 2, true)
    private val rec = PendingRecording("track_20261005_061002_i10.csv", "track_20261005_061002_imu.csv", 100)

    @Before fun start() {
        server.start()
        tokens.save("id-1", "r-1")
        account = ApiTrackerAccount(Api(server.url("/").toString(), tokens, "0.1.0"))
    }
    @After fun stop() = server.close()

    private fun answer(code: Int, body: String) = server.enqueue(MockResponse.Builder().code(code).body(body).build())

    @Test fun myTrackersComeFromTheDevicesList() = runTest {
        answer(200, """{"devices":[{"deviceId":"435AC17C","name":"Tracker"},{"deviceId":"435C09C8"}],"stableVersion":"0.19.3"}""")
        assertEquals(setOf("435AC17C", "435C09C8"), account.myTrackerIds())
        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("/api/account/devices", req.url.encodedPath)
        assertEquals("Bearer id-1", req.headers["Authorization"])
    }

    @Test fun linkingSendsTheHashAndSignatureNeverAToken() = runTest {
        answer(200, """{"deviceId":"435AC17C","model":"lilygo-tbeam-s3-supreme"}""")
        val r = account.linkBluetooth("435AC17C", "ab".repeat(32), "c2ln", "lilygo-tbeam-s3-supreme", "0.19.3")
        assertEquals(200, r.status)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/account/devices/link-bluetooth", req.url.encodedPath)
        assertEquals("Bearer id-1", req.headers["Authorization"])
        val body = Json.parseToJsonElement(req.body!!.utf8()).jsonObject
        assertEquals(setOf("deviceId", "tokenHash", "signature", "model", "firmware"), body.keys)
        assertEquals("ab".repeat(32), body.getValue("tokenHash").jsonPrimitive.content)
    }

    @Test fun aRefusedLinkCarriesTheServersCode() = runTest {
        answer(409, """{"error":"owned_elsewhere"}""")
        assertEquals(Reply(409, "owned_elsewhere"), account.linkBluetooth("435AC17C", "ab".repeat(32), "", "m", "f"))
    }

    @Test fun aCompressedPieceGoesUpAsTheTrackerWouldSendIt() = runTest {
        answer(202, """{"part":1,"parts":3,"have":[1]}""")
        val bytes = zlib("ms,ax_g\n1,2".encodeToByteArray())
        assertEquals(Reply(202), account.upload(about, rec, 1, 3, bytes, compressed = true))
        val req = server.takeRequest()
        assertEquals("/api/account/devices/435AC17C/sessions", req.url.encodedPath)
        assertEquals("track_20261005_061002_imu.csv", req.url.queryParameter("filename"))
        assertEquals("1", req.url.queryParameter("part"))
        assertEquals("3", req.url.queryParameter("parts"))
        assertEquals("zlib", req.url.queryParameter("enc"))
        assertEquals("application/octet-stream", req.headers["Content-Type"])
        assertEquals("0.19.3", req.headers["x-device-firmware"])
        assertEquals("lilygo-tbeam-s3-supreme", req.headers["x-device-model"])
        assertArrayEquals(bytes, req.body!!.toByteArray())
    }

    @Test fun aPlainPieceIsCsvAndTheLastAnswerCarriesTheReceipt() = runTest {
        answer(201, """{"sessionId":"s1","receipt":"beef"}""")
        assertEquals(Reply(201, receipt = "beef"), account.upload(about, rec, 1, 1, "a,b".encodeToByteArray(), compressed = false))
        val req = server.takeRequest()
        assertNull(req.url.queryParameter("enc"))
        assertEquals("text/csv", req.headers["Content-Type"]?.substringBefore(";"))
    }

    @Test fun alreadyUploadedIsReadWithItsReceipt() = runTest {
        answer(409, """{"error":"already_uploaded","sessionId":"s1","receipt":"beef"}""")
        assertEquals(Reply(409, "already_uploaded", "beef"), account.upload(about, rec, 1, 1, ByteArray(1), false))
    }

    @Test fun stagedPiecesAreAskedForByName() = runTest {
        answer(200, """{"parts":[1,2,3]}""")
        assertEquals(listOf(1, 2, 3), account.staged(about, rec))
        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("track_20261005_061002_imu.csv", req.url.queryParameter("filename"))
        answer(404, """{"error":"not_found"}""")
        assertEquals(emptyList<Int>(), account.staged(about, rec))
    }

    @Test fun anExpiredTokenIsRefreshedForTrackerCallsToo() = runTest {
        answer(401, """{"error":"Unauthorized"}""")
        answer(200, """{"idToken":"new"}""")
        answer(200, """{"parts":[]}""")
        account.staged(about, rec)
        server.takeRequest()
        assertEquals("/att/api/auth/refresh", server.takeRequest().url.encodedPath)
        assertEquals("Bearer new", server.takeRequest().headers["Authorization"])
    }
}
