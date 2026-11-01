package com.paddlesnitch.app.paddles

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
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
import org.junit.Assert.assertEquals
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

    /** Two columns of pixels, top to bottom: 4 dp in from the right edge, and the edge itself. */
    private class Sides(val inside: List<androidx.compose.ui.graphics.Color>, val edge: List<androidx.compose.ui.graphics.Color>)
    private fun sides(content: @androidx.compose.runtime.Composable () -> Unit): Sides {
        compose.setContent { PaddlesnitchTheme { Box(Modifier.background(PsColor.bg).testTag("t")) { content() } } }
        val px = compose.onNodeWithTag("t").captureToImage().toPixelMap()
        // 4 dp in: inside where a box's 1 dp outline would be, so its fill would show. No column's words reach either.
        val x = px.width - 1 - (4 * compose.activity.resources.displayMetrics.density).toInt()
        return Sides((0 until px.height).map { px[x, it] }, (0 until px.height).map { px[px.width - 1, it] })
    }
    /** The thin lines down a column: each run of pixels that aren't the ground, as its length. */
    private fun lines(column: List<androidx.compose.ui.graphics.Color>): List<Int> {
        val runs = mutableListOf<Int>(); var n = 0
        column.forEach { if (it != PsColor.bg) n++ else if (n > 0) { runs += n; n = 0 } }
        if (n > 0) runs += n
        return runs
    }
    /** No fill, and down the very edge only a row border per row: an outline box would draw one long line there. */
    private fun assertRowBordersOnly(s: Sides, rows: Int) {
        assertTrue("a filled box", PsColor.surface !in s.inside)
        val edge = lines(s.edge)
        assertEquals("one border per row, $edge", rows, edge.size)
        val thin = (2 * compose.activity.resources.displayMetrics.density).toInt() + 1
        assertTrue("a line down the side, $edge", edge.all { it <= thin })
    }

    private val splits = listOf(SplitRow("0.5", "2:31", "2:31", "62"), SplitRow("1", "5:04", "2:33", "61"), SplitRow("1.5", "7:40", "2:36", "60"))

    @Test fun theSplitsHaveNoBox() {
        assertRowBordersOnly(sides { Splits(splits) }, splits.size)   // the header row has none above it
    }

    @Test fun theEffortsHaveNoBox() {
        assertTrue(d.efforts.isNotEmpty())
        assertRowBordersOnly(sides { Efforts(d) }, d.efforts.size)
    }

    // The fixture paddle is too short for a 500 m split, so the paddle page goldens never show one.
    private fun splitsGolden(name: String, fontScale: Float) {
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
                PaddlesnitchTheme { androidx.compose.material3.Surface(color = PsColor.bg) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(32.dp)) { Efforts(d); Splits(splits) } } }
            }
        }
        compose.onRoot().captureRoboImage("src/test/screenshots/com.paddlesnitch.app.paddles.SquareTablesTest.$name.png")
    }
    @Test fun tablesGolden() = splitsGolden("tables", 1f)
    @Test fun tablesAtTheLargestTextGolden() = splitsGolden("tables.large-text", 2f)
}
