package com.paddlesnitch.app.auth

import androidx.test.core.app.ApplicationProvider
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.SignInOptions
import java.io.File
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// Sign in with Google (README § Google): the page it opens, the code it swaps, the
// website's words for each error, and a return this app didn't start doing nothing.
@RunWith(RobolectricTestRunner::class)
class GoogleSignInTest {
    private val server = MockWebServer()
    private val tokens = MemoryTokenStore()
    private val verifiers = object : VerifierStore {
        var kept: String? = null
        override fun put(verifier: String) { kept = verifier }
        override fun take(): String? = kept.also { kept = null }
    }
    private lateinit var api: Api
    private lateinit var google: GoogleSignIn

    @Before fun start() { server.start(); api = Api(server.url("/").toString(), tokens, "0.1.0"); google = GoogleSignIn(api, verifiers) }
    @After fun stop() = server.close()

    private fun fixture(name: String) = File("../../contract/fixtures/api/$name").readText()

    @Test fun opensTheTapFirstPageWithTheChallengeOfTheKeptVerifier() {
        val url = google.start().toHttpUrl()
        assertEquals("/att/api/auth/google/init", url.encodedPath)
        assertEquals(Pkce.challenge(verifiers.kept!!), url.queryParameter("challenge"))
    }

    @Test fun swapsTheCodeAndVerifierAtGoogleAppToken() = runTest {
        google.start()
        val verifier = verifiers.kept
        server.enqueue(MockResponse.Builder().body(fixture("auth.login.json")).build())
        val signedIn = google.finish("the-code", null, strava = false)!!
        val req = server.takeRequest()
        assertEquals("/att/api/auth/google/app-token", req.url.encodedPath)
        assertEquals("""{"code":"the-code","verifier":"$verifier"}""", req.body!!.utf8())
        assertEquals(signedIn.refreshToken, tokens.refreshToken)
        assertNull("a verifier is used once", verifiers.kept)
    }

    @Test fun aSpentCodeSaysTryAgain() = runTest {
        google.start()
        server.enqueue(MockResponse.Builder().code(401).body("""{"error":"Couldn’t finish signing in. Please try again."}""").build())
        val e = runCatching { google.finish("old", null, strava = false) }.exceptionOrNull() as ApiFailure
        assertEquals("Couldn’t sign in with Google. Please try again.", e.message)
    }

    @Test fun eachErrorKeyInTheWebsitesWords() = runTest {
        val said = listOf("google_account_exists", "google_no_email", "google_denied", "google_failed", "google_not_configured", "something_new").map {
            google.start(); (runCatching { google.finish(null, it, strava = false) }.exceptionOrNull() as ApiFailure).message
        }
        assertEquals(listOf(
            "You already have an account with this email. Sign in with your email instead.",
            "Couldn’t sign in with Google, because Google didn’t share a confirmed email address. Please sign up with your email instead.",
            "You cancelled the Google sign-in.",
            "Couldn’t sign in with Google. Please try again.",
            "Google sign-in isn’t available right now.",
            "Couldn’t sign in with Google. Please try again.",
        ), said)
        assertEquals("You already have an account with this email. Sign in with your email or Strava instead.", googleErrorMessage("google_account_exists", strava = true))
        assertEquals(0, server.requestCount)
    }

    @Test fun aReturnThisAppDidntStartIsIgnored() = runTest {
        assertNull(google.finish("someone-elses-code", null, strava = false))
        assertNull(google.finish(null, "google_denied", strava = false))
        assertEquals(0, server.requestCount)
    }

    @Test fun optionsDecodeFromTheContractsFixtures() = runTest {
        server.enqueue(MockResponse.Builder().body(fixture("auth.options.json")).build())
        server.enqueue(MockResponse.Builder().body(fixture("auth.options.email-only.json")).build())
        assertEquals(SignInOptions(google = true, strava = false), api.signInOptions())
        assertEquals(SignInOptions(google = false, strava = false), api.signInOptions())
        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("/att/api/auth/options", req.url.encodedPath)
        assertNull(req.headers["Authorization"])
    }

    @Test fun theStoredVerifierLastsTenMinutes() {
        var clock = 0L
        val store = PrefsTimedVerifierStore(ApplicationProvider.getApplicationContext(), "google-signin-test") { clock }
        store.put("v")
        clock = 9 * 60_000L
        assertTrue(store.pending)
        clock = 10 * 60_000L
        assertFalse(store.pending)
        assertNull(store.take())
    }
}
