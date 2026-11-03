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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.isFocused
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
        // The engine's own words are for engineers, on every path.
        compose.onNodeWithText("moving samples", substring = true).assertDoesNotExist()
        compose.onNodeWithText("clipped here", substring = true).assertDoesNotExist()
        compose.onNodeWithText("hard to tell apart", substring = true).assertDoesNotExist()
        golden("measured")
        compose.onNodeWithText("Bars show how often", substring = true).performScrollTo()
        golden("measured.histogram")
        compose.onNodeWithText("What this can't tell you.", substring = true).performScrollTo()
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
        var opened = 0
        show { BoatMotionScreen(tracker, load = { motion("account.devices-session.no-motion.json") }, openDevice = { opened++ }) }
        compose.onNodeWithText("No boat motion for this recording.").assertExists()
        compose.onNodeWithText(noMotionCopy(null)).assertExists()
        golden("no-motion")
        compose.onNodeWithText("Open tracker").performClick()
        assertEquals(1, opened)
    }

    // The paddle's own source.phone (the server's), not the id's shape (lead, 2026-11-03).
    @Test fun aPhonesRecordingSaysOpenPhone() {
        show { BoatMotionScreen(paddle("paddles.get.with-phone.json"), load = { motion("account.devices-session.no-motion.json") }, openDevice = {}) }
        compose.onNodeWithText("Open phone").assertExists()
        compose.onNodeWithText("Open tracker").assertDoesNotExist()
    }

    @Test fun withNowhereToGoThereIsNoButton() {
        show { BoatMotionScreen(tracker, load = { motion("account.devices-session.no-motion.json") }) }
        compose.onNodeWithText("Open tracker").assertDoesNotExist()
    }

    @Test fun motionThatCouldntBeMeasuredNeverShowsTheEnginesReason() {
        show { BoatMotionScreen(tracker, load = { motion("account.devices-session.motion-unusable.json") }, openDevice = {}) }
        compose.onNodeWithText("We couldn’t measure boat motion", substring = true).assertExists()
        compose.onNodeWithText("too few samples", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Open tracker").assertDoesNotExist()   // it came and couldn't be measured: syncing won't help
    }

    @Test fun aFailureCanBeTriedAgain() {
        var calls = 0
        show { BoatMotionScreen(tracker, load = { if (calls++ == 0) throw ApiFailure("Couldn’t finish that. Please try again.", 503, generic = true) else motion("account.devices-session.json") }) }
        compose.onNodeWithText(MOTION_FAILED).assertExists()
        golden("failed")
        compose.onNodeWithText("Try again").performClick()
        compose.onNodeWithText(MOTION_FAILED).assertDoesNotExist()
        compose.onNodeWithText("Through the session").assertExists()
        assertEquals(2, calls)
    }

    @Test fun aRecordingThatIsntThereSaysSoWithNoTryAgain() {
        var back = 0
        show { BoatMotionScreen(tracker, load = { throw ApiFailure("Not found", 404) }, onBack = { back++ }) }
        compose.onNodeWithText(MOTION_NOT_FOUND).assertExists()
        compose.onNodeWithText("Try again").assertDoesNotExist()
        compose.onNodeWithText(MOTION_FAILED).assertDoesNotExist()
        golden("not-found")
        compose.onNodeWithText("Back to the paddle").performClick()
        assertEquals(1, back)
    }

    // The website's ReadError: Try again's button goes while loading, so a second failure puts focus on the error.
    @Test fun aTryAgainThatFailsAgainPutsFocusOnTheError() {
        var calls = 0
        show { BoatMotionScreen(tracker, load = { calls++; throw ApiFailure("Couldn’t finish that. Please try again.", 503, generic = true) }) }
        compose.onNodeWithText(MOTION_FAILED).assertExists()
        compose.onNode(isFocused()).assertDoesNotExist()                     // the first failure leaves focus alone
        compose.onNodeWithText("Try again").performClick()
        compose.waitForIdle()
        assertEquals(2, calls)
        compose.onNode(isFocused() and hasAnyDescendant(hasText(MOTION_FAILED))).assertExists()
    }

    // The website's heights whatever the width, and at large text (the text grows, the charts don't shrink it).
    @Test fun theChartsAreTheWebsitesHeight() {
        show(fontScale = 2f) { BoatMotionScreen(tracker, load = { motion("account.devices-session.json") }) }
        fun height(label: String) = compose.onNodeWithContentDescription(label, substring = true).fetchSemanticsNode().size.height
        val dp = { v: Int -> with(compose.density) { v.dp.roundToPx() } }
        assertEquals(dp(260), height("Roll and pitch through the session"))
        assertEquals(dp(260), height("Thirty seconds of roll and pitch"))
        assertEquals(dp(230), height("Distribution of boat lean"))
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

    // Lead, 2026-11-03: a tracker syncs from the Trackers list; a phone's uploads are under Record on Paddles.
    @Test fun openTrackerGoesToTheTrackersList() {
        var trackers = 0
        show { PaddlesHost(list, sample = false, load = { tracker }, map = fakeMap, openPaddle = "pdl-river",
            loadMotion = { motion("account.devices-session.no-motion.json") }, onTrackers = { trackers++ }) }
        compose.onNodeWithText("Boat motion").performScrollTo().performClick()
        compose.onNodeWithText("Open tracker").performClick()
        assertEquals(1, trackers)
    }

    @Test fun openPhoneGoesBackToThePaddlesList() {
        val phone = paddle("paddles.get.with-phone.json")
        show { PaddlesHost(list, sample = false, load = { phone }, map = fakeMap, openPaddle = "pdl-phone",
            loadMotion = { motion("account.devices-session.no-motion.json") }, onTrackers = { error("not for a phone") }) }
        compose.onNodeWithText("Boat motion").performScrollTo().performClick()
        compose.onNodeWithText("Open phone").performClick()
        compose.onNodeWithText("← Paddle").assertDoesNotExist()
        compose.onNodeWithText("← Paddles").assertDoesNotExist()                   // the list, with its upload lines
    }

    @Test fun aPaddleNotFromATrackerHasNoBoatMotion() {
        val strava = paddle("paddles.get.strava.json")
        show { PaddlesHost(list, sample = true, load = { strava }, map = fakeMap, openPaddle = "pdl-strava", loadMotion = { error("not asked") }) }
        compose.onNodeWithText(PaddleDetail(strava).title).assertExists()
        compose.onNode(hasText("Boat motion") and hasClickAction()).assertDoesNotExist()
    }

    @Test fun aChartWithTooFewPointsKeepsItsPanelButDrawsNothing() {
        val sparse = motion("account.devices-session.json").let { m ->
            m.copy(attitude = m.attitude!!.copy(envelope = m.attitude!!.envelope.take(1), excerpt = emptyList(), rollHistogram = null))
        }
        show { BoatMotionScreen(tracker, load = { sparse }) }
        listOf("Through the session", "Stroke shape", "Where the boat spent its time").forEach {
            compose.onNode(hasScrollAction()).performScrollToNode(hasText(it))
        }
        listOf("The shaded band shows", "30 seconds of typical paddling", "Bars show how often").forEach {
            compose.onNode(hasScrollAction()).performScrollToNode(hasText(it, substring = true))
        }
        listOf("Roll and pitch through the session", "Thirty seconds", "Distribution of boat lean").forEach {
            compose.onNode(hasContentDescription(it, substring = true)).assertDoesNotExist()
        }
    }

    @Test fun rollAndPitchThatWereHardToTellApartSaySo() {
        val m = motion("account.devices-session.json")
        show { BoatMotionScreen(tracker, load = { m.copy(attitude = m.attitude!!.copy(axisConfident = false)) }) }
        compose.onNode(hasScrollAction()).performScrollToNode(hasText("Roll and pitch were hard to tell apart in this recording.", substring = true))
    }

    @Test fun aClippedSessionSaysSoUnderTheChart() {
        val m = motion("account.devices-session.json")
        show { BoatMotionScreen(tracker, load = { m.copy(attitude = m.attitude!!.copy(plotBoundDeg = 5.0)) }) }
        compose.onNodeWithText("A few moments went past ±5° and are clipped at the chart’s edge.").performScrollTo()
        golden("clipped")
    }

    @Test fun loadingSaysSo() {
        val never = kotlinx.coroutines.CompletableDeferred<RecordingMotion>()
        show { BoatMotionScreen(tracker, load = { never.await() }) }
        compose.onNodeWithText("Loading").assertExists()
        golden("loading")
    }

    @Test fun atSlightlyLargerTextTheTileLabelsStillRead() {
        show(fontScale = 1.3f) { BoatMotionScreen(tracker, load = { motion("account.devices-session.json") }) }
        golden("measured.text-1.3")
    }

    @Test @Config(qualifiers = "w800dp-h1280dp") fun onATabletTheTilesAreFourAcross() {
        show { BoatMotionScreen(tracker, load = { motion("account.devices-session.json") }) }
        golden("tablet")
    }

    @Test fun backFromBoatMotionReturnsToTheSamePlaceOnThePaddle() {
        show { PaddlesHost(list, sample = true, load = { tracker }, map = fakeMap, openPaddle = "pdl-river", loadMotion = { motion("account.devices-session.json") }) }
        compose.onNodeWithText("Boat motion").performScrollTo()
        compose.onNodeWithText("Efforts and rests").performScrollTo()
        val before = compose.onNodeWithText("Efforts and rests").fetchSemanticsNode().positionInRoot
        compose.onNodeWithText("Boat motion").performScrollTo().performClick()
        compose.onNodeWithText("← Paddle").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Boat motion").assertExists()
        val after = compose.onNodeWithText("Efforts and rests").fetchSemanticsNode().positionInRoot
        assertEquals(before.y, after.y, 1f)
    }

    @Test fun onlyTheSampleWithAMotionAnswerOffersIt() {
        val noGps = paddle("paddles.get.motion-only.json")
        show { PaddlesHost(list, sample = true, load = { noGps }, map = fakeMap, openPaddle = "pdl-motion", loadMotion = { error("not asked") },
            offersMotion = { it.source.deviceSessionId == com.paddlesnitch.app.SAMPLE_MOTION_RECORDING }) }
        compose.onNodeWithText(PaddleDetail(noGps).title).assertExists()
        compose.onNode(hasText("Boat motion") and hasClickAction()).assertDoesNotExist()
    }
}
