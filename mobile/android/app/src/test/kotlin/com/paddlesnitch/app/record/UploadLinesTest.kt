package com.paddlesnitch.app.record

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// Paddles' lines for recordings that aren't paddles yet (README § After Stop), in the contract's words.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class UploadLinesTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Before fun utc() { TimeZone.setDefault(TimeZone.getTimeZone("UTC")) }

    private val at = "2026-11-01T07:02:11Z"
    private var uploadNow = 0
    private val dismissed = mutableListOf<String>()
    private var reports = 0

    private fun show(lines: List<UploadLine>, online: Boolean = true, fontScale: Float = 1f, sending: String? = null) = compose.setContent {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
            PaddlesnitchTheme { Surface(color = PsColor.bg) {
                UploadLinesView(lines, online, sending, onUploadNow = { uploadNow++ }, onDismiss = { dismissed += it }, onReport = { reports++ })
            } }
        }
    }
    private fun golden(name: String) = compose.onRoot().captureRoboImage("src/test/screenshots/com.paddlesnitch.app.record.UploadLinesTest.$name.png")

    // Lead, 2026-11-01: "Uploading…" only for the one being sent; the rest wait.
    @Test fun onlyTheRecordingBeingSentSaysUploading() {
        show(listOf(UploadLine.Waiting("a", at), UploadLine.Waiting("b", "2026-11-01T09:00:00Z")), sending = "a")
        compose.onNodeWithText("1 Nov 2026, 07:02 · Uploading…").assertExists()
        compose.onNodeWithText("1 Nov 2026, 09:00 · Waiting to upload").assertExists()
    }

    @Test fun betweenRetriesEveryRecordingIsWaiting() {
        show(listOf(UploadLine.Waiting("a", at)), sending = null)
        compose.onNodeWithText("1 Nov 2026, 07:02 · Waiting to upload").assertExists()
    }

    @Test fun offlineItSaysWaitingToUpload() {
        show(listOf(UploadLine.Waiting("a", at)), online = false, sending = "a")
        compose.onNodeWithText("1 Nov 2026, 07:02 · Waiting to upload").assertExists()
    }

    @Test fun noFixSaysSoUntilDismissed() {
        show(listOf(UploadLine.NoFix("track_a", at)))
        compose.onNodeWithText("1 Nov 2026, 07:02 · $NO_FIX").assertExists()
        compose.onNodeWithText("Dismiss").performClick()
        assertEquals(listOf("track_a"), dismissed)
    }

    @Test fun aRefusedRecordingIsKeptAndCanBeReported() {
        show(listOf(UploadLine.Failed("a", at)))
        compose.onNodeWithText("1 Nov 2026, 07:02 · $UPLOAD_FAILED").assertExists()
        compose.onNodeWithText("Report an issue").performClick()
        assertEquals(1, reports)
    }

    @Test fun aRemovedPhoneOffersUploadNow() {
        show(listOf(UploadLine.PhoneOff(null)))
        compose.onNodeWithText(PHONE_REMOVED).assertExists()
        compose.onNodeWithText("Upload now").performClick()
        assertEquals(1, uploadNow)
    }

    @Test fun aPhoneTheServerWouldntAddSaysWhyInItsWords() {
        show(listOf(UploadLine.PhoneOff("Couldn't add this phone: your account has 10 already. Remove one on Devices, then try again.")))
        compose.onNodeWithText("Couldn't add this phone: your account has 10 already. Remove one on Devices, then try again.").assertExists()
        compose.onNodeWithText(PHONE_REMOVED).assertDoesNotExist()
    }

    @Test fun everyKindOfLine() {
        show(listOf(UploadLine.Waiting("a", at), UploadLine.Waiting("d", at), UploadLine.NoFix("b", at), UploadLine.Failed("c", at)), sending = "a")
        golden("all")
    }

    @Test fun everyKindOfLineAtLargeText() {
        show(listOf(UploadLine.PhoneOff(null), UploadLine.NoFix("b", at), UploadLine.Failed("c", at)), fontScale = 2f)
        golden("all.large-text")
    }

    // Made once per install, in the contract's alphabet, and never the hardware's id.
    @Test fun theInstallIdIsRandomAndKept() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val id = Uploads.installId(app)
        assertEquals(true, id.matches(Regex("[A-Za-z0-9_-]{16,64}")))
        assertEquals(id, Uploads.installId(app))
        app.getSharedPreferences("phone", 0).edit().clear().commit()
        assertNotEquals(id, Uploads.installId(app))
    }

    @Test fun theInstallIdStaysOutOfBackupsAndTransfers() {
        val rules = java.io.File("src/main/res/xml/data_extraction_rules.xml").readText()
        assertEquals(2, Regex("""<exclude domain="sharedpref" path="phone.xml" />""").findAll(rules).count())
    }
}
