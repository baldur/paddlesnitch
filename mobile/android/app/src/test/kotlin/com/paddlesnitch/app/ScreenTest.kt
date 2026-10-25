package com.paddlesnitch.app

import com.paddlesnitch.app.account.isPlaceholderEmail
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Which screen App.kt shows.
class ScreenTest {
    private fun screen(signingIn: Boolean = false, signedIn: Boolean = true, needsTerms: Boolean = false, tracker: Boolean = false, account: Boolean = false) =
        screenFor(signingIn, signedIn, needsTerms, tracker, account)

    @Test fun signedOutShowsTheSamples() = assertEquals(Screen.Samples, screen(signedIn = false, needsTerms = true, account = true))
    @Test fun signingInComesFirst() = assertEquals(Screen.SignIn, screen(signingIn = true, signedIn = false))
    @Test fun newTermsComeBeforeEverythingSignedIn() {
        assertEquals(Screen.Terms, screen(needsTerms = true))
        assertEquals(Screen.Terms, screen(needsTerms = true, account = true)) // even where you were when the app closed
        assertEquals(Screen.Terms, screen(needsTerms = true, tracker = true))
    }
    @Test fun otherwiseWhereYouAre() {
        assertEquals(Screen.Tracker, screen(tracker = true, account = true))
        assertEquals(Screen.Account, screen(account = true))
        assertEquals(Screen.Paddles, screen())
    }

    @Test fun aStravaPlaceholderEmail() {
        assertTrue(isPlaceholderEmail("strava-12345@noreply.paddlesnitch.com"))
        assertTrue(isPlaceholderEmail("Strava-12345@NoReply.Paddlesnitch.com"))
        assertFalse(isPlaceholderEmail("pat@example.com"))
        assertFalse(isPlaceholderEmail("strava-1@noreply.paddlesnitch.com.evil.net"))
        assertFalse(isPlaceholderEmail("strava-abc@noreply.paddlesnitch.com"))
    }
}
