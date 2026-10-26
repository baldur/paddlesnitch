package com.paddlesnitch.app.auth

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.assertEquals
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onNodeWithText
import com.paddlesnitch.app.Reauth
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.SignInOptions
import android.net.Uri
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows

// Signing in again to delete the account: the sign-in screen says why and fills in the email.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class SignInScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val api = Api("http://localhost/", MemoryTokenStore(), "0.1.0")
    private val strava = StravaSignIn(api, object : VerifierStore {
        var v: String? = null
        override fun put(verifier: String) { v = verifier }
        override fun take() = v.also { v = null }
    })

    private val googleVerifiers = object : VerifierStore {
        var v: String? = null
        override fun put(verifier: String) { v = verifier }
        override fun take() = v.also { v = null }
    }
    private val google = GoogleSignIn(api, googleVerifiers)

    private var forgot: String? = null
    private fun show(reauth: Reauth, email: String?, options: SignInOptions? = SignInOptions(google = false, strava = true), googleReturn: Uri? = null) = compose.setContent {
        PaddlesnitchTheme { androidx.compose.material3.Surface(color = com.paddlesnitch.app.ui.PsColor.bg) {
            SignInScreen(api, strava, null, onReturnHandled = {}, google = google, googleReturn = googleReturn, onGoogleReturnHandled = {},
                onSignedIn = {}, onCancel = {},
                prefillEmail = email, notice = reauth.notice, startStrava = reauth.signingInAgain && reauth.strava, onForgot = { forgot = it },
                loadOptions = { options ?: throw ApiFailure("x", 500, generic = true) })
        } }
    }
    private fun waitFor(text: String) = compose.waitUntil { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    @Test fun theEmailIsFilledInAndTheReasonShown() {
        val reauth = Reauth().start("u-1", strava = false)
        show(reauth, "pat@example.com")
        compose.onNodeWithText(reauth.notice!!).assertIsDisplayed()
        compose.onNode(hasSetTextAction() and hasText("pat@example.com")).assertExists()
    }

    @Test fun aStravaAccountGoesStraightToStravaOnce() {
        show(Reauth().start("u-1", strava = true), null)
        compose.waitForIdle()
        val shadow = Shadows.shadowOf(compose.activity)
        assertTrue(shadow.nextStartedActivity.data.toString().startsWith("http://localhost/att/api/auth/strava/init"))
    }

    @Test fun anOrdinarySignInDoesNotOpenStrava() {
        show(Reauth(), null)
        compose.waitForIdle()
        assertNull(Shadows.shadowOf(compose.activity).nextStartedActivity)
    }

    @Test fun forgotPasswordTakesTheEmailTypedSoFar() {
        show(Reauth(), null)
        compose.onNode(hasText("Email") and hasSetTextAction()).performTextInput(" pat@example.com ")
        compose.onNodeWithText("Forgot password?").performScrollTo().performClick()
        assertEquals("pat@example.com", forgot)
    }

    // Google and Strava as the server says (README § Google, "When strava is false").
    @Test fun googleOnStravaOffShowsGoogleAndAWayOutForStravaAccounts() {
        show(Reauth(), null, SignInOptions(google = true, strava = false))
        waitFor("Sign in with Google")
        compose.onNodeWithText("Or use your Google account").assertExists()
        compose.onNodeWithContentDescription("Connect with Strava").assertDoesNotExist()
        compose.onNodeWithText("Signed up with Strava? Strava sign-in is off for now. Report an issue and we’ll help you sign in.").assertExists()
        compose.onRoot().captureRoboImage()
        compose.onNodeWithText("Report an issue").performScrollTo().performClick()
        assertEquals("${com.paddlesnitch.app.BuildConfig.API_BASE_URL}/signin?report=1", Shadows.shadowOf(compose.activity).nextStartedActivity.data.toString())
    }

    @Test fun bothOnShowsBoth() {
        show(Reauth(), null, SignInOptions(google = true, strava = true))
        waitFor("Or use your Google or Strava account")
        compose.onNodeWithContentDescription("Connect with Strava").assertExists()
        compose.onNodeWithText("Report an issue").assertDoesNotExist()
    }

    @Test fun whenOptionsFailItIsEmailOnly() {
        show(Reauth(), null, null)
        compose.waitForIdle()
        compose.onNodeWithText("Sign in with Google").assertDoesNotExist()
        compose.onNodeWithContentDescription("Connect with Strava").assertDoesNotExist()
        compose.onNodeWithText("Report an issue").assertDoesNotExist()
    }

    @Test fun signInWithGoogleOpensTheTapFirstPageWithTheKeptVerifiersChallenge() {
        show(Reauth(), null, SignInOptions(google = true, strava = false))
        waitFor("Sign in with Google")
        compose.onNodeWithText("Sign in with Google").performScrollTo().performClick()
        val opened = Shadows.shadowOf(compose.activity).nextStartedActivity.data
        assertEquals("/att/api/auth/google/init", opened!!.path)
        assertEquals(Pkce.challenge(googleVerifiers.v!!), opened.getQueryParameter("challenge"))
    }

    @Test fun aGoogleErrorShowsInTheWebsitesWords() {
        googleVerifiers.put("v-1")
        show(Reauth(), null, SignInOptions(google = true, strava = false), googleReturn = Uri.parse("com.paddlesnitch.app:/signin/google?error=google_account_exists"))
        waitFor("You already have an account with this email. Sign in with your email instead.")
    }
}
