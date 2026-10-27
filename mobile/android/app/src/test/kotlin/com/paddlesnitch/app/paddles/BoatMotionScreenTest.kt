package com.paddlesnitch.app.paddles

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.paddlesnitch.app.api.AnalysisSession
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.PaddleList
import com.paddlesnitch.app.api.RecordingMotion
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import java.io.File
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// The Boat motion screen (mobile/contract/README.md § Boat motion) with the
// contract's golden answers, and the way to it from a tracker paddle.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class BoatMotionScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val dir = File("../../contract/fixtures/api")
    private fun motion(name: String) = ApiJson.decodeFromString(RecordingMotion.serializer(), dir.resolve(name).readText())
    private fun paddle(name: String) = ApiJson.decodeFromString(AnalysisSession.serializer(), dir.resolve(name).readText())
    private val tracker = paddle("paddles.get.json")
    private val list = ApiJson.decodeFromString(PaddleList.serializer(), dir.resolve("paddles.list.json").readText())

    // The date above the title is in the phone's zone: fix it, or the goldens move.
    @Before fun utc() = TimeZone.setDefault(TimeZone.getTimeZone("UTC"))

    private fun show(fontScale: Float = 1f, content: @Composable () -> Unit) = compose.setContent {
        val density = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
            PaddlesnitchTheme { Surface(color = PsColor.bg) { content() } }
        }
    }

    private fun golden(name: String) = compose.onRoot().captureRoboImage("src/test/screenshots/com.paddlesnitch.app.paddles.BoatMotionScreenTest.$name.png")

    @Test fun measured() {
        show { BoatMotionScreen(tracker, load = { motion("account.devices-session.json") }) }
        compose.onNodeWithContentDescription("Side-to-side roll", substring = true).assertExists()
        golden("measured")
        compose.onNodeWithText("Bars show how often", substring = true).performScrollTo()
        golden("measured.histogram")
        compose.onNodeWithText("What this can’t tell you.", substring = true).performScrollTo()
        golden("measured.notes")
    }

    @Test fun measuredAtLargeText() {
        show(fontScale = 2f) { BoatMotionScreen(tracker, load = { motion("account.devices-session.json") }) }
        golden("measured.large-text")
        compose.onNodeWithText("The shaded band shows", substring = true).performScrollTo()
        golden("measured.large-text.chart")
    }

    @Test fun eachTileAndChartIsOneThingToAScreenReader() {
        show { BoatMotionScreen(tracker, load = { motion("account.devices-session.json") }) }
        compose.onNodeWithContentDescription("Side-to-side roll, 5.8 degrees, typical lean").assertExists()
        compose.onNodeWithContentDescription("Stroke rate, 64 strokes per minute").assertExists()
        compose.onNodeWithContentDescription("Roll and pitch through the session, reaching about 11 degrees").assertExists()
        compose.onNode(hasScrollAction()).performScrollToNode(hasContentDescription("Distribution of boat lean", substring = true))
    }

    @Test fun theStrokeRateTileIsThePaddlesOwn() {
        val other = tracker.copy(result = tracker.result.copy(avgSR = 51.6))
        show { BoatMotionScreen(other, load = { motion("account.devices-session.json") }) }
        compose.onNodeWithContentDescription("Stroke rate, 52 strokes per minute").assertExists()
    }

    @Test fun theMotionFileHasntArrived() {
        show { BoatMotionScreen(tracker, load = { motion("account.devices-session.no-motion.json") }) }
        compose.onNodeWithText("No boat motion for this recording.").assertExists()
        compose.onNodeWithText(noMotionCopy(null)).assertExists()
        golden("no-motion")
    }

    @Test fun motionThatCouldntBeMeasuredNeverShowsTheEnginesReason() {
        show { BoatMotionScreen(tracker, load = { motion("account.devices-session.motion-unusable.json") }) }
        compose.onNodeWithText("We couldn’t measure boat motion", substring = true).assertExists()
        compose.onNodeWithText("too few samples", substring = true).assertDoesNotExist()
    }

    @Test fun aFailureCanBeTriedAgain() {
        var calls = 0
        show { BoatMotionScreen(tracker, load = { if (calls++ == 0) throw ApiFailure("Not found", 404) else motion("account.devices-session.json") }) }
        compose.onNodeWithText(MOTION_FAILED).assertExists()
        golden("failed")
        compose.onNodeWithText("Try again").performClick()
        compose.onNodeWithText(MOTION_FAILED).assertDoesNotExist()
        compose.onNodeWithText("Through the session").assertExists()
        assertEquals(2, calls)
    }

    private val fakeMap: MapSlot = { _, m -> Box(m.background(PsColor.surface2), contentAlignment = Alignment.Center) { Text("map", color = PsColor.muted) } }

    @Test fun aTrackerPaddleOpensItsBoatMotionAndBackReturns() {
        var askedFor: AnalysisSession? = null
        show { PaddlesHost(list, sample = true, load = { tracker }, map = fakeMap, openPaddle = "pdl-river", loadMotion = { askedFor = it; motion("account.devices-session.json") }) }
        compose.onNodeWithText("Boat motion").performScrollTo().performClick()
        compose.onNodeWithText("← Paddle").assertExists()
        compose.onNodeWithText("Through the session").assertExists()
        assertEquals("S0012", askedFor?.source?.deviceSessionId)
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("← Paddles").assertExists()
        compose.onNodeWithText("Boat motion").assertExists()
        compose.onNodeWithText("Boat motion").performScrollTo().performClick()
        compose.onNodeWithText("← Paddle").performClick()
        compose.onNodeWithText("← Paddles").assertExists()
    }

    @Test fun aPaddleNotFromATrackerHasNoBoatMotion() {
        show { PaddlesHost(list, sample = true, load = { paddle("paddles.get.strava.json") }, map = fakeMap, openPaddle = "pdl-strava", loadMotion = { error("not asked") }) }
        compose.onNodeWithText("← Paddles").assertExists()
        compose.onNode(hasText("Boat motion") and hasClickAction()).assertDoesNotExist()
    }
}
