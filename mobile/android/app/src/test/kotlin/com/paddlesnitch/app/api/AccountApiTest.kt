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
        answer(200, """{"ok":true}""")
        api.removeContact()
        sent()
        assertEquals("DELETE", sent().first)
    }

    @Test fun deletingTheAccountSendsTheRefreshTokenThenForgetsBoth() = runTest {
        answer(200, """{"ok":true}""")
        api.deleteAccount()
        assertEquals(Triple("DELETE", "/api/account", """{"refreshToken":"r-1"}"""), sent())
        assertNull(tokens.refreshToken)
        assertFalse(api.signedIn)
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
}
