package com.paddlesnitch.app.api

import com.paddlesnitch.app.auth.MemoryTokenStore
import java.io.File
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

// The app's calls, against a fake server: what it sends (the app header, the
// Bearer token, tRPC's URL shape) and what it does with each answer.
class ApiTest {
    private val server = MockWebServer()
    private val tokens = MemoryTokenStore()
    private lateinit var api: Api
    private val list = File("../../contract/fixtures/api/paddles.list.json").readText()

    @Before fun start() { server.start(); api = Api(server.url("/").toString(), tokens, "0.1.0") }
    @After fun stop() = server.close()

    private fun answer(code: Int, body: String) = server.enqueue(MockResponse.Builder().code(code).body(body).build())
    private fun trpc(data: String) = answer(200, """{"result":{"data":$data}}""")
    private val signedIn = """{"id":"u1","email":"pat@example.com","displayName":"Pat","needsTerms":false,"idToken":"id-1","refreshToken":"r-1"}"""

    @Test fun signingInKeepsTheTokensAndSaysItIsTheApp() = runTest {
        answer(200, signedIn)
        assertEquals("Pat", api.login("pat@example.com", "Password123").displayName)
        val req = server.takeRequest()
        assertEquals("/att/api/auth/login", req.url.encodedPath)
        assertEquals("android/0.1.0", req.headers["x-paddlesnitch-app"])
        assertTrue(req.body!!.utf8().contains("\"email\":\"pat@example.com\""))
        assertEquals("id-1", tokens.idToken)
        assertEquals("r-1", tokens.refreshToken)
        assertTrue(api.signedIn)
    }

    @Test fun aRefusalCarriesTheServersOwnWords() = runTest {
        answer(401, """{"error":"That email and password don’t match."}""")
        val e = runCatching { api.login("pat@example.com", "nope") }.exceptionOrNull() as ApiFailure
        assertEquals("That email and password don’t match.", e.message)
        assertFalse(api.signedIn)
    }

    @Test fun queriesAreTrpcWithTheBearerToken() = runTest {
        tokens.save("id-1", "r-1")
        trpc(list)
        assertEquals(3, api.paddles().cards.size)
        val req = server.takeRequest()
        assertEquals("/api/trpc/paddles.list", req.url.encodedPath)
        assertEquals("Bearer id-1", req.headers["Authorization"])
    }

    @Test fun oneThingTakesAnInputAsJson() = runTest {
        tokens.save("id-1", "r-1")
        trpc(File("../../contract/fixtures/api/paddles.get.json").readText())
        api.paddle("pdl-river")
        assertEquals("""{"id":"pdl-river"}""", server.takeRequest().url.queryParameter("input"))
    }

    @Test fun aFileIsUploadedLikeTheWebsitesFormWithTheBearerToken() = runTest {
        tokens.save("id-1", "r-1")
        answer(200, """{"id":"pdl-new","distanceKm":4.2,"source":{"type":"file"}}""")
        val added = api.upload("Morning paddle.fit", byteArrayOf(1, 2, 3))
        assertEquals("pdl-new", added.id)
        assertNull(added.duplicate)
        val req = server.takeRequest()
        assertEquals("/paddles/api/analyse", req.url.encodedPath)
        assertEquals("Bearer id-1", req.headers["Authorization"])
        assertTrue(req.headers["Content-Type"]!!.startsWith("multipart/form-data"))
        assertTrue(req.body!!.utf8().contains("""name="file"; filename="Morning paddle.fit""""))
    }

    @Test fun anUploadThatIsAlreadyThereSaysSo() = runTest {
        tokens.save("id-1", "r-1")
        answer(200, """{"id":"pdl-river","duplicate":true}""")
        assertEquals(true, api.upload("a.gpx", byteArrayOf(1)).duplicate)
    }

    @Test fun anUnreadableFileGivesTheServersReason() = runTest {
        tokens.save("id-1", "r-1")
        answer(422, """{"error":"That file has too few GPS points to analyse."}""")
        val e = runCatching { api.upload("a.gpx", byteArrayOf(1)) }.exceptionOrNull() as ApiFailure
        assertEquals("That file has too few GPS points to analyse.", e.message)
    }

    @Test fun aFileOverTheServersLimitSaysWhatToDo() = runTest {
        tokens.save("id-1", "r-1")
        answer(413, "Request Entity Too Large")
        val e = runCatching { api.upload("big.gpx", ByteArray(10)) }.exceptionOrNull() as ApiFailure
        assertEquals(com.paddlesnitch.app.paddles.TOO_BIG, e.message) // the website's words
    }

    @Test fun aPendingSummaryIsWrittenByATrpcMutation() = runTest {
        tokens.save("id-1", "r-1")
        trpc(File("../../contract/fixtures/api/paddles.get.json").readText())
        api.writeSummary("pdl-river")
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/trpc/paddles.writeSummary", req.url.encodedPath)
        assertEquals("""{"id":"pdl-river"}""", req.body!!.utf8())
        assertEquals("Bearer id-1", req.headers["Authorization"])
    }

    @Test fun aWebsitePageOpensSignedInThroughALinkTheServerMakes() = runTest {
        tokens.save("id-1", "r-1")
        answer(200, """{"url":"https://paddlesnitch.com/att/api/auth/web-code?code=abc&next=%2Faccount"}""")
        assertEquals("https://paddlesnitch.com/att/api/auth/web-code?code=abc&next=%2Faccount", api.signedInPage("/account#delete"))
        val req = server.takeRequest()
        assertEquals("/att/api/auth/web-code", req.url.encodedPath)
        assertEquals("Bearer id-1", req.headers["Authorization"])
        assertEquals("""{"next":"/account#delete"}""", req.body!!.utf8())
    }

    @Test fun anExpiredTokenIsRefreshedOnceAndTheCallRetried() = runTest {
        tokens.save("old", "r-1")
        answer(401, """{"error":{"message":"UNAUTHORIZED"}}""")
        answer(200, """{"idToken":"new"}""")
        trpc(list)
        api.paddles()
        server.takeRequest()
        val refresh = server.takeRequest()
        assertEquals("/att/api/auth/refresh", refresh.url.encodedPath)
        assertEquals("""{"refreshToken":"r-1"}""", refresh.body!!.utf8())
        assertEquals("Bearer new", server.takeRequest().headers["Authorization"])
        assertEquals("new", tokens.idToken)
        assertEquals("r-1", tokens.refreshToken)
    }

    @Test fun aRevokedSessionSignsOut() = runTest {
        tokens.save("old", "r-1")
        answer(401, "{}")
        answer(401, """{"error":"Please sign in again."}""")
        assertThrows(SignedOut::class.java) { kotlinx.coroutines.runBlocking { api.paddles() } }
        assertNull(tokens.refreshToken)
    }

    @Test fun signingOutForgetsTheTokensAndRevokesThem() = runTest {
        tokens.save("id-1", "r-1")
        answer(200, """{"ok":true}""")
        api.signOut()
        assertFalse(api.signedIn)
        val req = server.takeRequest()
        assertEquals("/att/api/auth/logout", req.url.encodedPath)
        assertEquals("""{"refreshToken":"r-1"}""", req.body!!.utf8())
    }

    @Test fun noConnectionSaysSoPlainly() = runTest {
        server.close()
        val e = runCatching { api.login("a@b.c", "x") }.exceptionOrNull()
        assertEquals("Couldn’t reach paddlesnitch. Check your connection and try again.", e?.message)
    }
}
