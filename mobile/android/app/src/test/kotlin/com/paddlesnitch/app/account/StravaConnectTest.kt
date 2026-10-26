package com.paddlesnitch.app.account

import com.paddlesnitch.app.api.AccountApi
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.StravaStatus
import com.paddlesnitch.app.api.WebPage
import com.paddlesnitch.app.auth.Pkce
import com.paddlesnitch.app.auth.VerifierStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Connecting Strava (mobile/contract/README.md § Strava, signed in): the verifier, and the words for each result.
class StravaConnectTest {
    private val verifiers = object : VerifierStore {
        var v: String? = null
        override fun put(verifier: String) { v = verifier }
        override fun take() = v.also { v = null }
    }
    private var challenge: String? = null
    private var finished: Pair<String, String>? = null
    private var startFails: ApiFailure? = null
    private var finishFails: ApiFailure? = null
    private val api = object : AccountApi by FakeAccountApi() {
        override suspend fun stravaConnect(challenge: String): WebPage { startFails?.let { throw it }; this@StravaConnectTest.challenge = challenge; return WebPage("https://www.strava.com/oauth/authorize?x") }
        override suspend fun stravaConnectFinish(code: String, verifier: String): StravaStatus {
            finishFails?.let { throw it }; finished = code to verifier; return StravaStatus(true, StravaStatus.Athlete(1, "Pat Paddler"), true)
        }
    }
    private val connect = StravaConnect(api, verifiers)

    @Test fun startSendsTheChallengeAndKeepsTheVerifierThatFinishes() = runTest {
        assertEquals("https://www.strava.com/oauth/authorize?x", connect.start())
        val kept = verifiers.v!!
        assertEquals(Pkce.challenge(kept), challenge)
        assertEquals("Pat Paddler", connect.finish("code-1", null)!!.athlete!!.name)
        assertEquals("code-1" to kept, finished)
    }

    @Test fun aReturnThisAppDidntStartIsIgnored() = runTest {
        assertNull(connect.finish("someone-elses-code", null))
        assertNull(finished)
    }

    @Test fun aVerifierFinishesOnlyOnce() = runTest {
        connect.start()
        connect.finish("code-1", null)
        assertNull(connect.finish("code-1", null))
    }

    @Test fun whatStravaSaidIsShownInTheWebsitesWords() = runTest {
        connect.start()
        assertEquals("You cancelled connecting Strava.", runCatching { connect.finish(null, "denied") }.exceptionOrNull()!!.message)
        connect.start()
        assertEquals("Couldn’t connect Strava. Please try again.", runCatching { connect.finish(null, "something-new") }.exceptionOrNull()!!.message)
    }

    @Test fun strava503MeansNotSetUpAndNoBrowser() = runTest {
        startFails = ApiFailure("Couldn’t finish that. Please try again.", 503, generic = true)
        assertEquals("Couldn’t connect Strava right now. Please try again later.", runCatching { connect.start() }.exceptionOrNull()!!.message)
        assertNull(verifiers.v)
    }

    @Test fun anOldSignInPassesThroughSoTheScreenCanAskForANewOne() = runTest {
        startFails = ApiFailure("x", 403, reauth = true)
        assertTrue((runCatching { connect.start() }.exceptionOrNull() as ApiFailure).reauth)
        assertNull(verifiers.v)
    }

    @Test fun finishRefusalsInOurWords() = runTest {
        connect.start(); finishFails = ApiFailure("Strava is linked elsewhere", 409)
        assertEquals("Couldn’t connect Strava. It’s already connected to another paddlesnitch account. Sign in to that account and disconnect it there.",
            runCatching { connect.finish("c", null) }.exceptionOrNull()!!.message)
        connect.start(); finishFails = ApiFailure("Couldn’t finish that. Please try again.", 400, generic = true)
        assertEquals("Couldn’t connect Strava. Please try again.", runCatching { connect.finish("c", null) }.exceptionOrNull()!!.message)
        connect.start(); finishFails = ApiFailure("x", 403, reauth = true)
        assertTrue((runCatching { connect.finish("c", null) }.exceptionOrNull() as ApiFailure).reauth)
    }
}
