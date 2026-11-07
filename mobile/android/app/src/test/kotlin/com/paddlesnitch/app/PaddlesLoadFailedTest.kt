package com.paddlesnitch.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.auth.MemoryTokenStore
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import java.io.File
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// #892: a Paddles list that fails to load says so in our words, as web and iPhone do, never the exception's.
@RunWith(RobolectricTestRunner::class)
class PaddlesLoadFailedTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val server = MockWebServer()
    private val tokens = MemoryTokenStore()
    private lateinit var api: Api

    @Before fun start() { server.start(); api = Api(server.url("/").toString(), tokens, "0.1.0"); tokens.save("id-1", "r-1") }
    @After fun stop() = server.close()

    private val technical = "upstream DynamoDB ThrottlingException: token state invalid"

    private fun show() = compose.setContent {
        PaddlesnitchTheme {
            MyPaddles(api, openPaddle = null, onOpened = {}, added = 0, pick = {}, adding = false,
                onSignedOut = {}, onAccount = {}, onTrackers = {}, modifier = Modifier, recordEntry = null, onReport = {})
        }
    }
    private fun waitFor(text: String) = compose.waitUntil(5_000) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    @Test fun aFailedListSaysCouldntLoadYourPaddlesNotTheRawMessage() {
        // tRPC's own error shape: nothing in it is ours to show.
        server.enqueue(MockResponse.Builder().code(500).body("""{"error":{"message":"$technical","code":-32603}}""").build())
        show()
        waitFor("Couldn’t load your paddles")
        compose.onNodeWithText(technical, substring = true).assertDoesNotExist()
        compose.onNodeWithText("ThrottlingException", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Try again").assertExists()
    }

    // A list the app can't read fails with the parser's own words: those never show either.
    @Test fun aListThatCantBeReadSaysTheSame() {
        server.enqueue(MockResponse.Builder().code(200).body("""{"result":{"data":{"unexpected":true}}}""").build())
        show()
        waitFor("Couldn’t load your paddles")
        compose.onNodeWithText("unexpected", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Field", substring = true).assertDoesNotExist()
        compose.onNodeWithText("JSON", substring = true).assertDoesNotExist()
    }

    // The server's own words ({"error": …}, written for people) go on a muted line under ours, as on iPhone.
    @Test fun theServersOwnWordsGoUnderneath() {
        server.enqueue(MockResponse.Builder().code(503).body("""{"error":"Paddles are resting. Please try again soon."}""").build())
        show()
        waitFor("Couldn’t load your paddles")
        compose.onNodeWithText("Paddles are resting. Please try again soon.").assertExists()
    }

    @Test fun offlineSaysCheckYourConnection() {
        server.close()
        show()
        waitFor("Couldn’t load your paddles")
        compose.onNodeWithText("Couldn’t reach paddlesnitch. Check your connection and try again.").assertExists()
    }

    private val listJson = """{"result":{"data":${File("../../contract/fixtures/api/paddles.list.json").readText()}}}"""

    // A refresh that fails while a list is showing keeps the list and says so (iPhone: PaddleListModel), and a good one clears it.
    @Test fun aFailedRefreshKeepsTheListAndSaysSo() {
        server.enqueue(MockResponse.Builder().code(200).body(listJson).build())
        server.enqueue(MockResponse.Builder().code(500).body("""{"error":{"message":"$technical"}}""").build())
        server.enqueue(MockResponse.Builder().code(200).body(listJson).build())
        var added by mutableIntStateOf(0)
        compose.setContent {
            PaddlesnitchTheme {
                MyPaddles(api, openPaddle = null, onOpened = {}, added = added, pick = {}, adding = false,
                    onSignedOut = {}, onAccount = {}, onTrackers = {}, modifier = Modifier, recordEntry = null, onReport = {})
            }
        }
        waitFor("Add paddle")
        added++
        waitFor("Couldn’t refresh your paddles.")
        compose.onNodeWithText("Add paddle").assertExists()
        compose.onNodeWithText("Couldn’t load your paddles").assertDoesNotExist()
        compose.onNodeWithText(technical, substring = true).assertDoesNotExist()
        added++
        compose.waitUntil(5_000) { compose.onAllNodes(hasText("Couldn’t refresh your paddles.", substring = true)).fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithText("Add paddle").assertExists()
    }

    @Test fun tryAgainAsksForTheListAgain() {
        server.enqueue(MockResponse.Builder().code(500).body("""{"error":{"message":"$technical"}}""").build())
        server.enqueue(MockResponse.Builder().code(500).body("""{"error":{"message":"$technical"}}""").build())
        show()
        waitFor("Couldn’t load your paddles")
        compose.onNodeWithText("Try again").performClick()
        compose.waitUntil(5_000) { server.requestCount == 2 }
        waitFor("Couldn’t load your paddles")
        assertEquals("/api/trpc/paddles.list", server.takeRequest().url.encodedPath)
    }
}
