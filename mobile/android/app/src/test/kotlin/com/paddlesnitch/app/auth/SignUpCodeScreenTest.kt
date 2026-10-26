package com.paddlesnitch.app.auth

import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.SignIn
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import java.io.File
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// Create account and sign-in through the emailed code (#702), against a fake server.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class SignUpCodeScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val server = MockWebServer().apply { start() }
    private val api = Api(server.url("/").toString(), MemoryTokenStore(), "0.1.0")
    private val strava = StravaSignIn(api, object : VerifierStore {
        override fun put(verifier: String) {}
        override fun take(): String? = null
    })
    private val signedIn = mutableListOf<SignIn>()
    private val signedInBody = File("../../contract/fixtures/api/auth.login.json").readText()

    @After fun stop() = server.close()

    private fun answer(code: Int, body: String) = server.enqueue(MockResponse.Builder().code(code).body(body).build())
    private fun sent() = server.takeRequest().let { it.url.encodedPath to it.body?.utf8().orEmpty() }
    private fun waitFor(text: String) = compose.waitUntil(5_000) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun show() = compose.setContent {
        PaddlesnitchTheme { Surface(color = PsColor.bg) { SignInScreen(api, strava, null, onReturnHandled = {}, onSignedIn = { signedIn += it }, onCancel = {}) } }
    }

    private fun createAccount() {
        show()
        compose.onNodeWithText("Create account", useUnmergedTree = true).let { compose.onAllNodes(hasText("Create account"))[0].performClick() }
        compose.onNodeWithText("Email").performTextInput("pat@example.com")
        compose.onNodeWithText("Display name").performTextInput("Pat")
        compose.onNodeWithText("Password").performTextInput("Secret123")
        compose.onNode(androidx.compose.ui.test.isToggleable()).performClick()
        answer(202, """{"needsCode":true,"email":"pat@example.com"}""")
        compose.onAllNodes(hasText("Create account"))[2].performScrollTo().performClick()
        waitFor("Confirm your email")
        sent()
    }

    @Test fun creatingAnAccountAsksForTheEmailedCodeThenSignsIn() {
        createAccount()
        compose.onNodeWithText("Sign in").assertDoesNotExist() // no tabs during the code step
        compose.onRoot().captureRoboImage()
        compose.onNodeWithTag("signup-code").performTextInput("12a3456789") // digits only, six at most
        answer(201, signedInBody)
        compose.onNodeWithText("Confirm email").performClick()
        compose.waitUntil(5_000) { signedIn.isNotEmpty() }
        assertEquals("/att/api/auth/signup/confirm" to """{"email":"pat@example.com","code":"123456","password":"Secret123","acceptedTosVersion":"002"}""", sent())
    }

    @Test fun aWrongCodeSaysSoAndStaysOnTheCode() {
        createAccount()
        compose.onNodeWithTag("signup-code").performTextInput("000000")
        answer(400, """{"error":"That code is wrong or has expired."}""")
        compose.onNodeWithText("Confirm email").performClick()
        waitFor("That code is wrong or has expired.")
        compose.onNodeWithText("Confirm your email").assertExists()
        assertTrue(signedIn.isEmpty())
    }

    @Test fun aNewCodeRepeatsTheSignUpThenPausesThirtySeconds() {
        createAccount()
        compose.onNodeWithText("Send a new code").assertIsNotEnabled() // the first code has only just gone
        compose.mainClock.advanceTimeBy(30_000)
        val again = compose.onNodeWithText("Send a new code")
        again.assertIsEnabled()
        answer(202, """{"needsCode":true,"email":"pat@example.com"}""")
        again.performClick()
        waitFor("We’ve sent a new code. You can ask for another in 30 seconds.")
        assertEquals("/att/api/auth/signup", sent().first)
        compose.onNodeWithText("Send a new code").assertIsNotEnabled()
    }

    @Test fun signingInBeforeTheCodeAsksForItWithoutTheTerms() {
        show()
        compose.onNodeWithText("Email").performTextInput("pat@example.com")
        compose.onNodeWithText("Password").performTextInput("Secret123")
        answer(403, """{"error":"We’ve sent a code to your email. Enter it to finish creating your account.","needsCode":true}""")
        compose.onAllNodes(hasText("Sign in"))[2].performClick()
        waitFor("We’ve sent a code to your email. Enter it to finish creating your account.") // a status, not an error
        sent()
        compose.onNodeWithTag("signup-code").performTextInput("123456")
        answer(201, signedInBody)
        compose.onNodeWithText("Confirm email").performClick()
        compose.waitUntil(5_000) { signedIn.isNotEmpty() }
        assertFalse(sent().second.contains("acceptedTosVersion"))
    }

    @Test fun changeEmailGoesBackToTheForm() {
        createAccount()
        compose.onNodeWithText("Change email").performClick()
        compose.onNodeWithText("Display name").assertExists()
        compose.onNodeWithText("Confirm your email").assertDoesNotExist()
    }
}
