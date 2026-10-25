package com.paddlesnitch.app.account

import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.paddlesnitch.app.api.AccountApi
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.AuthUser
import com.paddlesnitch.app.api.Contact
import com.paddlesnitch.app.api.Me
import com.paddlesnitch.app.api.Ok
import com.paddlesnitch.app.api.ProfileSettings
import com.paddlesnitch.app.api.TosAccepted
import com.paddlesnitch.app.api.TosStatus
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The server as the Account screens see it; [calls] records what they asked. */
class FakeAccountApi(
    var email: String = "pat@example.com",
    var profile: ProfileSettings = ProfileSettings(public = false),
    var refuse: String? = null,
) : AccountApi {
    val calls = mutableListOf<String>()
    private fun <T> answer(call: String, value: T): T { calls += call; refuse?.let { throw ApiFailure(it, 400) }; return value }
    override suspend fun me() = Me(AuthUser(id = "u-123", email = email, displayName = "Pat Paddler"))
    override suspend fun terms() = TosStatus("002", false, emptyList())
    override suspend fun acceptTerms() = answer("acceptTerms", TosAccepted(emptyList()))
    override suspend fun profile() = profile
    override suspend fun setProfilePublic(public: Boolean) = answer("public $public", profile.copy(public = public).also { profile = it })
    override suspend fun claimHandle(handle: String) = answer("handle $handle", profile.copy(handle = handle).also { profile = it })
    override suspend fun releaseHandle() = answer("release", profile.copy(handle = null).also { profile = it })
    override suspend fun contact() = Contact(null)
    override suspend fun setContact(email: String) = answer("contact $email", Contact(Contact.Contact(email, "2026-10-25T16:00:00Z")))
    override suspend fun removeContact() = answer("remove contact", Ok(true))
    override suspend fun deleteAccount() { answer("delete", Unit) }
    override suspend fun exportAccount(into: File) = answer("export", "paddlesnitch-export.json")
    override suspend fun signedInPage(next: String) = "https://paddlesnitch.com$next"
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class AccountScreensTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private var deleted = false

    private fun account(api: FakeAccountApi) = compose.setContent {
        PaddlesnitchTheme { Surface(color = PsColor.bg) {
            AccountScreen(api, onBack = {}, onTracker = {}, onSignOut = {}, onSignedOut = {}, onDeleted = { deleted = true })
        } }
    }

    @Test fun yourDetails() {
        account(FakeAccountApi())
        compose.onNodeWithText("pat@example.com").assertExists()
        compose.onNodeWithText("Pat Paddler").assertExists()
        compose.onNodeWithText("u-123").assertExists()
        compose.onNodeWithText("Contact email").assertDoesNotExist() // a real sign-in email needs none
        compose.onRoot().captureRoboImage()
    }

    @Test fun aStravaAccountCanAddAContactEmail() {
        val api = FakeAccountApi(email = "strava-12345@noreply.paddlesnitch.com")
        account(api)
        compose.onNode(hasSetTextAction() and hasText("Contact email")).performTextInput("pat@example.com")
        compose.onAllNodesWithText("Save")[0].performClick() // the contact's; the handle has its own
        compose.waitUntil { "contact pat@example.com" in api.calls }
        compose.onNodeWithText("Saved.").assertExists()
    }

    @Test fun theProfileIsMadePublicWithTheSwitch() {
        val api = FakeAccountApi()
        account(api)
        val row = compose.onNodeWithText("Show my profile to everyone")
        row.assertIsOff()
        row.performClick()
        compose.waitUntil { "public true" in api.calls }
        row.assertIsOn()
        compose.onNodeWithText("View my profile").assertExists()
    }

    @Test fun aHandleTheServerRefusesShowsItsReason() {
        val api = FakeAccountApi(refuse = "That handle is already taken.")
        account(api)
        compose.onNode(hasSetTextAction() and hasText("Profile handle")).performScrollTo().performTextInput("river-pat")
        compose.onAllNodesWithText("Save")[0].performClick()
        compose.waitUntil { compose.onAllNodes(hasText("That handle is already taken.")).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun deletingNeedsDeleteTypedThenSignsOut() {
        val api = FakeAccountApi()
        account(api)
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        val delete = compose.onNodeWithText("Delete for good")
        delete.assertIsNotEnabled()
        compose.onNode(hasSetTextAction() and hasText("Type DELETE to confirm. There is no undo.")).performTextInput("delete")
        delete.assertIsNotEnabled() // exactly DELETE, as the website asks
        compose.onNode(hasSetTextAction() and hasText("Type DELETE to confirm. There is no undo.")).performTextReplacement("DELETE")
        delete.assertIsEnabled()
        compose.onRoot().captureRoboImage()
        delete.performScrollTo().performClick()
        compose.waitUntil { deleted }
        assertEquals(listOf("delete"), api.calls)
    }

    @Test fun aFailedDeleteSaysSoAndKeepsTheAccount() {
        val api = FakeAccountApi(refuse = "Couldn’t delete your account. Please try again.")
        account(api)
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        compose.onNode(hasSetTextAction() and hasText("Type DELETE to confirm. There is no undo.")).performTextInput("DELETE")
        compose.onNodeWithText("Delete for good").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodes(hasText("Couldn’t delete your account. Please try again.")).fetchSemanticsNodes().isNotEmpty() }
        assertFalse(deleted)
    }

    @Test fun downloadMyDataFetchesTheExport() {
        val api = FakeAccountApi()
        account(api)
        compose.onNodeWithText("Download my data").performScrollTo().performClick()
        compose.waitUntil { "export" in api.calls }
    }

    @Test fun termsAreAcceptedOnlyOnceTicked() {
        val api = FakeAccountApi()
        var accepted = false
        compose.setContent { PaddlesnitchTheme { Surface(color = PsColor.bg) { TermsScreen(api, onAccepted = { accepted = true }, onSignedOut = {}) } } }
        val go = compose.onNodeWithText("Continue")
        go.assertIsNotEnabled()
        compose.onNodeWithText("I have read and agree to the Terms of Service and Privacy Policy.").performClick()
        go.assertIsEnabled()
        compose.onRoot().captureRoboImage()
        go.performClick()
        compose.waitUntil { accepted }
        assertTrue("acceptTerms" in api.calls)
    }

    @Test fun termsThatCantBeSavedSaySo() {
        val api = FakeAccountApi(refuse = "That version isn’t current.")
        compose.setContent { PaddlesnitchTheme { Surface(color = PsColor.bg) { TermsScreen(api, onAccepted = {}, onSignedOut = {}) } } }
        compose.onNodeWithText("I have read and agree to the Terms of Service and Privacy Policy.").performClick()
        compose.onNodeWithText("Continue").performClick()
        compose.waitUntil { compose.onAllNodes(hasText("That version isn’t current.")).fetchSemanticsNodes().isNotEmpty() }
    }
}
