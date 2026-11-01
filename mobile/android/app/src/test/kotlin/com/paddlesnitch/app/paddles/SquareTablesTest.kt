package com.paddlesnitch.app.paddles

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.paddlesnitch.app.api.AnalysisSession
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// #826: the splits table and the efforts list are data, so they sit on the page's ground with a
// border above each row, as the website's tables, never in a filled, rounded box.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class SquareTablesTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val d = PaddleDetail(ApiJson.decodeFromString(AnalysisSession.serializer(), File("../../contract/fixtures/api/paddles.get.json").readText()))

    /** Down the right-hand side, top to bottom: no column's words reach it, so it shows the ground and the row borders (and their soft edges). */
    private fun rightEdge(content: @androidx.compose.runtime.Composable () -> Unit): Set<androidx.compose.ui.graphics.Color> {
        compose.setContent { PaddlesnitchTheme { Box(Modifier.background(PsColor.bg).testTag("t")) { content() } } }
        val px = compose.onNodeWithTag("t").captureToImage().toPixelMap()
        // 4 dp in: inside where a box's 1 dp outline would be, so its fill would show.
        val x = px.width - 1 - (4 * compose.activity.resources.displayMetrics.density).toInt()
        return (0 until px.height).map { px[x, it] }.toSet()
    }

    @Test fun theSplitsHaveNoBox() {
        val edge = rightEdge { Splits(listOf(SplitRow("0.5", "2:31", "2:31", "62"), SplitRow("1", "5:04", "2:33", "61"))) }
        assertTrue("a filled box at the edge", PsColor.surface !in edge)
        assertTrue("no row borders", PsColor.border in edge)
    }

    @Test fun theEffortsHaveNoBox() {
        assertTrue(d.efforts.isNotEmpty())
        val edge = rightEdge { Efforts(d) }
        assertTrue("a filled box at the edge", PsColor.surface !in edge)
        assertTrue("no row borders", PsColor.border in edge)
    }
}
