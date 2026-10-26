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
class SignInScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val api = Api("http://localhost/", MemoryTokenStore(), "0.1.0")
    private val strava = StravaSignIn(api, object : VerifierStore {
        var v: String? = null
        override fun put(verifier: String) { v = verifier }
        override fun take() = v.also { v = null }
    })

    private var forgot: String? = null
    private fun show(reauth: Reauth, email: String?) = compose.setContent {
        PaddlesnitchTheme {
            SignInScreen(api, strava, null, onReturnHandled = {}, onSignedIn = {}, onCancel = {},
                prefillEmail = email, notice = reauth.notice, startStrava = reauth.signingInAgain && reauth.strava, onForgot = { forgot = it })
        }
    }

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
}
