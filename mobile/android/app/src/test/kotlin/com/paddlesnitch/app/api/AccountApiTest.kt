package com.paddlesnitch.app.api

import com.paddlesnitch.app.auth.MemoryTokenStore
import java.io.File
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

// The account calls (mobile/contract/README.md § Account) against a fake server, answering with the contract's fixtures.
class AccountApiTest {
    @get:Rule val tmp = TemporaryFolder()
    private val server = MockWebServer()
    private val tokens = MemoryTokenStore()
    private lateinit var api: Api

    @Before fun start() { server.start(); api = Api(server.url("/").toString(), tokens, "0.1.0"); tokens.save("id-1", "r-1") }
    @After fun stop() = server.close()

    private fun fixture(name: String) = File("../../contract/fixtures/api/$name.json").readText()
    private fun answer(code: Int, body: String, vararg headers: Pair<String, String>) =
        server.enqueue(MockResponse.Builder().code(code).body(body).apply { headers.forEach { (k, v) -> addHeader(k, v) } }.build())
    private fun sent() = server.takeRequest().let { Triple(it.method, it.url.encodedPath + (it.url.encodedQuery?.let { q -> "?$q" } ?: ""), it.body?.utf8().orEmpty()) }

    @Test fun termsAreReadAndAcceptedAtTheVersionTheContractNames() = runTest {
        answer(200, fixture("account.tos"))
        api.terms()
        assertEquals(Triple("GET", "/api/account/tos", ""), sent())
        answer(200, fixture("account.tos-accepted"))
        api.acceptTerms()
        assertEquals(Triple("POST", "/api/account/tos", """{"version":"${Constants.tosVersion}"}"""), sent())
    }

    @Test fun everyAccountCallSendsTheBearerToken() = runTest {
        answer(200, fixture("account.profile"))
        api.profile()
        assertEquals("Bearer id-1", server.takeRequest().headers["Authorization"])
    }

    @Test fun theProfileAndItsHandle() = runTest {
        answer(200, fixture("account.profile"))
        assertEquals("river-pat", api.setProfilePublic(true).handle)
        assertEquals(Triple("PATCH", "/api/account/profile", """{"public":true}"""), sent())

        answer(200, fixture("account.profile"))
        api.claimHandle("river-pat")
        assertEquals(Triple("PUT", "/api/account/handle", """{"handle":"river-pat"}"""), sent())

        answer(200, fixture("account.profile.private"))
        assertNull(api.releaseHandle().handle)
        assertEquals("DELETE", sent().first)
    }

    @Test fun aHandleTheServerRefusesSaysWhy() = runTest {
        answer(400, """{"error":"Handles are 3–30 characters."}""")
        val e = runCatching { api.claimHandle("ab") }.exceptionOrNull() as ApiFailure
        assertEquals("Handles are 3–30 characters.", e.message)
    }

    @Test fun theContactEmail() = runTest {
        answer(200, fixture("account.contact"))
        assertEquals("pat@example.com", api.setContact("pat@example.com").contact?.email)
        assertEquals(Triple("POST", "/api/account/contact", """{"email":"pat@example.com"}"""), sent())
        answer(200, fixture("account.contact.none"))
        assertNull(api.contact().contact)
        assertEquals(Triple("GET", "/api/account/contact", ""), sent())
        answer(200, """{"ok":true}""")
        api.removeContact()
        assertEquals(Triple("DELETE", "/api/account/contact", ""), sent())
    }

    @Test fun deletingTheAccountSendsTheRefreshTokenThenForgetsBoth() = runTest {
        answer(200, """{"ok":true}""")
        api.deleteAccount()
        assertEquals(Triple("DELETE", "/api/account", """{"refreshToken":"r-1"}"""), sent())
        assertNull(tokens.refreshToken)
        assertFalse(api.signedIn)
    }

    @Test fun theRecentSignInCheck() = runTest {
        answer(200, """{"recentSignIn":false}""")
        assertFalse(api.accountStatus().recentSignIn)
        assertEquals(Triple("GET", "/api/account", ""), sent())
    }

    @Test fun aDeleteRefusedForAnOldSignInSaysSoAndKeepsYouSignedIn() = runTest {
        answer(403, """{"error":"For your safety, deleting your account needs a recent sign-in. Please sign in again.","reauth":true}""")
        val e = runCatching { api.deleteAccount() }.exceptionOrNull() as ApiFailure
        assertTrue(e.reauth)
        assertEquals(403, e.status)
        assertTrue(api.signedIn)
    }

    @Test fun otherRefusalsAreNotAskingForASignIn() = runTest {
        answer(403, """{"error":"Not yours."}""")
        assertFalse((runCatching { api.deleteAccount() }.exceptionOrNull() as ApiFailure).reauth)
    }

    @Test fun aRefusedDeleteKeepsYouSignedIn() = runTest {
        answer(500, "")
        assertTrue(runCatching { api.deleteAccount() }.isFailure)
        assertTrue(api.signedIn)
    }

    @Test fun theExportIsFetchedFromItsLinkWithoutTheTokenAndKeepsTheWebsitesName() = runTest {
        val s3 = MockWebServer().apply { start() } // another host, as S3 is
        try {
            answer(200, """{"url":"${s3.url("/exports/u1/abc.json?X-Amz-Signature=x")}"}""")
            s3.enqueue(MockResponse.Builder().code(200).body("""{"account":{}}""")
                .addHeader("Content-Disposition", "attachment; filename=\"paddlesnitch-export-2026-10-25.json\"").build())
            val file = tmp.newFile()
            assertEquals("paddlesnitch-export-2026-10-25.json", api.exportAccount(file))
            assertEquals("""{"account":{}}""", file.readText())
            assertEquals(Triple("POST", "/api/account/export", ""), sent())
            assertNull("a signed link must not carry our token", s3.takeRequest().headers["Authorization"])
        } finally { s3.close() }
    }

    @Test fun inLocalDevTheExportLinkIsOursAndCarriesTheToken() = runTest {
        answer(200, """{"url":"/api/account/export"}""")
        answer(200, "{}")
        assertEquals("paddlesnitch-data.json", api.exportAccount(tmp.newFile()))
        sent()
        assertEquals("Bearer id-1", server.takeRequest().headers["Authorization"])
    }

    @Test fun anEndedSessionOnAnAccountRouteRefreshesOnceThenSignsOut() = runTest {
        answer(401, fixture("account.error"))
        answer(401, """{"error":"Please sign in again."}""") // the refresh is refused too
        assertTrue(runCatching { api.profile() }.exceptionOrNull() is SignedOut)
        assertEquals("/api/account/profile", server.takeRequest().url.encodedPath)
        assertEquals("/att/api/auth/refresh", server.takeRequest().url.encodedPath)
        assertFalse(api.signedIn)
    }

    @Test fun termsFromAnOutOfDateAppSayWhy() = runTest {
        answer(422, """{"error":"Please update the app to accept the current Terms."}""")
        assertEquals("Please update the app to accept the current Terms.", (runCatching { api.acceptTerms() }.exceptionOrNull() as ApiFailure).message)
    }

    @Test fun anExpiredExportLinkSaysSoWithoutACodeAndKeepsNothing() = runTest {
        val s3 = MockWebServer().apply { start() }
        try {
            answer(200, """{"url":"${s3.url("/exports/u1/abc.json")}"}""")
            s3.enqueue(MockResponse.Builder().code(403).body("<Error>AccessDenied</Error>").build())
            val file = tmp.newFile()
            val e = runCatching { api.exportAccount(file) }.exceptionOrNull() as ApiFailure
            assertEquals("Couldn’t prepare your download. Please try again.", e.message)
            assertFalse(file.exists())
        } finally { s3.close() }
    }

    @Test fun stravaForASignedInAccount() = runTest {
        answer(200, fixture("strava.status"))
        assertEquals("Pat Paddler", api.stravaStatus().athlete?.name)
        assertEquals(Triple("GET", "/att/api/strava/status", ""), sent())

        answer(200, fixture("strava.app-connect"))
        assertTrue(api.stravaConnect("ch-1").url.startsWith("https://www.strava.com/oauth/authorize"))
        assertEquals(Triple("POST", "/att/api/strava/app-connect", """{"challenge":"ch-1"}"""), sent())

        answer(200, fixture("strava.app-connect-finish"))
        assertTrue(api.stravaConnectFinish("c-1", "v-1").connected)
        assertEquals(Triple("POST", "/att/api/strava/app-connect/finish", """{"code":"c-1","verifier":"v-1"}"""), sent())

        answer(200, fixture("strava.auto-import"))
        assertFalse(api.setStravaAutoImport(false).autoImport)
        assertEquals(Triple("POST", "/att/api/strava/auto-import", """{"enabled":false}"""), sent())

        answer(200, """{"ok":true}""")
        api.stravaDisconnect()
        assertEquals(Triple("POST", "/att/api/strava/disconnect", ""), sent())

        answer(200, fixture("strava.status.not-connected"))
        assertFalse(api.stravaStatus().connected)
    }

    @Test fun aStravaConnectTooLongAfterSigningInAsksForASignIn() = runTest {
        answer(403, """{"error":"For your safety, connecting Strava needs a recent sign-in. Please sign in again.","reauth":true}""")
        assertTrue((runCatching { api.stravaConnect("ch") }.exceptionOrNull() as ApiFailure).reauth)
    }

    @Test fun aStravaAccountConnectedElsewhereSaysSoInTheServersWords() = runTest {
        answer(409, fixture("strava.app-connect-finish.linked-elsewhere"))
        val e = runCatching { api.stravaConnectFinish("c", "v") }.exceptionOrNull() as ApiFailure
        assertEquals(409, e.status)
        assertTrue(e.message!!.contains("already connected to another paddlesnitch account"))
    }

    @Test fun olderStravaPaddlesOneAtATime() = runTest {
        answer(200, """{"result":{"data":${fixture("sources.stravaHistory")}}}""")
        val h = api.stravaHistory(HistorySpan.First)
        assertEquals(2, h.toImport!!.size)
        assertEquals("/api/trpc/sources.stravaHistory?input=%7B%22since%22%3A%22first%22%7D", sent().second)

        answer(200, """{"result":{"data":${fixture("sources.importStravaPaddle")}}}""")
        assertEquals(StravaImport.Status.Imported, api.importStravaPaddle(h.toImport!![0]).status)
        assertEquals(Triple("POST", "/api/trpc/sources.importStravaPaddle", """{"id":12000000001,"sport":"Kayaking","startDate":"2026-07-04T06:30:00Z"}"""), sent())

        answer(200, """{"result":{"data":${fixture("sources.stravaHistoryDone")}}}""")
        api.stravaHistoryDone()
        assertEquals("/api/trpc/sources.stravaHistoryDone", sent().second)

        answer(200, """{"result":{"data":${fixture("sources.stravaHistory.rate-limited")}}}""")
        assertEquals(StravaHistory.Status.RateLimited, api.stravaHistory(HistorySpan.All).status)
        answer(200, """{"result":{"data":${fixture("sources.importStravaPaddle.skipped")}}}""")
        assertEquals(StravaImport.Reason.NotWaterSport, api.importStravaPaddle(h.toImport!![1]).reason)
    }

    @Test fun trackersWithTheirCardsWorkedOutByTheServer() = runTest {
        answer(200, fixture("account.devices"))
        val list = api.trackers()
        assertEquals(Triple("GET", "/api/account/devices", ""), sent())
        assertEquals(TrackerSummary.FirmwareState.UpdatePending, list.summaries[1].firmwareState)
        assertFalse(list.summaries.last().linked)

        answer(200, fixture("account.devices-sessions"))
        assertEquals("pdl_8Kq2Zr", api.recordings().sessions.first().paddleId)
        assertEquals(Triple("GET", "/api/account/devices/sessions", ""), sent())

        answer(200, """{"ok":true}""")
        api.removeTracker("C0FFEE01")
        assertEquals(Triple("DELETE", "/api/account/devices", """{"deviceId":"C0FFEE01"}"""), sent())
    }

    @Test fun aRecordingNamesThePaddleItBecame() = runTest {
        answer(200, """{"sessions":[{"sessionId":"rec-river","deviceId":"C0FFEE01","filename":"t.csv","uploadedAt":"2026-10-25T08:15:00.000Z","points":3,"paddleId":"pdl-river"},
            {"sessionId":"rec-desk","deviceId":"C0FFEE01","filename":"d.csv","uploadedAt":"2026-10-24T19:00:00.000Z","points":0}]}""")
        assertEquals(listOf("pdl-river", null), api.recordings().sessions.map { it.paddleId })
    }
}
