package com.paddlesnitch.app.paddles

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// The add-paddle card: the same states and words as the iPhone app's.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class AddPaddleCardTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val did = mutableListOf<String>()

    private fun show(card: AddCard) = compose.setContent {
        PaddlesnitchTheme {
            Surface(color = PsColor.bg) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                    AddPaddleCard(card, onOpen = { did += "open $it" }, onSignIn = { did += "sign in" }, onClose = { did += "close" })
                }
            }
        }
    }

    @Test fun addingCantBeClosed() {
        show(AddCard.Adding("Morning.gpx"))
        compose.onNodeWithText("Adding Morning.gpx…").assertExists()
        compose.onNodeWithContentDescription("Close").assertDoesNotExist()
        compose.onRoot().captureRoboImage()
    }

    @Test fun addedOpensThePaddle() {
        show(AddCard.Added("pdl-river", duplicate = false))
        compose.onNodeWithText("Paddle added.").assertExists()
        compose.onNodeWithText("Open paddle").performClick()
        compose.onNodeWithContentDescription("Close").performClick()
        assertEquals(listOf("open pdl-river", "close"), did)
        compose.onRoot().captureRoboImage()
    }

    @Test fun aDuplicateSaysSo() {
        show(AddCard.Added("pdl-river", duplicate = true))
        compose.onNodeWithText("You’ve already added this paddle.").assertExists()
    }

    @Test fun aFailureShowsTheReason() {
        show(AddCard.Failed(TOO_BIG))
        compose.onNodeWithText(TOO_BIG).assertExists()
        compose.onRoot().captureRoboImage()
    }

    @Test fun signedOutAsksToSignIn() {
        show(AddCard.SignInToAdd("Morning.gpx"))
        compose.onNodeWithText("Sign in to add Morning.gpx.").assertExists()
        compose.onNodeWithText("Sign in").performClick()
        assertEquals(listOf("sign in"), did)
    }
}
