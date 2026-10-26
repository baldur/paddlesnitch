package com.paddlesnitch.app.auth

import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.Density
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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// Forgot password in the app, against a fake server answering with the contract's fixtures.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class ForgotPasswordScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val server = MockWebServer().apply { start() }
    private val api = Api(server.url("/").toString(), MemoryTokenStore(), "0.1.0")
    private val did = mutableListOf<String>()
    private var signedIn: SignIn? = null

    @After fun stop() = server.close()

    private fun fixture(name: String) = File("../../contract/fixtures/api/$name.json").readText()
    private fun answer(code: Int, body: String) = server.enqueue(MockResponse.Builder().code(code).body(body).build())
    private fun waitFor(text: String) = compose.waitUntil(5_000) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun show(email: String = "pat@example.com", fontScale: Float = 1f) = compose.setContent {
        CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
            PaddlesnitchTheme {
                Surface(color = PsColor.bg) {
                    ForgotPasswordScreen(api, email, onSignedIn = { signedIn = it }, onPasswordSet = { did += "set $it" }, onBack = { did += "back" })
                }
            }
        }
    }

    private fun sendCode() {
        answer(200, """{"ok":true}""")
        compose.onNodeWithText("Send code").performClick()
        waitFor("Set a new password")
        assertEquals("/att/api/auth/password-reset/request", server.takeRequest().url.encodedPath)
    }

    private fun enterCodeAndPassword() {
        compose.onNodeWithTag("reset-code").performTextInput("12a3456")
        compose.onNodeWithTag("reset-password").performTextInput("Secret123")
        compose.onNodeWithText("Reset password").performScrollTo().performClick()
    }

    @Test fun theEmailTypedOnSignInIsFilledIn() {
        show()
        compose.onNode(hasText("pat@example.com") and hasSetTextAction()).assertExists()
        compose.onRoot().captureRoboImage()
    }

    @Test fun theCodeAndANewPasswordSignIn() {
        show()
        sendCode()
        compose.onNodeWithTag("reset-code").assertIsFocused()
        compose.onRoot().captureRoboImage()
        answer(200, fixture("auth.password-reset-confirm"))
        answer(200, """{"result":{"data":${fixture("me.signed-in")}}}""")
        enterCodeAndPassword()
        compose.waitUntil(5_000) { signedIn != null }
        assertEquals("""{"email":"pat@example.com","code":"123456","password":"Secret123"}""", server.takeRequest().body?.utf8())
        assertEquals("user-1", signedIn!!.id)
    }

    @Test fun setButNotSignedInGoesBackToSignInWithTheEmail() {
        show()
        sendCode()
        answer(200, """{"ok":true,"signedIn":false}""")
        enterCodeAndPassword()
        compose.waitUntil(5_000) { did.isNotEmpty() }
        assertEquals(listOf("set pat@example.com"), did)
    }

    @Test fun aWrongCodeSaysWhyAndStays() {
        show()
        sendCode()
        answer(400, """{"error":"That code is wrong or has expired. Request a new one."}""")
        enterCodeAndPassword()
        waitFor("That code is wrong or has expired. Request a new one.")
        compose.onNodeWithTag("reset-error").onChildren().assertCountEquals(1)
        compose.onNodeWithText("Set a new password").assertExists()
        assertTrue(signedIn == null)
    }

    @Test fun requestAnotherGoesBackToTheEmail() {
        show()
        sendCode()
        compose.onNodeWithText("Didn’t get a code? Request another").performScrollTo().performClick()
        compose.onNodeWithText("Send code").assertExists()
        compose.onNodeWithTag("reset-code").assertDoesNotExist()
    }

    @Test fun aRequestTheServerRefusesSaysSo() {
        show()
        answer(500, "")
        compose.onNodeWithText("Send code").performClick()
        waitFor("Couldn’t send the reset code. Please try again.")
        compose.onNodeWithText("Reset your password").assertExists()
    }

    @Test fun atTheLargestText() {
        show(fontScale = 2f)
        sendCode()
        compose.onRoot().captureRoboImage()
    }
}
