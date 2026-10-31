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
import org.junit.Rule
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
                     onSettings: () -> Unit = {}, notificationsOn: Boolean = true) = compose.setContent {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
            PaddlesnitchTheme { Surface(color = PsColor.bg) { RecordScreen(state, onStart, onStop, onSettings = onSettings, notificationsOn = notificationsOn, now = now) } }
        }
    }

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

    @Test fun talkBackStopsItWithALongPressAction() {
        var stops = 0
        show(recording, onStop = { stops++ })
        compose.onNodeWithContentDescription("Hold to stop").performSemanticsAction(SemanticsActions.OnLongClick)
        assertEquals(1, stops)
    }

    @Test fun withNotificationsOffItSaysStopHere() {
        show(recording, notificationsOn = false)
        compose.onNodeWithText(NOTIFICATIONS_OFF).assertExists()
    }

    @Test fun atLargeText() {
        show(recording, fontScale = 2f)
        golden("recording.large-text")
    }

    @Test fun afterStoppingItSaysHowLong() {
        show(RecordingService.State.Stopped(files, elapsedMs = 3_903_000L))
        compose.onNodeWithText("Recording saved on this phone (1:05:03).").assertExists()
        golden("stopped")
    }

    @Test fun whileStartingTheButtonWaits() {
        var started = 0
        show(RecordingService.State.Starting, onStart = { started++ })
        compose.onNodeWithText("Start recording…").assertIsNotEnabled()
    }

    @Test fun withoutLocationItSaysSoAndOpensSettings() {
        var settings = 0
        show(RecordingService.State.Failed(locationRefused = true), onSettings = { settings++ })
        compose.onNodeWithText(RECORD_LOCATION_REFUSED).assertExists()
        golden("failed")
        compose.onNodeWithText("Open the app’s settings").performClick()
        assertEquals(1, settings)
    }

    @Test fun anotherFailureDoesntBlameLocation() {
        show(RecordingService.State.Failed(locationRefused = false))
        compose.onNodeWithText(RECORD_FAILED).assertExists()
        compose.onNodeWithText("Open the app’s settings").assertDoesNotExist()
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

    // Release builds don't record yet (no upload until C3): recording's permissions and
    // service are in the debug manifest only. (MapLibre's own manifest still adds location.)
    @Test fun recordingIsDeclaredForDebugBuildsOnly() {
        val main = File("src/main/AndroidManifest.xml").readText()
        listOf("ACCESS_FINE_LOCATION", "FOREGROUND_SERVICE_LOCATION", "RecordingService").forEach {
            assertEquals("$it in the main manifest", false, main.contains(it))
        }
    }

    @Test fun theStrokeRateIsTheCoresOrADash() {
        assertEquals("—", liveStrokeRate(null))
        assertEquals("—", liveStrokeRate(notReady))
        assertEquals("58", liveStrokeRate(notReady.copy(spm = 57.6f)))
    }
}
