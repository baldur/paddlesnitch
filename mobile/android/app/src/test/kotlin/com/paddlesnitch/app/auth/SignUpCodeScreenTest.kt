package com.paddlesnitch.app.auth

import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.isToggleable
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// Create account and sign-in through the emailed code (#702), against a fake server answering with the contract's fixtures.
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

    @After fun stop() = server.close()

    private fun fixture(name: String) = File("../../contract/fixtures/api/$name.json").readText()
    private fun answer(code: Int, body: String) = server.enqueue(MockResponse.Builder().code(code).body(body).build())
    private fun sent() = server.takeRequest().let { it.url.encodedPath to it.body?.utf8().orEmpty() }
    private fun waitFor(text: String) = compose.waitUntil(5_000) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }
    private fun statusShows() = compose.onNodeWithTag("code-status").onChildren()
    private fun errorShows() = compose.onNodeWithTag("code-error").onChildren()
    private val signupBody = """{"email":"pat@example.com","displayName":"Pat","password":"Secret123","acceptedTosVersion":"002"}"""

    private fun show(fontScale: Float = 1f) = compose.setContent {
        CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
            PaddlesnitchTheme { Surface(color = PsColor.bg) { SignInScreen(api, strava, null, onReturnHandled = {},
                google = GoogleSignIn(api, NoVerifiers), googleReturn = null, onGoogleReturnHandled = {},
                onSignedIn = { signedIn += it }, onCancel = {},
                // Not from the server queue, which holds each test's own answers.
                loadOptions = { com.paddlesnitch.app.api.SignInOptions(google = false, strava = true) }) } }
        }
    }

    private fun createAccount(fontScale: Float = 1f) {
        show(fontScale)
        compose.onAllNodes(hasText("Create account"))[0].performClick()
        compose.onNodeWithText("Email").performTextInput("pat@example.com")
        compose.onNodeWithText("Display name").performTextInput("Pat")
        compose.onNodeWithText("Password").performTextInput("Secret123")
        compose.onNode(isToggleable()).performScrollTo().performClick()
        answer(202, fixture("auth.signup"))
        compose.onAllNodes(hasText("Create account"))[2].performScrollTo().performClick()
        waitFor("Confirm your email")
        assertEquals("/att/api/auth/signup" to signupBody, sent())
    }

    private fun signInUnconfirmed() {
        show()
        compose.onNodeWithText("Email").performTextInput("pat@example.com")
        compose.onNodeWithText("Password").performTextInput("Secret123")
        answer(403, fixture("auth.login.needs-code"))
        compose.onAllNodes(hasText("Sign in"))[2].performClick()
        waitFor("Confirm your email")
        sent()
    }

    private fun typeCodeAndConfirm(code: String = "123456") {
        compose.onNodeWithTag("signup-code").performTextInput(code)
        compose.onNodeWithText("Confirm email").performClick()
    }

    @Test fun creatingAnAccountAsksForTheEmailedCodeThenSignsIn() {
        createAccount()
        compose.onNodeWithText("Sign in").assertDoesNotExist() // no tabs during the code step
        compose.onNodeWithTag("signup-code").assertIsFocused()
        compose.onRoot().captureRoboImage()
        answer(201, fixture("auth.login"))
        typeCodeAndConfirm("12a3456789") // digits only, six at most
        compose.waitUntil(5_000) { signedIn.isNotEmpty() }
        assertEquals("/att/api/auth/signup/confirm" to """{"email":"pat@example.com","code":"123456","password":"Secret123","acceptedTosVersion":"002"}""", sent())
    }

    @Test fun theCodeStepAtTheLargestText() {
        createAccount(fontScale = 2f)
        compose.onRoot().captureRoboImage()
    }

    @Test fun aWrongCodeIsAnErrorAndStaysOnTheCode() {
        createAccount()
        answer(400, """{"error":"That code is not valid. Check your email and try again."}""")
        typeCodeAndConfirm("000000")
        waitFor("That code is not valid. Check your email and try again.")
        errorShows().assertCountEquals(1)
        statusShows().assertCountEquals(0)
        compose.onNodeWithText("Confirm your email").assertExists()
        assertTrue(signedIn.isEmpty())
    }

    @Test fun aNewCodeRepeatsTheSignUpThenPausesThirtySeconds() {
        createAccount()
        compose.onNodeWithText("Send a new code").assertIsNotEnabled() // the first code has only just gone
        compose.mainClock.advanceTimeBy(30_000)
        compose.onNodeWithText("Send a new code").assertIsEnabled()
        answer(202, fixture("auth.signup"))
        compose.onNodeWithText("Send a new code").performClick()
        waitFor(NEW_CODE_SENT)
        assertEquals("/att/api/auth/signup" to signupBody, sent()) // the same sign-up, name and Terms included
        compose.onNodeWithText("Send a new code").assertIsNotEnabled()
        compose.onNodeWithTag("signup-code").assertIsFocused()
    }

    @Test fun tooManyCodesIsAnErrorAndDoesNotRestartThePause() {
        createAccount()
        compose.mainClock.advanceTimeBy(30_000)
        answer(429, fixture("auth.too-many-codes"))
        compose.onNodeWithText("Send a new code").performClick()
        waitFor("We’ve sent this email too many codes. Please wait an hour and try again.")
        errorShows().assertCountEquals(1)
        statusShows().assertCountEquals(0)
        compose.onNodeWithText("Send a new code").assertIsEnabled()
    }

    @Test fun signingInBeforeTheCodeShowsAStatusAndPauses() {
        signInUnconfirmed()
        waitFor("Confirm your email first. We’ve sent you a new code.")
        statusShows().assertCountEquals(1) // a status, not an error
        errorShows().assertCountEquals(0)
        compose.onNodeWithText("Send a new code").assertIsNotEnabled()
        compose.mainClock.advanceTimeBy(30_000)
        answer(403, fixture("auth.login.needs-code"))
        compose.onNodeWithText("Send a new code").performClick()
        waitFor(NEW_CODE_SENT)
        assertEquals("/att/api/auth/login" to """{"email":"pat@example.com","password":"Secret123"}""", sent())
    }

    @Test fun fromSignInTheCodeGoesWithoutTheTermsAndNeedsTermsIsFollowed() {
        signInUnconfirmed()
        answer(201, fixture("auth.login.needs-terms"))
        typeCodeAndConfirm()
        compose.waitUntil(5_000) { signedIn.isNotEmpty() }
        assertFalse(sent().second.contains("acceptedTosVersion"))
        assertEquals(true, signedIn.single().needsTerms)
    }

    @Test fun aNewCodeRequestThatFindsTheAccountConfirmedSignsIn() {
        signInUnconfirmed()
        compose.mainClock.advanceTimeBy(30_000)
        answer(200, fixture("auth.login"))
        compose.onNodeWithText("Send a new code").performClick()
        compose.waitUntil(5_000) { signedIn.isNotEmpty() }
    }

    @Test fun confirmedButNotSignedInGoesToSignInWithThePasswordReady() {
        createAccount()
        answer(500, """{"error":"Your email is confirmed. Please sign in."}""")
        typeCodeAndConfirm()
        waitFor("Your email is confirmed. Please sign in.")
        compose.onNode(hasText("Sign in") and isSelectable()).assertIsSelected()
        compose.onNode(hasText("Password") and hasSetTextAction()).assertIsFocused()
    }

    @Test fun changeEmailGoesBackToTheEmail() {
        createAccount()
        compose.onNodeWithText("Change email").performClick()
        compose.onNodeWithText("Display name").assertExists()
        compose.onNodeWithText("Confirm your email").assertDoesNotExist()
        compose.onNode(hasText("Email") and hasSetTextAction()).assertIsFocused()
    }
}

private object NoVerifiers : VerifierStore {
    override fun put(verifier: String) {}
    override fun take(): String? = null
}
