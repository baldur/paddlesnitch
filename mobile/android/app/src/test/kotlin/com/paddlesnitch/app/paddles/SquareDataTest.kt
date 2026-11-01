package com.paddlesnitch.app.paddles

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// Data stays square (design system: no rounded corners on tables, charts, maps).
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class SquareDataTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private fun image(content: @androidx.compose.runtime.Composable () -> Unit) = compose.run {
        setContent { PaddlesnitchTheme { Box(Modifier.background(Color.Black).testTag("d")) { content() } } }
        onNodeWithTag("d").captureToImage().toPixelMap()
    }
    private val dp get() = compose.activity.resources.displayMetrics.density

    // One week at the top: its bar fills the chart's very first and last pixel of the top row.
    @Test fun theWeeklyBarsAreSquare() {
        val px = image { Column { WeeksChart(listOf(5.0)) } }
        assertEquals(PsColor.primaryText, px[0, 0])
        assertEquals(PsColor.primaryText, px[px.width - 1, 0])
    }

    // The colour key starts 16 dp in and 8 dp down (its padding): that pixel is the key, not the ground.
    @Test fun theColourKeyIsSquare() {
        val px = image { Legend("2:30" to "2:00") }
        val x = (16 * dp).toInt(); val y = (8 * dp).toInt()
        assertNotEquals(PsColor.surface, px[x, y])
        assertNotEquals(PsColor.surface, px[px.width - 1 - x, y])
    }
}
