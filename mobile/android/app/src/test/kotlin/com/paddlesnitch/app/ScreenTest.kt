package com.paddlesnitch.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Which screen App.kt shows.
class ScreenTest {
    private fun screen(signingIn: Boolean = false, signedIn: Boolean = true, needsTerms: Boolean = false, tracker: Boolean = false, account: Boolean = false, trackers: Boolean = false) =
        screenFor(signingIn, signedIn, needsTerms, tracker, account, trackers)

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
        assertEquals(Screen.Trackers, screen(trackers = true, account = true)) // opened from Account
        assertEquals(Screen.Tracker, screen(tracker = true, trackers = true)) // set up from the list, then back to it
        assertEquals(Screen.Terms, screen(needsTerms = true, trackers = true))
        assertEquals(Screen.Paddles, screen())
    }
}
