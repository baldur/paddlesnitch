package com.paddlesnitch.app

import androidx.browser.customtabs.CustomTabsIntent
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.auth.MemoryTokenStore
import java.io.File
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// What a signed-in Paddles is given for the same outing (README § Same outing): the real calls, and
// Compare opened in the named browser, privately where it can be.
@RunWith(RobolectricTestRunner::class)
class SameOutingCallsTest {
    private val server = MockWebServer()
    private val tokens = MemoryTokenStore()
    private lateinit var api: Api
    private val opened = mutableListOf<Pair<String, Boolean>>()

    @Before fun start() { server.start(); api = Api(server.url("/").toString(), tokens, "0.1.0"); tokens.save("id-1", "r-1") }
    @After fun stop() = server.close()

    private fun answer(body: String) = server.enqueue(MockResponse.Builder().code(200).body(body).build())

    @Test fun thePaddlePageAsksTheServerWhoElseRecordedIt() = runTest {
        answer("""{"result":{"data":${File("../../contract/fixtures/api/paddles.sameOuting.json").readText()}}}""")
        val calls = sameOutingCalls(api) { url, private -> opened += url to private; true }
        assertEquals("pdl-phone2", calls.sameOuting("pdl-tracker").single().id)
        assertEquals("/api/trpc/paddles.sameOuting", server.takeRequest().url.encodedPath)
    }

    @Test fun compareIsTheWebsitesPageSignedInAndOpenedPrivately() = runTest {
        answer("""{"url":"https://paddlesnitch.com/att/api/auth/web-code?code=abc"}""")
        sameOutingCalls(api) { url, private -> opened += url to private; true }.openCompare("pdl-tracker", "pdl-phone2")
        assertEquals("""{"next":"/paddles/compare?a=pdl-tracker&b=pdl-phone2"}""", server.takeRequest().body!!.utf8())
        assertEquals(listOf("https://paddlesnitch.com/att/api/auth/web-code?code=abc" to true), opened)
    }

    @Test fun noBrowserIsAFailureTheScreenShows() = runTest {
        answer("""{"url":"https://paddlesnitch.com/att/api/auth/web-code?code=abc"}""")
        val e = runCatching { sameOutingCalls(api) { _, _ -> false }.openCompare("a", "b") }.exceptionOrNull()
        assertTrue("$e", e is IllegalStateException)
    }

    @Test fun idsAreEncodedInTheComparePath() =
        assertEquals("/paddles/compare?a=a%26b%3Dc&b=d%20e", compareNext("a&b=c", "d e"))

    @Test fun theTabIsTheNamedBrowserPrivateOnlyWhenAsked() {
        val private = customTab("com.example.browser", ephemeral = true).intent
        assertEquals("com.example.browser", private.`package`)
        assertEquals(true, private.getBooleanExtra(CustomTabsIntent.EXTRA_ENABLE_EPHEMERAL_BROWSING, false))
        assertEquals(false, customTab("com.example.browser", ephemeral = false).intent.getBooleanExtra(CustomTabsIntent.EXTRA_ENABLE_EPHEMERAL_BROWSING, false))
    }
}
