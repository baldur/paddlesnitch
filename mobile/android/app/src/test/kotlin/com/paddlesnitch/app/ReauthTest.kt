package com.paddlesnitch.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Signing in again to delete the account (Reauth.kt), each path App.kt takes.
class ReauthTest {
    private val asked = Reauth().start("u-1", strava = false)

    @Test fun nobodySigningInAgainHasNoNoticeAndNothingToResume() {
        assertNull(Reauth().notice)
        assertNull(Reauth().signedIn("u-1").resume) // an ordinary sign-in never opens Delete
    }

    @Test fun theSameAccountComesBackToDeleteOnce() {
        val back = asked.signedIn("u-1")
        assertEquals(Reauth.After.Delete, back.resume)
        assertFalse(back.signingInAgain)
        assertNull(back.resumed().resume) // the next visit to Account is an ordinary one
    }

    @Test fun anotherAccountSigningInStartsAtHomeNotOnDelete() {
        assertEquals(Reauth(), asked.signedIn("someone-else"))
    }

    @Test fun cancellingOrSigningOutLeavesNothingPending() {
        assertEquals(Reauth(), asked.cleared())
        assertEquals(Reauth(), asked.signedIn("u-1").cleared())
    }

    @Test fun theNoticeSaysWhyAndPointsStravaAccountsAtStrava() {
        assertEquals("For your safety, deleting your account needs a recent sign-in. Sign in again and you’ll come straight back to Delete account.", asked.notice)
        assertTrue(Reauth().start("u-1", strava = true).notice!!.contains("Sign in with Strava below"))
    }

    @Test fun connectingStravaComesBackToAccountWithItsOwnReason() {
        val strava = Reauth().start("u-1", strava = false, then = Reauth.After.ConnectStrava)
        assertEquals("For your safety, connecting Strava needs a recent sign-in. Sign in again and you’ll come straight back to Account.", strava.notice)
        assertEquals(Reauth.After.ConnectStrava, strava.signedIn("u-1").resume)
        assertNull(strava.signedIn("someone-else").resume)
    }
}
