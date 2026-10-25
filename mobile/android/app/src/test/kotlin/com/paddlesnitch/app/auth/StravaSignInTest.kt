package com.paddlesnitch.app.auth

import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiFailure
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

// Strava sign-in: the page it opens, the code it swaps, and what it says when
// Strava sends someone back without one.
class StravaSignInTest {
    private val server = MockWebServer()
    private val tokens = MemoryTokenStore()
    private val verifiers = object : VerifierStore {
        var kept: String? = null
        override fun put(verifier: String) { kept = verifier }
        override fun take(): String? = kept.also { kept = null }
    }
    private lateinit var strava: StravaSignIn

    @Before fun start() { server.start(); strava = StravaSignIn(Api(server.url("/").toString(), tokens, "0.1.0"), verifiers) }
    @After fun stop() = server.close()

    @Test fun pkceMatchesTheRfcExample() =
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))

    @Test fun verifiersAreFreshAndTheRightShape() {
        val a = Pkce.verifier()
        assertTrue(a.matches(Regex("[A-Za-z0-9_-]{43}")))
        assertTrue(a != Pkce.verifier())
    }

    @Test fun opensTheWebsitesStravaFlowWithTheChallengeOfTheKeptVerifier() {
        val url = strava.start().toHttpUrl()
        assertEquals("/att/api/auth/strava/init", url.encodedPath)
        assertEquals(Pkce.challenge(verifiers.kept!!), url.queryParameter("challenge"))
    }

    @Test fun swapsTheCodeAndVerifierForTokens() = runTest {
        strava.start()
        val verifier = verifiers.kept
        server.enqueue(MockResponse.Builder().body("""{"id":"u1","email":"strava-5@noreply.paddlesnitch.com","displayName":"Pat","needsTerms":true,"idToken":"id-1","refreshToken":"r-1"}""").build())
        val signedIn = strava.finish("the-code", null)
        assertEquals(true, signedIn.needsTerms)
        val req = server.takeRequest()
        assertEquals("/att/api/auth/strava/app-token", req.url.encodedPath)
        assertEquals("""{"code":"the-code","verifier":"$verifier"}""", req.body!!.utf8())
        assertEquals("r-1", tokens.refreshToken)
        assertNull("a verifier is used once", verifiers.kept)
    }

    @Test fun cancellingOnStravaSaysSoInTheWebsitesWords() = runTest {
        strava.start()
        val e = runCatching { strava.finish(null, "strava_denied") }.exceptionOrNull() as ApiFailure
        assertEquals("You cancelled the Strava sign-in.", e.message)
        assertNull(verifiers.kept)
    }

    @Test fun aLinkWithoutASignInInProgressAsksToTryAgain() = runTest {
        val e = runCatching { strava.finish("the-code", null) }.exceptionOrNull() as ApiFailure
        assertEquals("Strava sign-in didn’t finish. Please try again.", e.message)
        assertEquals(0, server.requestCount)
    }
}
