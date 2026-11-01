package com.paddlesnitch.app.record

import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.After
import org.junit.Rule
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class RecordScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val files = RecordingFiles(File.createTempFile("track_20261031_091407", ".csv"), File.createTempFile("i10", ".csv"))
    private val notReady = RecorderCore.Live(Float.NaN, Float.NaN, Float.NaN, Float.NaN, Float.NaN, Float.NaN)
    // 1 h 5 min 3 s in.
    private val recording = RecordingService.State.Recording(files, MutableStateFlow(notReady), startedAt = 1_000L)
    private val now = { 1_000L + 3_903_000L }

    private fun show(state: RecordingService.State, fontScale: Float = 1f, onStart: () -> Unit = {}, onStop: () -> Unit = {},
                     onSettings: () -> Unit = {}, notificationsOn: Boolean = true, location: LocationReady = LocationReady.Ready,
                     onLocationSettings: () -> Unit = {}) = compose.setContent {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
            PaddlesnitchTheme { Surface(color = PsColor.bg) {
                RecordScreen(state, onStart, onStop, location = location, onSettings = onSettings, onLocationSettings = onLocationSettings,
                    notificationsOn = notificationsOn, now = now)
            } }
        }
    }

    /** TalkBack's named action on Hold to stop (README § Recording screen). */
    private fun stopRecordingAction() = compose.onNodeWithContentDescription("Hold to stop").fetchSemanticsNode()
        .config[SemanticsActions.CustomActions].single { it.label == "Stop recording" }

    private fun golden(name: String) = compose.onRoot().captureRoboImage("src/test/screenshots/com.paddlesnitch.app.record.RecordScreenTest.$name.png")

    @Test fun beforeRecording() {
        var started = 0
        show(RecordingService.State.Idle, onStart = { started++ })
        golden("idle")
        compose.onNodeWithText("Start recording").performClick()
        assertEquals(1, started)
    }

    @Test fun whileRecordingItShowsTheTimeAndADashForStrokeRate() {
        show(recording)
        compose.onNodeWithContentDescription("Elapsed, 1:05:03").assertExists()
        compose.onNodeWithContentDescription("Stroke rate, not measured yet").assertExists()
        golden("recording")
    }

    @Test fun aTapDoesntStopItItSaysToKeepHolding() {
        var stops = 0
        show(recording, onStop = { stops++ })
        compose.onNodeWithContentDescription("Hold to stop").performClick()
        assertEquals(0, stops)
        compose.onNodeWithText(KEEP_HOLDING).assertExists()
    }

    @Test fun aShortHoldDoesntStopIt() {
        var stops = 0
        show(recording, onStop = { stops++ })
        compose.onNodeWithContentDescription("Hold to stop").performTouchInput { down(center); advanceEventTime(800); up() }
        compose.mainClock.advanceTimeBy(1000)
        assertEquals(0, stops)
    }

    @Test fun holdingForOneAndAHalfSecondsStopsIt() {
        var stops = 0
        show(recording, onStop = { stops++ })
        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription("Hold to stop").performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(HOLD_TO_STOP_MS + 100L)
        compose.onNodeWithContentDescription("Hold to stop").performTouchInput { up() }
        compose.mainClock.advanceTimeBy(100)
        assertEquals(1, stops)
    }

    @Test fun talkBackStopsItWithANamedStopRecordingAction() {
        var stops = 0
        show(recording, onStop = { stops++ })
        stopRecordingAction().action()
        assertEquals(1, stops)
    }

    @Test fun whileRecordingTheHeadingSaysRecording() {
        show(recording)
        compose.onNodeWithText("Recording").assertExists()
    }

    @Test fun aFailedWriteShowsInPlaceOfTheHeading() {
        val broken = RecordingFiles(File.createTempFile("track_20261031_091407", ".csv"), File.createTempFile("i10", ".csv"))
        broken.close()
        broken.write(RecorderCore.TRACK, "1,2,3\n".toByteArray())   // after close: the write fails, as on a full phone
        show(RecordingService.State.Recording(broken, MutableStateFlow(notReady), startedAt = 1_000L))
        compose.onNodeWithText(WRITE_FAILED).assertExists()
        compose.onNodeWithText("Recording").assertDoesNotExist()
        golden("recording.write-failed")
    }

    @Test fun withoutMotionSensorsItRecordsAndSaysThereIsNoStrokeRate() {
        show(recording.copy(motion = false))
        compose.onNodeWithText(NO_MOTION_SENSORS).assertExists()
        compose.onNodeWithContentDescription("Hold to stop").assertExists()
        golden("recording.no-motion")
    }

    @Test fun withMotionSensorsTheresNoSuchLine() {
        show(recording)
        compose.onNodeWithText(NO_MOTION_SENSORS).assertDoesNotExist()
    }

    @Test fun withNotificationsOffItSaysStopHere() {
        show(recording, notificationsOn = false)
        compose.onNodeWithText(NOTIFICATIONS_OFF).assertExists()
    }

    @Test fun atLargeText() {
        show(recording, fontScale = 2f)
        golden("recording.large-text")
    }

    @Test fun whileStartingTheButtonWaits() {
        var started = 0
        show(RecordingService.State.Starting, onStart = { started++ })
        compose.onNodeWithText("Start recording…").assertIsNotEnabled()
    }

    @Test fun refusingLocationAtStartSaysSoInPlaceOfStart() {
        var settings = 0
        show(RecordingService.State.Failed(locationRefused = true), onSettings = { settings++ })
        compose.onNodeWithText(RECORD_LOCATION_REFUSED).assertExists()
        compose.onNodeWithText("Start recording").assertDoesNotExist()
        golden("location-refused")
        compose.onNodeWithText("Open Settings").performClick()
        assertEquals(1, settings)
    }

    @Test fun beforeStartWithLocationRefusedItSaysSoInPlaceOfStart() {
        show(RecordingService.State.Idle, location = LocationReady.Refused)
        compose.onNodeWithText(RECORD_LOCATION_REFUSED).assertExists()
        compose.onNodeWithText("Open Settings").assertExists()
        compose.onNodeWithText("Start recording").assertDoesNotExist()
    }

    @Test fun withLocationOffItSaysSoAndOpensLocationSettings() {
        var opened = 0
        show(RecordingService.State.Idle, location = LocationReady.Off, onLocationSettings = { opened++ })
        compose.onNodeWithText(LOCATION_OFF).assertExists()
        compose.onNodeWithText("Start recording").assertDoesNotExist()
        golden("location-off")
        compose.onNodeWithText("Open location settings").performClick()
        assertEquals(1, opened)
    }

    @Test fun aFailedWriteAtLargeText() {
        val broken = RecordingFiles(File.createTempFile("track_20261031_091407", ".csv"), File.createTempFile("i10", ".csv"))
        broken.close()
        broken.write(RecorderCore.TRACK, "1,2,3\n".toByteArray())
        show(RecordingService.State.Recording(broken, MutableStateFlow(notReady), startedAt = 1_000L), fontScale = 2f)
        golden("recording.write-failed.large-text")
    }

    @Test fun anotherFailureDoesntBlameLocation() {
        show(RecordingService.State.Failed(locationRefused = false))
        golden("start-failed")
        compose.onNodeWithText(RECORD_FAILED).assertExists()
        compose.onNodeWithText("Open Settings").assertDoesNotExist()
    }

    @Test fun paddlesSaysARecordingIsRunning() {
        var opened = 0
        compose.setContent { PaddlesnitchTheme { RecordEntry(recording, onOpen = { opened++ }, now = now) } }
        compose.onNodeWithText("Recording · 1:05:03").performClick()
        assertEquals(1, opened)
    }

    @Test fun paddlesOffersToRecord() {
        compose.setContent { PaddlesnitchTheme { RecordEntry(RecordingService.State.Idle, onOpen = {}) } }
        compose.onNodeWithText("Record a paddle").assertExists()
    }

    // C3: recording ships in release, so the app declares its own location and the
    // location service in the main manifest, and no overlay removes them from release.
    @Test fun recordingIsDeclaredForEveryBuild() {
        val main = File("src/main/AndroidManifest.xml").readText()
        listOf("ACCESS_FINE_LOCATION", "FOREGROUND_SERVICE_LOCATION", "RecordingService", "foregroundServiceType=\"location\"").forEach {
            assertEquals("$it in the main manifest", true, main.contains(it))
        }
        assertEquals("no release overlay", false, File("src/release/AndroidManifest.xml").exists())
        assertEquals("nothing for recording in the debug manifest", false, File("src/debug/AndroidManifest.xml").readText().contains("LOCATION"))
    }

    private fun lost(s: Float) = notReady.copy(fix = false, sinceFixS = s)
    private val fixed = notReady.copy(fix = true, sinceFixS = 0f)

    // The table lead and copy-style set for both apps (#761, Phone recording).
    @Test fun theGpsLineIsTheCoresStateInTheAgreedWords() {
        assertEquals(GpsLine("Waiting for GPS", "Waiting for GPS"), gpsLine(null))
        assertEquals(GpsLine("Waiting for GPS", "Waiting for GPS"), gpsLine(notReady))
        assertEquals(GpsLine("GPS fix", "GPS fix"), gpsLine(fixed))
        assertEquals(GpsLine("GPS lost", "GPS lost"), gpsLine(lost(0.4f)))
        assertEquals(GpsLine("GPS lost 1 s ago", "GPS lost 1 second ago"), gpsLine(lost(1.9f)))
        assertEquals(GpsLine("GPS lost 40 s ago", "GPS lost 40 seconds ago"), gpsLine(lost(40.7f)))
        assertEquals(GpsLine("GPS lost 1 min ago", "GPS lost 1 minute ago"), gpsLine(lost(60f)))
        assertEquals(GpsLine("GPS lost 2 min ago", "GPS lost 2 minutes ago"), gpsLine(lost(179f)))
        assertEquals(GpsLine("GPS lost 75 min ago", "GPS lost 75 minutes ago"), gpsLine(lost(4_530f)))
    }

    @Test fun onlyLosingAndRegainingTheFixAreAnnounced() {
        assertEquals(null, gpsAnnouncement(null, notReady))            // waiting: nothing
        assertEquals(null, gpsAnnouncement(notReady, fixed))           // a first fix isn't "back"
        assertEquals("GPS lost", gpsAnnouncement(fixed, lost(0.2f)))
        assertEquals(null, gpsAnnouncement(lost(0.2f), lost(1.2f)))     // the count never talks
        assertEquals(null, gpsAnnouncement(lost(59f), lost(60f)))
        assertEquals("GPS back", gpsAnnouncement(lost(12f), fixed))
        assertEquals(null, gpsAnnouncement(fixed, fixed))
    }

    @Test fun theGpsLineIsNotALiveRegion() {
        RecordingService.set(recording)
        show(RecordingService.State.Recording(files, MutableStateFlow(lost(40f)), startedAt = 1_000L))
        val node = compose.onNodeWithContentDescription("GPS lost 40 seconds ago").fetchSemanticsNode()
        assertEquals(false, node.config.contains(androidx.compose.ui.semantics.SemanticsProperties.LiveRegion))
        compose.onNodeWithText("GPS lost 40 s ago", useUnmergedTree = true).assertDoesNotExist()   // cleared: one label, the spoken one
    }

    @Test fun recordingWithoutAFixSaysWaitingForGps() {
        show(recording)
        compose.onNodeWithContentDescription("Waiting for GPS").assertExists()
    }

    // Lead, 2026-11-01: waiting for the first fix is muted; only a lost fix is red.
    @Test fun onlyALostFixIsRed() {
        assertEquals(false, gpsLost(null))
        assertEquals(false, gpsLost(notReady))
        assertEquals(false, gpsLost(fixed))
        assertEquals(true, gpsLost(lost(0.4f)))
    }

    @Test fun theStrokeRateIsTheCoresOrADash() {
        assertEquals("—", liveStrokeRate(null))
        assertEquals("—", liveStrokeRate(notReady))
        assertEquals("58", liveStrokeRate(notReady.copy(spm = 57.6f)))
    }

    // A refused token refresh signs out by itself (#702), mid-paddle as easily as not.
    private var signedIn by mutableStateOf(true)

    private fun showApp() = compose.setContent {
        PaddlesnitchTheme {
            Surface(color = PsColor.bg) {
                WithRecording(signedIn = signedIn, record = { Record(accountId = { "u-77" }) }) { entry, bar ->
                    Column {
                        bar?.invoke()
                        Text(if (signedIn) "Your paddles" else "Sample paddles")
                        entry?.invoke()
                    }
                }
            }
        }
    }

    @After fun idle() = RecordingService.set(RecordingService.State.Idle)

    @Test fun aForcedSignOutMidRecordingKeepsTheScreenAndStop() {
        RecordingService.set(recording)
        showApp()
        compose.onNodeWithText("Recording ·", substring = true).performClick()
        compose.onNodeWithContentDescription("Hold to stop").assertExists()
        signedIn = false
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Hold to stop").assertExists()
        stopRecordingAction().action()
        val app = compose.activity.application
        assertEquals(RecordingService.ACTION_STOP, org.robolectric.Shadows.shadowOf(app).nextStartedService?.action)
    }

    @Test fun signedOutMidRecordingTheSamplesStillLeadBackToIt() {
        RecordingService.set(recording)
        showApp()
        signedIn = false
        compose.onNodeWithText("Sample paddles").assertExists()
        compose.onNodeWithText("Recording ·", substring = true).performClick()
        compose.onNodeWithContentDescription("Hold to stop").assertExists()
    }

    @Test fun signedOutWithNothingRecordingThereIsNoRecord() {
        signedIn = false
        showApp()
        compose.onNodeWithText("Record a paddle").assertDoesNotExist()
    }

    @Test fun hideHidesTheScreenAndTheLineAtTheTopLeadsBackToTheRecording() {
        RecordingService.set(recording)
        showApp()
        compose.onNodeWithText("Recording ·", substring = true).performClick()
        compose.onNodeWithText("Recording carries on.").assertExists()
        compose.onNodeWithText("Hide").performClick()
        compose.onNodeWithText("Your paddles").assertExists()
        assertEquals("still recording", recording, RecordingService.state.value)
        compose.onNodeWithText("Recording ·", substring = true).performClick()
        compose.onNodeWithContentDescription("Hold to stop").assertExists()
    }

    @Test fun whileRecordingTheLineIsAtTheTopNotInPaddles() {
        RecordingService.set(recording)
        showApp()
        compose.onNodeWithText("Record a paddle").assertDoesNotExist()
        assertEquals(1, compose.onAllNodes(androidx.compose.ui.test.hasText("Recording ·", substring = true)).fetchSemanticsNodes().size)
    }

    @Test fun withNothingRecordingThereIsNoLineAtTheTopAndCloseGoesBack() {
        showApp()
        compose.onNodeWithText("Recording ·", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Record a paddle").performClick()
        compose.onNodeWithText("Hide").assertDoesNotExist()
        compose.onNodeWithText("Close").performClick()
        compose.onNodeWithText("Your paddles").assertExists()
    }

    @Test fun stoppingGoesBackToPaddles() {
        RecordingService.set(recording)
        showApp()
        compose.onNodeWithText("Recording ·", substring = true).performClick()
        RecordingService.set(RecordingService.State.Stopped(files, elapsedMs = 3_903_000L))
        compose.waitForIdle()
        compose.onNodeWithText("Your paddles").assertExists()
        compose.onNodeWithText("Record a paddle").assertExists()
    }
}
