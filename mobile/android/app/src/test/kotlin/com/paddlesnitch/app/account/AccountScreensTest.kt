package com.paddlesnitch.app.account

import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import org.robolectric.Shadows
import com.paddlesnitch.app.api.SignInOptions
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.Density
import androidx.core.app.ActivityOptionsCompat
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.paddlesnitch.app.Reauth
import com.paddlesnitch.app.api.AccountApi
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.Recording
import com.paddlesnitch.app.api.RecordingList
import com.paddlesnitch.app.api.TrackerList
import com.paddlesnitch.app.api.AccountStatus
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.AuthUser
import com.paddlesnitch.app.api.Contact
import com.paddlesnitch.app.api.Me
import com.paddlesnitch.app.api.Ok
import com.paddlesnitch.app.api.ProfileSettings
import com.paddlesnitch.app.api.SignedOut
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
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The server as the Account screens see it; [calls] records what they asked. */
class FakeAccountApi(
    var email: String = "pat@example.com",
    var profile: ProfileSettings = ProfileSettings(public = false),
    var contactEmail: String? = null,
    /** The account was made through Strava: the server's Contact.placeholderEmail. */
    var madeWithStrava: Boolean = false,
    /** GET /api/account/contact fails. */
    var failContact: Boolean = false,
    /** Every action fails with these words (an ApiFailure from the server). */
    var refuse: String? = null,
    /** Loading the profile fails, until set back to false. */
    var failLoads: Boolean = false,
    /** The session has ended: every call says so. */
    var signedOut: Boolean = false,
    /** The sign-in is from the last 10 minutes (GET /api/account). */
    var recentSignIn: Boolean = true,
    /** Delete answers 403 {reauth: true}: the 10 minutes ran out while they typed. */
    var reauthOnDelete: Boolean = false,
    /** The recent-sign-in check fails. */
    var failStatus: Boolean = false,
    var trackerList: TrackerList = ApiJson.decodeFromString(TrackerList.serializer(), java.io.File("../../contract/fixtures/api/account.devices.json").readText()),
    var recordingList: List<Recording> = emptyList(),
    var failTrackers: Boolean = false,
    /** Which sign-ins the server has on; null = the call fails. */
    var options: SignInOptions? = SignInOptions(google = true, strava = true),
) : AccountApi {
    val calls = mutableListOf<String>()
    private fun check() { if (signedOut) throw SignedOut() }
    private fun <T> answer(call: String, value: () -> T): T { check(); calls += call; refuse?.let { throw ApiFailure(it, 400) }; return value() }
    private fun <T> load(value: () -> T): T { check(); if (failLoads) throw ApiFailure("x", 500, generic = true); return value() }
    override suspend fun me(): Me { check(); return Me(AuthUser(id = "u-123", email = email, displayName = "Pat Paddler")) }
    override suspend fun signInOptions() = options ?: throw ApiFailure("x", 500, generic = true)
    override suspend fun terms() = TosStatus("002", false, emptyList())
    override suspend fun acceptTerms() = answer("acceptTerms") { TosAccepted(emptyList()) }
    override suspend fun profile() = load { profile }
    override suspend fun setProfilePublic(public: Boolean) = answer("public $public") { profile.copy(public = public).also { profile = it } }
    override suspend fun claimHandle(handle: String) = answer("handle $handle") { profile.copy(handle = handle).also { profile = it } }
    override suspend fun releaseHandle() = answer("release") { profile.copy(handle = null).also { profile = it } }
    override suspend fun contact(): Contact {
        check(); if (failContact) throw ApiFailure("x", 500, generic = true)
        return Contact(contactEmail?.let { Contact.Contact(it, "2026-10-25T16:00:00Z") }, placeholderEmail = madeWithStrava)
    }
    override suspend fun setContact(email: String) = answer("contact $email") { contactEmail = email; Contact(Contact.Contact(email, "2026-10-25T16:00:00Z"), placeholderEmail = madeWithStrava) }
    override suspend fun removeContact() = answer("remove contact") { contactEmail = null; Ok(true) }
    override suspend fun accountStatus(): AccountStatus {
        check(); calls += "status"
        if (failStatus) throw ApiFailure("x", 500, generic = true)
        return AccountStatus(recentSignIn)
    }
    override suspend fun deleteAccount() {
        answer("delete") {}
        if (reauthOnDelete) throw ApiFailure("For your safety, deleting your account needs a recent sign-in. Please sign in again.", 403, reauth = true)
    }
    override suspend fun exportAccount(into: File) = answer("export") { into.writeText("""{"account":{}}"""); "paddlesnitch-export-2026-10-25.json" }
    override suspend fun signedInPage(next: String) = "https://paddlesnitch.com$next"
    override suspend fun trackers(): TrackerList { check(); calls += "trackers"; if (failTrackers) throw ApiFailure("x", 500, generic = true); return trackerList }
    var failRecordings: Boolean = false
    override suspend fun recordings(): RecordingList { check(); if (failRecordings) throw ApiFailure("x", 500, generic = true); return RecordingList(recordingList) }
    override suspend fun removeTracker(deviceId: String) = answer("remove $deviceId") { Ok(true) }
}

/** Answers the system save dialog: records the name it was opened with, then picks [pick] (null = cancelled). */
class FakeSaveDialog(var pick: Uri?) : ActivityResultRegistry() {
    val opened = mutableListOf<Any?>()
    override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) {
        opened += input
        dispatchResult(requestCode, pick)
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class AccountScreensTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val tmp = TemporaryFolder()
    private val did = mutableListOf<String>()

    private fun show(fontScale: Float = 1f, saveDialog: FakeSaveDialog = FakeSaveDialog(null), content: @Composable () -> Unit) = compose.setContent {
        val owner = object : ActivityResultRegistryOwner { override val activityResultRegistry = saveDialog }
        CompositionLocalProvider(LocalActivityResultRegistryOwner provides owner, LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
            PaddlesnitchTheme { Surface(color = PsColor.bg) { content() } }
        }
    }
    private fun account(
        api: FakeAccountApi, fontScale: Float = 1f, saveDialog: FakeSaveDialog = FakeSaveDialog(null), resumeDelete: Boolean = false,
        resume: Reauth.After? = if (resumeDelete) Reauth.After.Delete else null,
    ) = show(fontScale, saveDialog) {
        AccountScreen(api, onBack = {}, onTracker = {}, onTrackers = { did += "trackers" }, onSignOut = { did += "sign out" }, onSignedOut = { did += "signed out" }, onDeleted = { did += "deleted" },
            resume = resume, onResumed = { did += "resumed" },
            onSignInAgain = { id, email, _ -> did += "sign in again $id $email" })
    }
    private fun waitFor(text: String) = compose.waitUntil { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    @Test fun yourDetails() {
        account(FakeAccountApi())
        waitFor("pat@example.com")
        compose.onNodeWithText("Pat Paddler").assertExists()
        compose.onNodeWithText("u-123").assertExists()
        compose.onNodeWithText("Contact email").assertDoesNotExist() // a real sign-in email needs none
        compose.onRoot().captureRoboImage()
    }

    @Test fun atTheLargestText() {
        account(FakeAccountApi(email = "strava-12345@noreply.paddlesnitch.com", madeWithStrava = true), fontScale = 2f)
        waitFor("Contact email")
        compose.onRoot().captureRoboImage()
    }

    @Test fun aSessionThatHasEndedGoesBackToSigningIn() {
        account(FakeAccountApi(signedOut = true))
        compose.waitUntil { did == listOf("signed out") }
    }

    @Test fun aSessionThatEndsDuringAnActionGoesBackToSigningIn() {
        val api = FakeAccountApi()
        account(api)
        waitFor("Show my profile to everyone")
        api.signedOut = true
        compose.onNodeWithText("Show my profile to everyone").performClick()
        compose.waitUntil { did == listOf("signed out") }
    }

    @Test fun anAccountMadeWithStravaCanAddThenRemoveAContactEmail() {
        val api = FakeAccountApi(email = "strava-12345@noreply.paddlesnitch.com", madeWithStrava = true)
        account(api)
        waitFor("Contact email")
        compose.onNode(hasSetTextAction() and hasText("Contact email")).performTextInput("pat@example.com")
        compose.onNodeWithTag("contact-save").performClick()
        compose.waitUntil { "contact pat@example.com" in api.calls }
        compose.onNodeWithTag("contact-message").onChildren()[0].assertTextEquals("Saved.")
        compose.onNodeWithTag("contact-save").assertTextEquals("Update")
        compose.onNodeWithTag("contact-remove").performClick()
        compose.waitUntil { "remove contact" in api.calls }
        compose.onNodeWithTag("contact-message").onChildren()[0].assertTextEquals("Removed.")
    }

    @Test fun theProfileIsMadePublicAndPrivateWithTheSwitch() {
        val api = FakeAccountApi()
        account(api)
        waitFor("Show my profile to everyone")
        val row = compose.onNodeWithText("Show my profile to everyone")
        row.assertIsOff()
        row.performClick()
        compose.waitUntil { "public true" in api.calls }
        row.assertIsOn()
        compose.onNodeWithText("View my profile ↗").assertExists()
        row.performClick()
        compose.waitUntil { "public false" in api.calls }
        row.assertIsOff()
    }

    @Test fun aHandleIsSavedThenRemoved() {
        val api = FakeAccountApi()
        account(api)
        waitFor("Profile handle")
        compose.onNode(hasSetTextAction() and hasText("Profile handle")).performScrollTo().performTextInput("river-pat")
        compose.onNodeWithTag("handle-save").performClick()
        compose.waitUntil { "handle river-pat" in api.calls }
        compose.onNodeWithTag("handle-save").assertTextEquals("Change")
        compose.onNodeWithTag("handle-remove").performClick()
        compose.waitUntil { "release" in api.calls }
        compose.onNodeWithTag("handle-message").onChildren()[0].assertTextEquals("Removed.")
    }

    @Test fun aHandleTheServerRefusesShowsItsReason() {
        val api = FakeAccountApi(refuse = "That handle is already taken.")
        account(api)
        waitFor("Profile handle")
        compose.onNode(hasSetTextAction() and hasText("Profile handle")).performScrollTo().performTextInput("river-pat")
        compose.onNodeWithTag("handle-save").performClick()
        compose.waitUntil { "handle river-pat" in api.calls }
        compose.onNodeWithTag("handle-message").onChildren()[0].assertTextEquals("That handle is already taken.")
    }

    // A failed load must not look like "no handle set", or saving would replace one.
    @Test fun aProfileThatWontLoadSaysSoAndCanBeTriedAgain() {
        val api = FakeAccountApi(failLoads = true, profile = ProfileSettings(public = true, handle = "river-pat"))
        account(api)
        waitFor("Couldn’t load your profile. Please try again.")
        compose.onNodeWithText("Profile handle").assertDoesNotExist()
        api.failLoads = false
        compose.onNodeWithText("Try again").performClick()
        waitFor("river-pat")
    }

    @Test fun anAccountThatWontLoadCanBeTriedAgainAndShowsNothingToActOn() {
        val api = FakeAccountApi()
        show { AccountScreen(object : AccountApi by api { override suspend fun me(): Me = throw ApiFailure("x", 500, generic = true) },
            onBack = {}, onTracker = {}, onTrackers = {}, onSignOut = {}, onSignedOut = {}, onDeleted = {}) }
        waitFor("Couldn’t load your account. Please try again.")
        compose.onNodeWithText("Try again").assertExists()
        compose.onNodeWithText("Delete my account").assertDoesNotExist()
    }

    // Contact says whether the account was made with Strava, which Delete needs: no guessing.
    // Contact has its own load: when it fails, the rest of Account is still there to use.
    @Test fun aContactThatWontLoadSaysSoInYourDetailsOnly() {
        val api = FakeAccountApi(failContact = true, madeWithStrava = true)
        account(api)
        waitFor("Couldn’t load your contact details. Please try again.")
        compose.onNodeWithText("Delete my account").assertExists()
        api.failContact = false
        compose.onNodeWithText("Try again").performClick()
        waitFor("Contact email")
    }

    // Delete needs to know: still unknown, it asks again, and a failure is never "Sign in again".
    @Test fun deletingWhileContactIsUnknownNeverOffersSignInAgainToAStravaAccount() {
        val api = FakeAccountApi(failContact = true, madeWithStrava = true, recentSignIn = false)
        account(api)
        waitFor("Delete my account")
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        waitFor("Couldn’t check your sign-in. Please try again.")
        compose.onNodeWithText("Sign in again").assertDoesNotExist()
        api.failContact = false
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        waitFor(NO_SIGN_IN_AGAIN)
        compose.onNodeWithText("Sign in again").assertDoesNotExist()
    }

    @Test fun signOutSignsOutAtOnce() {
        account(FakeAccountApi())
        waitFor("Sign out")
        compose.onNodeWithText("Sign out").performScrollTo().performClick()
        compose.waitUntil { did == listOf("sign out") }
    }

    // No password: signing out locks it out until we move it, so it's asked first (lead).
    @Test fun anAccountMadeWithStravaIsAskedBeforeSigningOut() {
        account(FakeAccountApi(email = "strava-12345@noreply.paddlesnitch.com", madeWithStrava = true))
        waitFor("Sign out")
        compose.onNodeWithText("Sign out").performScrollTo().performClick()
        waitFor(SIGN_OUT_STRAVA)
        assertEquals(emptyList<String>(), did)
        compose.onNodeWithText("Sign out anyway").performScrollTo()
        compose.onRoot().captureRoboImage()
        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        compose.onNodeWithText(SIGN_OUT_STRAVA).assertDoesNotExist()
        compose.onNodeWithText("Sign out").performScrollTo().performClick()
        waitFor(SIGN_OUT_STRAVA)
        compose.onNodeWithText("Email us").performScrollTo().performClick()
        assertEquals("mailto:privacy@paddlesnitch.com?subject=Moving%20my%20account%20from%20Strava", Shadows.shadowOf(compose.activity).nextStartedActivity.data.toString())
        assertEquals(emptyList<String>(), did)
        compose.onNodeWithText("Sign out anyway").performScrollTo().performClick()
        assertEquals(listOf("sign out"), did)
    }

    @Test fun deletingNeedsDeleteTypedThenSignsOut() {
        val api = FakeAccountApi()
        account(api)
        waitFor("Delete my account")
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        val delete = compose.onNodeWithText("Delete for good")
        delete.assertIsNotEnabled()
        compose.onNodeWithTag("delete-confirm").performTextInput("delete")
        delete.assertIsNotEnabled() // exactly DELETE, as the website asks
        compose.onNodeWithTag("delete-confirm").performTextReplacement("DELETE")
        delete.assertIsEnabled()
        compose.onRoot().captureRoboImage()
        delete.performScrollTo().performClick()
        compose.waitUntil { "deleted" in did }
        assertEquals(listOf("status", "delete"), api.calls)
    }

    @Test fun anOldSignInAsksToSignInAgainForThisAccount() {
        val api = FakeAccountApi(recentSignIn = false)
        account(api)
        waitFor("Delete my account")
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        waitFor(RECENT_SIGN_IN)
        compose.onNodeWithTag("delete-confirm").assertDoesNotExist() // nothing to type until the sign-in is fresh
        compose.onNodeWithText("Sign in again").performScrollTo()
        compose.onRoot().captureRoboImage()
        compose.onNodeWithText("Sign in again").performClick()
        compose.onNodeWithText("Sign in again…").assertIsNotEnabled() // signing out takes a moment: one tap, one sign-in
        assertEquals(listOf("sign in again u-123 pat@example.com"), did)
        assertEquals(listOf("status"), api.calls)
    }

    @Test fun backFromSigningInAgainWithASignInStillTooOldItAsksAgainCalmly() {
        account(FakeAccountApi(recentSignIn = false), resumeDelete = true)
        waitFor(RECENT_SIGN_IN)
        compose.onNodeWithTag("delete-confirm").assertDoesNotExist()
        compose.onNodeWithTag("delete-message").onChildren().assertCountEquals(0)
    }

    @Test fun aSessionThatEndedWhenCheckingGoesBackToSigningIn() {
        val api = FakeAccountApi()
        account(api)
        waitFor("Delete my account")
        api.signedOut = true
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        compose.waitUntil { "signed out" in did }
    }

    @Test fun cancellingSignInAgainGoesBackToTheDeleteButton() {
        account(FakeAccountApi(recentSignIn = false))
        waitFor("Delete my account")
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        waitFor("Sign in again")
        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        compose.onNodeWithText("Delete my account").assertExists()
        compose.onNodeWithText(RECENT_SIGN_IN).assertDoesNotExist()
    }

    @Test fun whenTheTenMinutesRunOutWhileTypingItAsksToSignInAgainNotAnError() {
        val api = FakeAccountApi(reauthOnDelete = true)
        account(api)
        waitFor("Delete my account")
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        compose.onNodeWithTag("delete-confirm").performTextInput("DELETE")
        compose.onNodeWithText("Delete for good").performScrollTo().performClick()
        waitFor(RECENT_SIGN_IN)
        compose.onNodeWithText("Sign in again").assertExists()
        compose.onNodeWithText("For your safety, deleting your account needs a recent sign-in. Please sign in again.").assertDoesNotExist()
        compose.onNodeWithTag("delete-message").onChildren().assertCountEquals(0) // no red error alongside
        assertFalse("deleted" in did)
    }

    @Test fun backFromSigningInAgainItChecksAndOpensTheDeleteBox() {
        val api = FakeAccountApi()
        account(api, resumeDelete = true)
        compose.waitUntil { compose.onAllNodes(hasTestTag("delete-confirm")).fetchSemanticsNodes().isNotEmpty() }
        assertEquals(listOf("resumed"), did)
        assertEquals(listOf("status"), api.calls)
    }

    @Test fun aFailedCheckSaysSoInsteadOfAskingToSignIn() {
        account(FakeAccountApi(failStatus = true))
        waitFor("Delete my account")
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        waitFor("Couldn’t check your sign-in. Please try again.")
        compose.onNodeWithText("Sign in again").assertDoesNotExist()
        compose.onNodeWithText("Delete my account").assertIsEnabled()
    }

    @Test fun cancellingDeleteClearsWhatWasTyped() {
        account(FakeAccountApi())
        waitFor("Delete my account")
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        compose.onNodeWithTag("delete-confirm").performTextInput("DELETE")
        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        compose.onNodeWithText("Delete for good").assertIsNotEnabled()
    }

    @Test fun aFailedDeleteSaysSoAndKeepsTheAccount() {
        val api = FakeAccountApi(refuse = "Couldn’t delete your account. Please try again.")
        account(api)
        waitFor("Delete my account")
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        compose.onNodeWithTag("delete-confirm").performTextInput("DELETE")
        compose.onNodeWithText("Delete for good").performScrollTo().performClick()
        waitFor("Couldn’t delete your account. Please try again.")
        assertFalse("deleted" in did)
    }

    @Test fun downloadMyDataSavesTheServersFileWhereYouPickAndKeepsNoCopy() {
        val target = tmp.newFile("picked.json")
        val dialog = FakeSaveDialog(Uri.fromFile(target))
        account(FakeAccountApi(), saveDialog = dialog)
        waitFor("Download my data")
        compose.onNodeWithText("Download my data").performScrollTo().performClick()
        compose.waitUntil { dialog.opened.isNotEmpty() }
        assertEquals(listOf("paddlesnitch-export-2026-10-25.json"), dialog.opened)
        compose.waitUntil { target.length() > 0 }
        assertEquals("""{"account":{}}""", target.readText())
        waitFor("Saved.")
        assertFalse("the export stays in the cache", exportFile(compose.activity).exists())
    }

    @Test fun cancellingTheSaveDialogKeepsNoCopy() {
        val dialog = FakeSaveDialog(null)
        account(FakeAccountApi(), saveDialog = dialog)
        waitFor("Download my data")
        compose.onNodeWithText("Download my data").performScrollTo().performClick()
        compose.waitUntil { dialog.opened.isNotEmpty() }
        compose.waitUntil { !exportFile(compose.activity).exists() }
        compose.onNodeWithText("Download my data").assertIsEnabled()
    }

    @Test fun termsAreAcceptedOnlyOnceTicked() {
        val api = FakeAccountApi()
        var accepted = false
        show { TermsScreen(api, onAccepted = { accepted = true }, onSignOut = {}, onSignedOut = {}) }
        val go = compose.onNodeWithText("Continue")
        go.assertIsNotEnabled()
        compose.onNodeWithText("I have read and agree to the Terms of Service and Privacy Policy.").performClick()
        go.assertIsEnabled()
        compose.onRoot().captureRoboImage()
        go.performClick()
        compose.waitUntil { accepted }
        assertTrue("acceptTerms" in api.calls)
    }

    @Test fun termsAtTheLargestText() {
        show(fontScale = 2f) { TermsScreen(FakeAccountApi(), onAccepted = {}, onSignOut = {}, onSignedOut = {}) }
        compose.onRoot().captureRoboImage()
    }

    @Test fun termsCanBeLeftBySigningOut() {
        show { TermsScreen(FakeAccountApi(), onAccepted = {}, onSignOut = { did += "sign out" }, onSignedOut = {}) }
        compose.onNodeWithText("Sign out").performScrollTo().performClick()
        assertEquals(listOf("sign out"), did)
    }

    @Test fun termsThatCantBeSavedSaySo() {
        show { TermsScreen(FakeAccountApi(refuse = "That version isn’t current."), onAccepted = {}, onSignOut = {}, onSignedOut = {}) }
        compose.onNodeWithText("I have read and agree to the Terms of Service and Privacy Policy.").performClick()
        compose.onNodeWithText("Continue").performClick()
        waitFor("That version isn’t current.")
    }

    @Test fun termsWithASessionThatHasEndedGoBackToSigningIn() {
        show { TermsScreen(FakeAccountApi(signedOut = true), onAccepted = {}, onSignOut = {}, onSignedOut = { did += "signed out" }) }
        compose.onNodeWithText("I have read and agree to the Terms of Service and Privacy Policy.").performClick()
        compose.onNodeWithText("Continue").performClick()
        compose.waitUntil { did == listOf("signed out") }
    }

    @Test fun yourTrackersOpensTheTrackersScreen() {
        account(FakeAccountApi())
        waitFor("Your trackers")
        compose.onNodeWithText("Devices").assertExists() // the section is named as on the website
        compose.onNodeWithText("Your trackers").performScrollTo().performClick()
        assertEquals(listOf("trackers"), did)
    }

    // Strava is gone (owner, 2026-11-01): Account has no Strava section, whatever an older server says.
    @Test fun accountHasNoStrava() {
        account(FakeAccountApi(options = SignInOptions(google = true, strava = true)))
        waitFor("Your trackers")
        compose.onAllNodes(hasText("Strava", substring = true)).assertCountEquals(0)
    }

    // An account made with Strava has no password: it can't sign in again to delete, so it
    // asks us by email, privately, with its Support ID (lead).
    @Test fun anAccountMadeWithStravaEmailsUsToDelete() {
        account(FakeAccountApi(email = "strava-12345@noreply.paddlesnitch.com", madeWithStrava = true, recentSignIn = false), fontScale = 2f)
        waitFor("Delete my account")
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        waitFor(NO_SIGN_IN_AGAIN)
        compose.onNodeWithText("Sign in again").assertDoesNotExist()
        compose.onNodeWithText("Email us").performScrollTo()
        compose.onRoot().captureRoboImage()
        compose.onNodeWithText("Email us").performScrollTo().performClick()
        assertEquals(emptyList<String>(), did) // never signed out
        val sent = Shadows.shadowOf(compose.activity).nextStartedActivity
        assertEquals(android.content.Intent.ACTION_SENDTO, sent.action)
        assertEquals("mailto:privacy@paddlesnitch.com?subject=Delete%20my%20account&body=Support%20ID%3A%20u-123", sent.data.toString())
    }

    // Keyed on the server's flag, not on what the email looks like.
    @Test fun anEmailThatLooksLikeStravasStillSignsInAgainWhenTheServerSaysItIsntOne() {
        account(FakeAccountApi(email = "strava-12345@noreply.paddlesnitch.com", madeWithStrava = false, recentSignIn = false))
        waitFor("Delete my account")
        compose.onNodeWithText("Contact email").assertDoesNotExist()
        compose.onNodeWithText("Delete my account").performScrollTo().performClick()
        waitFor("Sign in again")
        compose.onNodeWithText("Sign in again").performScrollTo().performClick()
        assertEquals(listOf("sign in again u-123 strava-12345@noreply.paddlesnitch.com"), did)
    }
}
