package com.paddlesnitch.app

import java.io.Serializable

/**
 * Signing in again, for what needs a sign-in from the last 10 minutes:
 * deleting the account and connecting Strava (mobile/contract/README.md).
 * Plain Kotlin, so ReauthTest covers every path; App.kt carries it out. The
 * email to fill in is kept apart, out of saved state.
 */
data class Reauth(
    /** The account that asked; null when nobody is signing in again. */
    val userId: String? = null,
    /** That account was made with Strava, so it signs in with Strava. */
    val strava: Boolean = false,
    /** What it was for. */
    val then: After = After.Delete,
    /** Signed back in as that account: go back to [then] once. */
    val resume: After? = null,
) : Serializable {
    enum class After { Delete, ConnectStrava }

    val signingInAgain get() = userId != null

    /** Why the sign-in screen is showing (the website's /signin notices). */
    val notice: String? get() {
        if (!signingInAgain) return null
        val why = when (then) {
            After.Delete -> "For your safety, deleting your account needs a recent sign-in."
            After.ConnectStrava -> "For your safety, connecting Strava needs a recent sign-in."
        }
        val back = if (then == After.Delete) "Delete account" else "Account"
        return if (strava) "$why Sign in with Strava below and you’ll come straight back to $back."
        else "$why Sign in again and you’ll come straight back to $back."
    }

    /** Signed out on the way: sign in again as [userId], then back to [then]. */
    fun start(userId: String, strava: Boolean, then: After = After.Delete) = Reauth(userId, strava, then)

    /** Back to where it started only for the account that asked; anyone else starts at home. */
    fun signedIn(id: String) = Reauth(resume = then.takeIf { signingInAgain && userId == id })

    /** Signed out or gave up: nothing pending. */
    fun cleared() = Reauth()

    fun resumed() = copy(resume = null)
}
