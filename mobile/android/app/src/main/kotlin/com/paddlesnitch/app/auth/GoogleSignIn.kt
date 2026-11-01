package com.paddlesnitch.app.auth

import android.content.Context
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.SignIn

/**
 * Sign in with Google (mobile/contract/README.md, "Google"): the website's page
 * with one Google button in a Custom Tab, ending on com.paddlesnitch.app:/signin/google
 * with a code only the verifier kept here can swap. A return this app didn't
 * start is ignored, so a link alone does nothing.
 */
class GoogleSignIn(private val api: Api, private val verifiers: VerifierStore) {
    /** The page to open; remembers the verifier, which outlives the app being killed meanwhile. */
    fun start(): String = Pkce.verifier().let { verifiers.put(it); api.googleStartUrl(Pkce.challenge(it)) }

    /** The page never opened: forget the verifier, so nothing is pending. */
    fun cancel() { verifiers.take() }

    /** Null when this app didn't start a Google sign-in. */
    suspend fun finish(code: String?, error: String?): SignIn? {
        val verifier = verifiers.take() ?: return null
        if (error != null || code == null) throw ApiFailure(googleErrorMessage(error.orEmpty()))
        return try { api.googleSignIn(code, verifier) } catch (e: ApiFailure) {
            // Spent, expired or not ours: start again, in the website's words.
            if (e.status == 400 || e.status == 401 || e.generic) throw ApiFailure(googleErrorMessage("google_failed"), e.status) else throw e
        }
    }

    companion object {
        const val RETURN = "$RETURN_SCHEME:/signin/google"
    }
}

/** The website's /signin wording for the same `?error=` keys (README § Google). */
fun googleErrorMessage(key: String): String = when (key) {
    "google_account_exists" -> "You already have an account with this email. Sign in with your email instead."
    "google_no_email" -> "Couldn’t sign in with Google, because Google didn’t share a confirmed email address. Please sign up with your email instead."
    "google_denied" -> "You cancelled the Google sign-in."
    "google_not_configured" -> "Google sign-in isn’t available right now."
    else -> "Couldn’t sign in with Google. Please try again."
}

/**
 * A verifier kept in SharedPreferences [name] for 10 minutes (the server's code lasts 5),
 * through the app being killed while the browser is open.
 */
class PrefsTimedVerifierStore(context: Context, name: String, private val now: () -> Long = System::currentTimeMillis) : VerifierStore {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun put(verifier: String) { prefs.edit().putString("verifier", verifier).putLong("at", now()).commit() }
    override fun take(): String? = current().also { clear() }
    /** Started here and not finished. */
    val pending: Boolean get() = current() != null
    fun clear() { prefs.edit().clear().commit() }
    private fun current(): String? = prefs.getString("verifier", null)?.takeIf { now() - prefs.getLong("at", 0) < TEN_MINUTES }
    private companion object { const val TEN_MINUTES = 10 * 60 * 1000L }
}

@Suppress("FunctionName")
fun PrefsGoogleVerifierStore(context: Context) = PrefsTimedVerifierStore(context, "google-signin")
