package com.paddlesnitch.app.account

import android.content.Context
import com.paddlesnitch.app.api.AccountApi
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.Constants
import com.paddlesnitch.app.api.StravaStatus
import com.paddlesnitch.app.auth.Pkce
import com.paddlesnitch.app.auth.VerifierStore

/**
 * Connecting Strava to a signed-in account (mobile/contract/README.md § Strava,
 * signed in): Strava's consent page in a Custom Tab, ending on
 * com.paddlesnitch.app:/account/strava. Only the verifier kept here can finish it,
 * so a return this app didn't start is ignored.
 */
class StravaConnect(private val api: AccountApi, private val verifiers: VerifierStore) {
    /** The page to open. A 403 reauth passes through: sign in again first. */
    suspend fun start(): String {
        val verifier = Pkce.verifier()
        val url = try { api.stravaConnect(Pkce.challenge(verifier)).url } catch (e: ApiFailure) {
            // Don't open a browser when Strava isn't set up on the server.
            if (e.status == 503) throw ApiFailure(stravaConnectResult("not_configured")) else throw e
        }
        verifiers.put(verifier)
        return url
    }

    /**
     * Back from Strava with `?code=` or `?strava=<key>`. Null when this app didn't
     * start a connect: ignore it. Otherwise the new status, or an [ApiFailure] in our words.
     */
    suspend fun finish(code: String?, key: String?): StravaStatus? {
        val verifier = verifiers.take() ?: return null
        if (code == null) throw ApiFailure(stravaConnectResult(key ?: "exchange_failed"))
        return try { api.stravaConnectFinish(code, verifier) } catch (e: ApiFailure) {
            when {
                e.reauth -> throw e
                e.status == 409 -> throw ApiFailure(stravaConnectResult("linked_elsewhere"), 409)
                e.status == 400 || e.generic -> throw ApiFailure(stravaConnectResult("exchange_failed"), e.status)
                else -> throw e
            }
        }
    }
}

/** The website's words for a connect result (api/constants.json `stravaConnectResults`). */
fun stravaConnectResult(key: String): String =
    Constants.stravaConnectResults[key] ?: Constants.stravaConnectResults.getValue("exchange_failed")

/**
 * The connect verifier, kept through the app being killed while Strava is open.
 * It lasts 10 minutes (the server's code lasts 5) and goes on sign-out ([clearStravaConnect]).
 */
class PrefsConnectVerifierStore(context: Context, private val now: () -> Long = System::currentTimeMillis) : VerifierStore {
    private val prefs = context.getSharedPreferences("strava-connect", Context.MODE_PRIVATE)
    override fun put(verifier: String) { prefs.edit().putString("verifier", verifier).putLong("at", now()).commit() }
    override fun take(): String? = current().also { clear() }
    /** A connect this app started and hasn't finished. */
    val pending: Boolean get() = current() != null
    fun clear() { prefs.edit().clear().commit() }
    private fun current(): String? = prefs.getString("verifier", null)?.takeIf { now() - prefs.getLong("at", 0) < TEN_MINUTES }
    private companion object { const val TEN_MINUTES = 10 * 60 * 1000L }
}

/** Signed out or deleted: an unfinished connect goes too. */
fun clearStravaConnect(context: Context) = PrefsConnectVerifierStore(context).clear()
