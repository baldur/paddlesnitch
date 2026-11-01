package com.paddlesnitch.app.auth

import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.assertCountEquals
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.SignIn
import com.paddlesnitch.app.api.SignInOptions
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import java.io.File
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// Back from Google on the sign-in screen: signed in, an error in the right words, or nothing
// at all when this app didn't start it.
@RunWith(RobolectricTestRunner::class)
class GoogleReturnScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val server = MockWebServer()
    private lateinit var api: Api
    private val verifiers = object : VerifierStore {
        var v: String? = null
        override fun put(verifier: String) { v = verifier }
        override fun take() = v.also { v = null }
    }
    private val signedIn = mutableListOf<SignIn>()
    private var handled = 0

    @Before fun start() { server.start(); api = Api(server.url("/").toString(), MemoryTokenStore(), "0.1.0") }
    @After fun stop() = server.close()

    private fun show(back: String, options: suspend () -> SignInOptions = { SignInOptions(google = true, strava = false) }) = compose.setContent {
        PaddlesnitchTheme { Surface(color = PsColor.bg) {
            SignInScreen(api, google = GoogleSignIn(api, verifiers),
                googleReturn = Uri.parse(back), onGoogleReturnHandled = { handled++ }, onSignedIn = { signedIn += it }, onCancel = {},
                loadOptions = options)
        } }
    }
    private fun waitFor(text: String) = compose.waitUntil(5_000) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    @Test fun aCodeSignsIn() {
        verifiers.put("v-1")
        server.enqueue(MockResponse.Builder().body(File("../../contract/fixtures/api/auth.login.json").readText()).build())
        show("com.paddlesnitch.app:/signin/google?code=abc")
        compose.waitUntil(5_000) { signedIn.isNotEmpty() }
        assertEquals("/att/api/auth/google/app-token", server.takeRequest().url.encodedPath)
        compose.waitUntil { handled == 1 }
    }

    @Test fun withNoGoogleSignInStartedNothingHappens() {
        show("com.paddlesnitch.app:/signin/google?code=abc")
        compose.waitUntil { handled == 1 }
        assertEquals(0, server.requestCount)
        assertEquals(emptyList<SignIn>(), signedIn)
        compose.onNodeWithTag("signin-error").onChildren().assertCountEquals(0)
    }

    // Strava is gone: an older server's strava: true never brings it back into the words.
    @Test fun theErrorNeverOffersStrava() {
        verifiers.put("v-1")
        show("com.paddlesnitch.app:/signin/google?error=google_account_exists", { SignInOptions(google = true, strava = true) })
        waitFor("You already have an account with this email. Sign in with your email instead.")
    }
}
