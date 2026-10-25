package com.paddlesnitch.app

import java.io.Serializable

/**
 * Signing in again to delete the account, which needs a sign-in from the last
 * 10 minutes (mobile/contract/README.md § Account). Plain Kotlin, so ReauthTest
 * covers every path; App.kt carries it out. The email to fill in is kept apart,
 * out of saved state.
 */
data class Reauth(
    /** The account that asked; null when nobody is signing in again. */
    val userId: String? = null,
    /** That account was made with Strava, so it signs in with Strava. */
    val strava: Boolean = false,
    /** Signed back in as that account: open Delete account once. */
    val resumeDelete: Boolean = false,
) : Serializable {
    val signingInAgain get() = userId != null

    /** Why the sign-in screen is showing. */
    val notice: String? get() = when {
        !signingInAgain -> null
        strava -> "For your safety, deleting your account needs a recent sign-in. Sign in with Strava below and you’ll come straight back to Delete account."
        else -> "For your safety, deleting your account needs a recent sign-in. Sign in again and you’ll come straight back to Delete account."
    }

    /** Signed out on the way: sign in again as [userId]. */
    fun start(userId: String, strava: Boolean) = Reauth(userId, strava)

    /** Back to Delete only for the account that asked; anyone else starts at home. */
    fun signedIn(id: String) = Reauth(resumeDelete = signingInAgain && userId == id)

    /** Signed out or gave up: nothing pending. */
    fun cleared() = Reauth()

    fun resumed() = copy(resumeDelete = false)
}
