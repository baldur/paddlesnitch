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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
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
    private fun show(reauth: Reauth, email: String?, options: SignInOptions? = SignInOptions(google = false, strava = true), googleReturn: Uri? = null, fontScale: Float = 1f) = compose.setContent {
        CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) { PaddlesnitchTheme { androidx.compose.material3.Surface(color = com.paddlesnitch.app.ui.PsColor.bg) {
            SignInScreen(api, strava, null, onReturnHandled = {}, google = google, googleReturn = googleReturn, onGoogleReturnHandled = {},
                onSignedIn = {}, onCancel = {},
                prefillEmail = email, notice = reauth.notice, startStrava = reauth.signingInAgain && reauth.strava, onForgot = { forgot = it },
                loadOptions = { options ?: throw ApiFailure("x", 500, generic = true) })
        } } }
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
        compose.onNodeWithText("Signed up with Strava? Strava sign-in is off for now. Email us and we’ll help you sign in.").assertExists()
        compose.onRoot().captureRoboImage()
        // Email, not the public issue form.
        compose.onNodeWithText("Email us").performScrollTo().performClick()
        val sent = Shadows.shadowOf(compose.activity).nextStartedActivity
        assertEquals(android.content.Intent.ACTION_SENDTO, sent.action)
        assertEquals("mailto:privacy@paddlesnitch.com?subject=Signing%20in%20without%20Strava", sent.data.toString())
    }

    @Test fun stravaOffAtTheLargestText() {
        show(Reauth(), null, SignInOptions(google = true, strava = false), fontScale = 2f)
        waitFor("Email us")
        compose.onNodeWithText("Email us").performScrollTo()
        compose.onRoot().captureRoboImage()
    }

    @Test fun bothOnShowsBoth() {
        show(Reauth(), null, SignInOptions(google = true, strava = true))
        waitFor("Or use your Google or Strava account")
        compose.onNodeWithContentDescription("Connect with Strava").assertExists()
        compose.onNodeWithText("Email us").assertDoesNotExist()
    }

    @Test fun whenOptionsFailItSaysSoAndCanAskAgain() {
        var answer: SignInOptions? = null
        compose.setContent {
            PaddlesnitchTheme {
                SignInScreen(api, strava, null, onReturnHandled = {}, google = google, googleReturn = null, onGoogleReturnHandled = {},
                    onSignedIn = {}, onCancel = {}, loadOptions = { answer ?: throw ApiFailure("x", 500, generic = true) })
            }
        }
        waitFor("Couldn’t load the other ways to sign in.")
        compose.onNodeWithText("Sign in with Google").assertDoesNotExist()
        compose.onNodeWithContentDescription("Connect with Strava").assertDoesNotExist()
        answer = SignInOptions(google = false, strava = false)
        compose.onNodeWithText("Try again").performScrollTo().performClick()
        waitFor("Email us") // the way out for an account made with Strava
        compose.onNodeWithText("Couldn’t load the other ways to sign in.").assertDoesNotExist()
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
