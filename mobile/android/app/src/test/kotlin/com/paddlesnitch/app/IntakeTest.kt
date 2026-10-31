package com.paddlesnitch.app

import com.paddlesnitch.app.Intake.Do
import com.paddlesnitch.app.paddles.AddCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// What App.kt does with links and files that arrive, through signing in and the add-paddle card.
class IntakeTest {
    private val file = Incoming.AddFile("content://files/1")
    private val link = Incoming.OpenPaddle("pdl-river")

    @Test fun aFileWhileSignedInIsAddedAtOnce() {
        val (next, step) = Intake().arrived(file, signedIn = true, name = "Morning.gpx")
        assertEquals(Do.Upload("content://files/1"), step)
        assertNull(next.pending)
    }

    @Test fun aFileWhileSignedOutWaitsForSignInThenIsAddedOnce() {
        val (waiting, step) = Intake().arrived(file, signedIn = false, name = "Morning.gpx")
        assertEquals(Do.Nothing, step)
        assertEquals(AddCard.SignInToAdd("Morning.gpx"), waiting.card)
        val (after, upload) = waiting.signedIn()
        assertEquals(Do.Upload("content://files/1"), upload)
        assertEquals(Do.Nothing, after.signedIn().second) // not twice
    }

    @Test fun closingTheSignInCardForgetsTheFile() {
        val waiting = Intake().arrived(file, signedIn = false).first
        val closed = waiting.cardClosed()
        assertNull(closed.card)
        assertEquals(Do.Nothing, closed.signedIn().second)
    }

    @Test fun leavingSignInKeepsAWaitingFile() {
        val waiting = Intake().arrived(file, signedIn = false).first
        assertEquals(waiting, waiting.signInCancelled())
    }

    @Test fun aSessionThatEndsDuringAnUploadKeepsTheFileAndAsksToSignIn() {
        val adding = Intake().arrived(file, signedIn = true).first.show(AddCard.Adding("Morning.gpx"))
        val out = adding.uploadSignedOut("content://files/1", "Morning.gpx")
        assertEquals(AddCard.SignInToAdd("Morning.gpx"), out.card) // not stuck on Adding, which can't be closed
        assertEquals(Do.Upload("content://files/1"), out.signedIn().second)
    }

    @Test fun aPaddleLinkWhileSignedOutSignsInThenOpens() {
        val (waiting, step) = Intake().arrived(link, signedIn = false)
        assertEquals(Do.SignIn, step)
        assertEquals("pdl-river", waiting.signedIn().first.openPaddle)
        assertNull(waiting.paddleOpened().openPaddle)
    }

    @Test fun leavingSignInDropsAWaitingLink() {
        assertNull(Intake().arrived(link, signedIn = false).first.signInCancelled().openPaddle)
    }

    @Test fun aPaddleLinkWhileSignedInOpensIt() {
        val (next, step) = Intake().arrived(link, signedIn = true)
        assertEquals(Do.Nothing, step)
        assertEquals("pdl-river", next.openPaddle)
    }

    @Test fun openPaddleOnTheCardOpensItAndClosesTheCard() {
        val next = Intake(card = AddCard.Added("pdl-new", duplicate = false)).openFromCard("pdl-new")
        assertNull(next.card)
        assertEquals("pdl-new", next.openPaddle)
    }

    @Test fun otherLinksGoWhereTheyBelong() {
        assertEquals(Do.Browser("https://paddlesnitch.com/paddles/new"), Intake().arrived(Incoming.OpenOnWeb("https://paddlesnitch.com/paddles/new"), true).second)
    }

    // Anyone can open this address. Without the guard, a crafted link opened sign-in with a
    // Strava error, even in a release build that hides Strava.
    @Test fun aStravaReturnCountsOnlyWhenThisAppStartedOneWhileSignedOut() {
        val back = Incoming.StravaReturn("com.paddlesnitch.app:/signin/strava?code=1")
        assertEquals(Do.StravaReturn(back.uri), Intake().arrived(back, signedIn = false, stravaPending = true).second)
        assertEquals(Do.Nothing, Intake().arrived(back, signedIn = false, stravaPending = false).second) // a link alone
        assertEquals(Do.Nothing, Intake().arrived(back, signedIn = true, stravaPending = true).second) // already signed in
    }

    @Test fun aGoogleReturnCountsOnlyWhenThisAppStartedOneWhileSignedOut() {
        val back = Incoming.GoogleReturn("com.paddlesnitch.app:/signin/google?code=1")
        assertEquals(Do.GoogleReturn(back.uri), Intake().arrived(back, signedIn = false, googlePending = true).second)
        assertEquals(Do.Nothing, Intake().arrived(back, signedIn = false, googlePending = false).second) // a link alone
        assertEquals(Do.Nothing, Intake().arrived(back, signedIn = true, googlePending = true).second) // already signed in another way
    }

    @Test fun aStravaConnectReturnIsForTheSignedInAccountOnly() {
        val back = Incoming.StravaConnectReturn("com.paddlesnitch.app:/account/strava?code=abc")
        assertEquals(Do.StravaConnectReturn(back.uri), Intake().arrived(back, signedIn = true).second)
        assertEquals(Do.Nothing, Intake().arrived(back, signedIn = false).second) // nobody started one: ignore it
    }

    @Test fun theBrowserNamedIsNeverThisAppOrTheChooser() {
        val self = "com.paddlesnitch.app"
        assertEquals("com.android.chrome", chooseBrowser("com.android.chrome", "org.mozilla.firefox", self))
        assertEquals("org.mozilla.firefox", chooseBrowser(null, "org.mozilla.firefox", self))
        assertNull(chooseBrowser(null, "android", self)) // only the chooser: it would list this app too
        assertNull(chooseBrowser(null, self, self))
        assertNull(chooseBrowser(null, null, self))
    }
}
