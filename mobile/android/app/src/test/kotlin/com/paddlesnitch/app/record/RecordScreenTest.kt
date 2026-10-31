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

    private fun show(state: RecordingService.State, fontScale: Float = 1f, onStart: () -> Unit = {}, onStop: () -> Unit = {}) = compose.setContent {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
            PaddlesnitchTheme { Surface(color = PsColor.bg) { RecordScreen(state, onStart, onStop, now = now) } }
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

    @Test fun aTapDoesntStopItAHoldDoes() {
        var stops = 0
        show(recording, onStop = { stops++ })
        compose.onNodeWithContentDescription("Hold to stop").performClick()
        assertEquals(0, stops)
        compose.onNodeWithContentDescription("Hold to stop").performTouchInput { longClick() }
        assertEquals(1, stops)
    }

    @Test fun atLargeText() {
        show(recording, fontScale = 2f)
        golden("recording.large-text")
    }

    @Test fun afterStoppingItSaysWhereItIs() {
        show(RecordingService.State.Stopped(files))
        compose.onNodeWithText("Saved on this phone as ${files.track.name}.").assertExists()
    }

    @Test fun withoutLocationItSaysSo() {
        show(RecordingService.State.Failed)
        compose.onNodeWithText(RECORD_FAILED).assertExists()
        golden("failed")
    }

    @Test fun theStrokeRateIsTheCoresOrADash() {
        assertEquals("—", liveStrokeRate(null))
        assertEquals("—", liveStrokeRate(notReady))
        assertEquals("58", liveStrokeRate(notReady.copy(spm = 57.6f)))
    }
}
