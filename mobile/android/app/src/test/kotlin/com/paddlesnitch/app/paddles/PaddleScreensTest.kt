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
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.PaddleList
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import java.io.File
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
