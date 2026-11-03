package com.paddlesnitch.app.paddles

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
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
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.api.SameOuting
import com.paddlesnitch.app.api.SameOutingList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// The list and the paddle page in Compose on the JVM (Robolectric), with
// screenshot goldens in src/test/screenshots (Roborazzi). MapLibre can't draw
// here, so the map is a stand-in.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class PaddleScreensTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val fixtures = File("../../contract/fixtures")
    private val list = ApiJson.decodeFromString(PaddleList.serializer(), fixtures.resolve("api/paddles.list.json").readText())
    private fun paddle(id: String) = ApiJson.decodeFromString(AnalysisSession.serializer(), fixtures.resolve(sampleFile(id)).readText())

    private val fakeMap: MapSlot = { _, m ->
        Box(m.background(PsColor.surface2), contentAlignment = Alignment.Center) { Text("map", color = PsColor.muted) }
    }

    private fun show(fontScale: Float = 1f, content: @Composable () -> Unit) = compose.setContent {
        val density = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
            PaddlesnitchTheme { Surface(color = PsColor.bg) { content() } }
        }
    }

    @Test
    fun tappingACardOpensItsPaddleAndBackReturns() {
        show { PaddlesHost(list, sample = true, load = { paddle(it) }, map = fakeMap) }
        compose.onNode(hasScrollAction()).performScrollToNode(hasText("Headwind on the way back."))
        compose.onNode(hasText("Headwind on the way back.") and hasClickAction()).performClick()
        compose.onNodeWithText("← Paddles").assertExists()
        compose.onNodeWithText("Efforts and rests").assertExists()
        compose.onNodeWithText("48.2 m³/s").assertExists()

        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("← Paddles").assertDoesNotExist()
        compose.onNodeWithText("Sample paddles. Sign in to see your own.").assertExists()
    }

    @Test
    fun thePagesOwnBackReturnsToo() {
        show { PaddlesHost(list, sample = true, load = { paddle(it) }, map = fakeMap) }
        compose.onNode(hasText("0:19", substring = true) and hasClickAction()).performClick()
        compose.onNodeWithText("← Paddles").performClick()
        compose.onNodeWithText("Sample paddles. Sign in to see your own.").assertExists()
    }

    private fun pending(id: String) = paddle(id).let { it.copy(insight = "", insightPending = true, result = it.result.copy(insight = "")) }
    private fun openRiver() {
        compose.onNode(hasScrollAction()).performScrollToNode(hasText("Headwind on the way back."))
        compose.onNode(hasText("Headwind on the way back.") and hasClickAction()).performClick()
    }

    @Test
    fun aPendingSummaryIsAskedForAndShownWhenWritten() {
        var asked: String? = null
        show { PaddlesHost(list, sample = true, load = { pending(it) }, writeSummary = { asked = it; paddle(it).copy(insight = "Written just now.") }, map = fakeMap) }
        openRiver()
        compose.onNodeWithText("Written just now.").assertExists()
        compose.onNodeWithText("Writing your summary…").assertDoesNotExist()
        assert(asked == "pdl-river")
    }

    @Test
    fun aSummaryThatCantBeWrittenStopsSayingItIsBeingWritten() {
        show { PaddlesHost(list, sample = true, load = { pending(it) }, writeSummary = { error("offline") }, map = fakeMap) }
        openRiver()
        compose.onNodeWithText("Efforts and rests").assertExists()
        compose.onNodeWithText("Writing your summary…").assertDoesNotExist()
    }

    @Test
    fun aLinkOpensItsPaddle() {
        var opened = false
        show { PaddlesHost(list, sample = true, load = { paddle(it) }, map = fakeMap, openPaddle = "pdl-river", onOpened = { opened = true }) }
        compose.onNodeWithText("← Paddles").assertExists()
        assertTrue(opened)
    }

    @Test
    fun aPaddleThatIsntThereSaysSoWithoutTryAgain() {
        show { PaddlesHost(list, sample = true, load = { throw ApiFailure("Not found", 404) }, map = fakeMap, openPaddle = "gone") }
        compose.onNodeWithText("We can’t find this paddle.").assertExists()
        compose.onNodeWithText("Try again").assertDoesNotExist()
    }

    @Test
    fun aPaddleThatWontLoadCanBeTriedAgain() {
        show { PaddlesHost(list, sample = true, load = { throw ApiFailure("Couldn’t finish that. Please try again.", 500, generic = true) }, map = fakeMap, openPaddle = "x") }
        compose.onNodeWithText("Couldn’t open this paddle. Please try again.").assertExists()
        compose.onNodeWithText("Try again").assertExists()
    }

    // #789: the contract's example of a phone's paddle, and a tracker's with the phone's under it.
    @Test
    fun phonePaddlesSayPhoneNeverTracker() {
        val withPhone = ApiJson.decodeFromString(PaddleList.serializer(), fixtures.resolve("api/paddles.list.with-phone.json").readText())
        show { PaddlesScreen(withPhone, sample = false, action = {}) }
        compose.onNodeWithText("Sat, 31 Oct 2026 · Phone").assertExists()
        compose.onNodeWithText("Sat, 24 Oct 2026 · Tracker").assertExists()
        compose.onNodeWithText("Also recorded by Strava").assertExists()
        compose.onNodeWithText("Also recorded by the phone").assertExists()
        compose.onNodeWithText("Also recorded by the tracker").assertDoesNotExist()
    }

    // ---- Same outing (mobile/contract/README.md § Same outing, #805).
    private val withPhone by lazy { ApiJson.decodeFromString(PaddleList.serializer(), fixtures.resolve("api/paddles.list.with-phone.json").readText()) }
    private fun sameOuting(name: String) =
        ApiJson.decodeFromString(ListSerializer(SameOuting.serializer()), fixtures.resolve("api/$name.json").readText())
    private val asked = mutableListOf<Pair<String, String>>()
    private val record: suspend (String, String) -> Unit = { a, b -> asked += a to b }
    private fun row(who: String) = compose.onNodeWithContentDescription("Compare with the recording from $who")
    /** The list is lazy: a row below the fold isn't composed until the list scrolls to it. */
    private fun rowInList(who: String) = row(who).also {
        compose.onNode(hasScrollAction()).performScrollToNode(hasContentDescription("Compare with the recording from $who"))
    }

    @Test
    fun aSameOutingRowAsksForCompareAndDoesntOpenThePaddle() {
        show { PaddlesHost(withPhone, sample = false, load = { paddle(it) }, map = fakeMap, openCompare = record) }
        rowInList("the phone").performClick()
        compose.waitForIdle()
        assertEquals(listOf("pdl-tracker" to "pdl-phone2"), asked)
        compose.onNodeWithText("← Paddles").assertDoesNotExist()                      // the card's tap didn't fire
        rowInList("Strava").performClick()
        compose.waitForIdle()
        assertEquals("pdl-phone" to "pdl-strava", asked.last())
        compose.onAllNodesWithText("Compare →").assertCountEquals(2)
    }

    @Test
    fun eachRowIsOneButtonReadAsCompareWithoutTheArrow() {
        show { PaddlesHost(withPhone, sample = false, load = { paddle(it) }, map = fakeMap, openCompare = record) }
        val node = row("the phone").fetchSemanticsNode()
        assertEquals(Role.Button, node.config[SemanticsProperties.Role])
        assertTrue(node.config.contains(SemanticsActions.OnClick))
        assertEquals(listOf("Compare with the recording from the phone"), node.config[SemanticsProperties.ContentDescription])
        assertTrue("at least 48 dp: ${node.boundsInRoot}", node.boundsInRoot.height >= with(compose.density) { 48.dp.toPx() } - 0.5f)
    }

    @Test
    fun whileCompareIsAskedTheRowSpinsAndTakesNoMoreTaps() {
        val answer = CompletableDeferred<Unit>()
        show { PaddlesHost(withPhone, sample = false, load = { paddle(it) }, map = fakeMap, openCompare = { a, b -> asked += a to b; answer.await() }) }
        rowInList("the phone").performClick()
        row("the phone").performClick()
        rowInList("Strava").performClick()                                  // each code works once: one at a time
        compose.waitForIdle()
        assertEquals(listOf("pdl-tracker" to "pdl-phone2"), asked)
        compose.onAllNodesWithText("Compare →").assertCountEquals(1)                   // the tapped row shows a spinner instead
        answer.complete(Unit)
        compose.waitForIdle()
        compose.onAllNodesWithText("Compare →").assertCountEquals(2)
    }

    @Test
    fun aFailedWebCodeSaysSoAndLeavesThePageAsItWas() {
        show { PaddlesHost(withPhone, sample = false, load = { paddle(it) }, map = fakeMap,
            openCompare = { _, _ -> throw ApiFailure("Couldn’t finish that. Please try again.", 500, generic = true) }) }
        rowInList("the phone").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText(COMPARE_FAILED).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("← Paddles").assertDoesNotExist()                      // still the list, nothing opened
        compose.onNode(hasContentDescription("Compare with the recording from the phone") and hasText("Compare →")).assertExists()   // no spinner left
    }

    @Test
    fun theSamplesShowWhoElseRecordedItButDontLink() {
        show { PaddlesHost(withPhone, sample = true, load = { paddle(it) }, map = fakeMap, sameOuting = { sameOuting("paddles.sameOuting") }) }
        compose.onNodeWithText("Also recorded by the phone").assertExists()
        compose.onAllNodesWithText("Compare →").assertCountEquals(0)
        row("the phone").assertDoesNotExist()
    }

    private fun showPage(links: suspend (String) -> SameOutingList, fontScale: Float = 1f) = show(fontScale) {
        PaddlesHost(list, sample = false, load = { paddle("pdl-river") }, map = fakeMap, openPaddle = "pdl-tracker", sameOuting = links, openCompare = record)
    }

    @Test
    fun thePaddlePageLinksAfterTheSummaryAndBeforeEfforts() {
        showPage({ sameOuting("paddles.sameOuting") })
        val link = compose.onNodeWithText("Also recorded by the phone →").performScrollTo()
        // positionInRoot, not boundsInRoot: bounds are clipped to the screen, so anything below it reads 0.
        val top = { n: androidx.compose.ui.test.SemanticsNodeInteraction -> n.fetchSemanticsNode().positionInRoot.y }
        val summary = top(compose.onNodeWithText("A 3-min paddle", substring = true))
        val efforts = top(compose.onNodeWithText("Efforts and rests"))
        assertTrue("summary $summary, link ${top(link)}, efforts $efforts", summary < top(link) && top(link) < efforts)
        row("the phone").performClick()
        compose.waitForIdle()
        assertEquals(listOf("pdl-tracker" to "pdl-phone2"), asked)                    // this paddle is a
    }

    @Test
    fun thePaddlePageWithNoOtherRecordingShowsNothing() {
        showPage({ sameOuting("paddles.sameOuting.none") })
        compose.onNodeWithText("Efforts and rests").assertExists()
        compose.onNodeWithText("Also recorded by", substring = true).assertDoesNotExist()
    }

    @Test
    fun aFailedSameOutingCallShowsNothingNotAnError() {
        showPage({ throw ApiFailure("Couldn’t finish that. Please try again.", 500, generic = true) })
        compose.onNodeWithText("Efforts and rests").assertExists()
        compose.onNodeWithText("Also recorded by", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Couldn’t", substring = true).assertDoesNotExist()
    }

    @Test
    fun sameOutingRowsAtLargeText() {
        show(fontScale = 2f) { PaddlesHost(withPhone, sample = false, load = { paddle(it) }, map = fakeMap, openCompare = record) }
        rowInList("the phone")
        compose.onRoot().captureRoboImage("src/test/screenshots/com.paddlesnitch.app.paddles.PaddleScreensTest.sameOutingRows.large-text.png")
    }

    @Test
    fun sameOutingLinkAtLargeText() {
        showPage({ sameOuting("paddles.sameOuting") }, fontScale = 2f)
        compose.onNodeWithText("Also recorded by the phone →").performScrollTo()
        compose.onRoot().captureRoboImage("src/test/screenshots/com.paddlesnitch.app.paddles.PaddleScreensTest.sameOutingLink.large-text.png")
    }

    @Test
    fun compareIsAskedForWithBothIds() = assertEquals("/paddles/compare?a=pdl-tracker&b=pdl-phone2", com.paddlesnitch.app.compareNext("pdl-tracker", "pdl-phone2"))

    @Test
    fun paddlesList() {
        show { PaddlesScreen(list, sample = true, action = { Text("Sign in") }) }
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun paddlePage() {
        show { PaddlePage(PaddleDetail(paddle("pdl-river")), fakeMap) }
        compose.onRoot().captureRoboImage()
        compose.onNodeWithText("29 s at 1:23").performScrollTo()
        compose.onRoot().captureRoboImage("src/test/screenshots/com.paddlesnitch.app.paddles.PaddleScreensTest.paddlePage.scrolled.png")
    }

    @Test
    fun paddlePageWithoutGps() {
        show { PaddlePage(PaddleDetail(paddle("pdl-motion")), fakeMap) }
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun paddlePageAtTheLargestText() {
        show(fontScale = 2f) { PaddlePage(PaddleDetail(paddle("pdl-river")), fakeMap) }
        compose.onRoot().captureRoboImage()
    }
}
