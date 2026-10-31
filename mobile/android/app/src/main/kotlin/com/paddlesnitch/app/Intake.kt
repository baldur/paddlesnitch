package com.paddlesnitch.app

import com.paddlesnitch.app.paddles.AddCard
import java.io.Serializable

/**
 * What links and other apps have asked for and the app hasn't done yet, and
 * the add-paddle card. Plain Kotlin so the JVM tests drive every path; App.kt
 * holds one in state and carries out the [Do] each step returns.
 */
data class Intake(
    /** A paddle to open, or a file to add, kept through signing in. */
    val pending: Incoming? = null,
    val card: AddCard? = null,
) : Serializable {
    /** What App.kt has to do after a step. */
    sealed interface Do {
        data object Nothing : Do
        data object SignIn : Do
        data class Browser(val url: String) : Do
        data class StravaReturn(val uri: String) : Do
        data class GoogleReturn(val uri: String) : Do
        data class StravaConnectReturn(val uri: String) : Do
        data class Upload(val uri: String) : Do
    }

    /**
     * A link or a file arrived. [name] is the file's name, if the other app gave one.
     * [googlePending], [stravaPending]: this app started that sign-in and it hasn't come back yet.
     */
    fun arrived(incoming: Incoming, signedIn: Boolean, name: String? = null, googlePending: Boolean = false, stravaPending: Boolean = false): Pair<Intake, Do> = when (incoming) {
        // Anyone can open this address too: only a Strava sign-in this app started, while signed out, goes on.
        is Incoming.StravaReturn -> this to if (stravaPending && !signedIn) Do.StravaReturn(incoming.uri) else Do.Nothing
        // Anyone can open this address: only a Google sign-in this app started, while signed out, goes on.
        is Incoming.GoogleReturn -> this to if (googlePending && !signedIn) Do.GoogleReturn(incoming.uri) else Do.Nothing
        // Only a signed-in account can have started a connect; anything else is ignored.
        is Incoming.StravaConnectReturn -> this to if (signedIn) Do.StravaConnectReturn(incoming.uri) else Do.Nothing
        is Incoming.OpenOnWeb -> this to Do.Browser(incoming.url)
        is Incoming.OpenPaddle -> copy(pending = incoming) to if (signedIn) Do.Nothing else Do.SignIn
        is Incoming.AddFile -> if (signedIn) copy(pending = null) to Do.Upload(incoming.uri)
            else copy(pending = incoming, card = AddCard.SignInToAdd(name)) to Do.Nothing
    }

    /** Signed in: a waiting file is added now (a waiting paddle opens from [openPaddle]). */
    fun signedIn(): Pair<Intake, Do> = when (val p = pending) {
        is Incoming.AddFile -> copy(pending = null) to Do.Upload(p.uri)
        else -> this to Do.Nothing
    }

    /** Leaving sign-in drops a waiting link; a waiting file keeps its card, which can still be closed. */
    fun signInCancelled() = if (pending is Incoming.OpenPaddle) copy(pending = null) else this

    /** The session ended during an upload: keep the file and ask to sign in. */
    fun uploadSignedOut(uri: String, name: String?) = copy(pending = Incoming.AddFile(uri), card = AddCard.SignInToAdd(name))

    fun show(card: AddCard) = copy(card = card)

    /** Closing the sign-in card forgets its file. */
    fun cardClosed() = copy(card = null, pending = if (card is AddCard.SignInToAdd) null else pending)

    /** "Open paddle" on the card. */
    fun openFromCard(id: String) = copy(card = null, pending = Incoming.OpenPaddle(id))

    /** The paddle a link or the card asked for, once the list can open it. */
    val openPaddle: String? get() = (pending as? Incoming.OpenPaddle)?.id

    fun paddleOpened() = if (pending is Incoming.OpenPaddle) copy(pending = null) else this
}
