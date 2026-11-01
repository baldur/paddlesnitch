package com.paddlesnitch.app

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// What MainActivity's intents ask the app to do: a link to one paddle opens it,
// other paddlesnitch.com links go back to the browser, a shared or opened file is added.
class IncomingTest {
    private val view = "android.intent.action.VIEW"
    private val send = "android.intent.action.SEND"

    @Test fun aLinkToOnePaddleOpensIt() {
        assertEquals(Incoming.OpenPaddle("Xy3_k-9"), incoming(view, "https://paddlesnitch.com/paddles/Xy3_k-9", null))
        assertEquals(Incoming.OpenPaddle("Xy3_k-9"), incoming(view, "https://paddlesnitch.com/paddles/Xy3_k-9/?utm=x#map", null))
    }

    @Test fun otherPaddlesPagesGoBackToTheBrowser() {
        listOf("/paddles/", "/paddles/new", "/paddles/compare?a=1", "/paddles/sections", "/paddles/shared/abc", "/paddles/Xy3/motion").forEach {
            assertEquals(it, Incoming.OpenOnWeb("https://paddlesnitch.com$it"), incoming(view, "https://paddlesnitch.com$it", null))
        }
    }

    @Test fun linksFromOtherSitesAreIgnored() {
        assertNull(incoming(view, "https://example.com/paddles/Xy3", null))
        assertNull(incoming(view, "http://paddlesnitch.com.evil.net/paddles/Xy3", null))
        assertNull(incoming(view, "http://paddlesnitch.com/paddles/Xy3", null)) // App Links are https only
    }

    // Strava is gone: its old return addresses (a tab left open, a crafted link) do nothing.
    @Test fun stravaReturnsAreIgnored() {
        assertNull(incoming(view, "com.paddlesnitch.app:/signin/strava?code=abc", null))
        assertNull(incoming(view, "com.paddlesnitch.app:/account/strava?code=abc", null))
    }

    @Test fun signingInWithGoogleComesBackOnItsOwnPath() {
        val back = "com.paddlesnitch.app:/signin/google?code=abc"
        assertEquals(Incoming.GoogleReturn(back), incoming(view, back, null))
        assertEquals(Incoming.GoogleReturn("com.paddlesnitch.app:/signin/google?error=google_denied"), incoming(view, "com.paddlesnitch.app:/signin/google?error=google_denied", null))
        assertNull(incoming(view, "com.paddlesnitch.app:/signin/googlex?code=1", null)) // that exact path only
    }

    @Test fun aFileOpenedOrSharedFromAnotherAppIsAdded() {
        assertEquals(Incoming.AddFile("content://files/1"), incoming(view, "content://files/1", null))
        assertEquals(Incoming.AddFile("content://files/2"), incoming(send, null, "content://files/2"))
    }

    @Test fun nothingToDo() {
        assertNull(incoming("android.intent.action.MAIN", null, null))
        assertNull(incoming(send, null, null))
        assertNull(incoming(view, "file:///sdcard/a.gpx", null)) // other apps can't hand us file: paths since Android 7
    }

    // A new page under /paddles on the website must be listed, or its links would open as a paddle that isn't there.
    @Test fun everyNamedPaddlesPageOnTheWebsiteIsNotAPaddle() {
        val dir = File("../../../apps/web/src/app/paddles")
        assertTrue("can't see the website at ${dir.absolutePath}", dir.isDirectory)
        val pages = dir.listFiles()!!.filter { it.isDirectory && !it.name.startsWith("[") }.map { it.name }
        assertTrue(pages.isNotEmpty())
        pages.forEach { assertTrue("/paddles/$it isn't in notPaddles", it in notPaddles) }
    }
}
