package com.paddlesnitch.app.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// #793: buttons have the design system's control radius (tokens.json radius.control, the
// website's rounded-control), never M3's pill.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class ButtonShapeTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val control = JSONObject(File("../../contract/tokens/tokens.json").readText()).getJSONObject("radius").getInt("control")

    @Test fun theButtonShapeIsTheTokensControlRadius() {
        assertEquals(RoundedCornerShape(control.dp), ControlShape)
        // A 40 x 100 button's top-left corner is a 6 dp arc, not a 20 dp half-circle.
        val o = ControlShape.createOutline(Size(100f, 40f), LayoutDirection.Ltr, Density(1f)) as Outline.Rounded
        assertEquals(control.toFloat(), o.roundRect.topLeftCornerRadius.x)
    }

    // Drawn: 3 dp in from each corner is inside a 6 dp arc but outside M3's pill.
    @Test fun aFilledButtonFillsItsCorners() {
        compose.setContent {
            PaddlesnitchTheme {
                Box(Modifier.background(Color.Black).padding(8.dp)) {
                    Button(onClick = {}, modifier = Modifier.testTag("b"), colors = ButtonDefaults.buttonColors(containerColor = Color.White), elevation = null) { Text("Save") }
                }
            }
        }
        val px = compose.onNodeWithTag("b").captureToImage().toPixelMap()
        val d = compose.activity.resources.displayMetrics.density
        val inset = (3 * d).toInt()
        // M3 adds no space around a button whose minimum size it already meets, so the image is the button.
        listOf(inset to inset, px.width - 1 - inset to inset, inset to px.height - 1 - inset, px.width - 1 - inset to px.height - 1 - inset).forEach { (x, y) ->
            assertNotEquals("corner at $x,$y is background", Color.Black, px[x, y])
        }
    }

    // M3's buttons take their pill from a fixed token, not the theme, so screens use ui/Buttons.kt's.
    @Test fun noScreenUsesMaterialsButtons() {
        val m3 = Regex("""androidx\.compose\.material3\.(Button|OutlinedButton|TextButton|FilledTonalButton|ElevatedButton)\b(?!Defaults|Colors|Elevation)""")
        val found = File("src/main/kotlin").walk().filter { it.extension == "kt" && it.name != "Buttons.kt" }
            .flatMap { f -> f.readLines().mapIndexedNotNull { i, l -> if (m3.containsMatchIn(l)) "${f.name}:${i + 1}" else null } }.toList()
        assertEquals(emptyList<String>(), found)
    }
}
