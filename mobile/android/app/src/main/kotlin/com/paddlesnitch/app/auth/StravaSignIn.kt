package com.paddlesnitch.app.auth

import android.content.Context
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.SignIn
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Strava sign-in (mobile/contract/README.md, "Strava"): the website's flow in a
 * Custom Tab, ending on com.paddlesnitch.app:/signin/strava with a one-time code
 * that only the verifier kept here can swap for tokens.
 */
class StravaSignIn(private val api: Api, private val verifiers: VerifierStore) {
    /** The page to open; remembers the verifier, which outlives the app being killed meanwhile. */
    fun start(): String = Pkce.verifier().let { verifiers.put(it); api.stravaStartUrl(Pkce.challenge(it)) }

    suspend fun finish(code: String?, error: String?): SignIn {
        val verifier = verifiers.take()
        if (error != null) throw ApiFailure(stravaErrorMessage(error))
        if (code == null || verifier == null) throw ApiFailure(stravaErrorMessage(""))
        return api.stravaSignIn(code, verifier)
    }

    companion object {
        const val SCHEME = "com.paddlesnitch.app"
    }
}

interface VerifierStore {
    fun put(verifier: String)
    /** The verifier, once. */
    fun take(): String?
}

class PrefsVerifierStore(context: Context) : VerifierStore {
    private val prefs = context.getSharedPreferences("strava-signin", Context.MODE_PRIVATE)
    override fun put(verifier: String) { prefs.edit().putString("verifier", verifier).commit() }
    override fun take(): String? = prefs.getString("verifier", null).also { prefs.edit().remove("verifier").apply() }
    /** A sign-in this app started hasn't come back yet. */
    val pending: Boolean get() = prefs.contains("verifier")
}

/** RFC 7636 S256. */
object Pkce {
    fun verifier(random: SecureRandom = SecureRandom()): String = ByteArray(32).also(random::nextBytes).b64()
    fun challenge(verifier: String): String = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()).b64()
    private fun ByteArray.b64() = Base64.getUrlEncoder().withoutPadding().encodeToString(this)
}

/** The website's /signin wording for the same `?error=` keys. */
fun stravaErrorMessage(key: String): String = when (key) {
    "strava_denied" -> "You cancelled the Strava sign-in."
    "strava_profile_failed" -> "Couldn’t load your Strava profile. Please try again."
    "strava_user_create_failed" -> "Couldn’t create an account from your Strava profile. Please sign up with your email instead."
    "strava_not_configured" -> "Strava sign-in isn’t available right now."
    else -> "Strava sign-in didn’t finish. Please try again."
}
