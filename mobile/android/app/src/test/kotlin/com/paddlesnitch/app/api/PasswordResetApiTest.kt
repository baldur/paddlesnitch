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
import org.junit.Test

// Forgot password (mobile/contract/README.md § Signing in), against a fake server answering with the contract's fixtures.
class PasswordResetApiTest {
    private val server = MockWebServer()
    private val tokens = MemoryTokenStore()
    private lateinit var api: Api

    @Before fun start() { server.start(); api = Api(server.url("/").toString(), tokens, "0.1.0") }
    @After fun stop() = server.close()

    private fun fixture(name: String) = File("../../contract/fixtures/api/$name.json").readText()
    private fun answer(code: Int, body: String) = server.enqueue(MockResponse.Builder().code(code).body(body).build())
    private fun sent() = server.takeRequest().let { it.url.encodedPath to it.body?.utf8().orEmpty() }

    @Test fun aCodeIsAskedForWithTheBotCheck() = runTest {
        answer(200, """{"ok":true}""")
        api.requestPasswordReset("pat@example.com", 4200)
        assertEquals("/att/api/auth/password-reset/request" to """{"email":"pat@example.com","website":"","elapsedMs":4200}""", sent())
    }

    @Test fun theNewPasswordSignsInAndAsksWhoThisIs() = runTest {
        answer(200, fixture("auth.password-reset-confirm"))
        answer(200, """{"result":{"data":${fixture("me.signed-in")}}}""")
        val signedIn = api.confirmPasswordReset("pat@example.com", "123456", "Secret123")!!
        assertEquals("/att/api/auth/password-reset/confirm" to """{"email":"pat@example.com","code":"123456","password":"Secret123"}""", sent())
        assertEquals("Bearer eyJraWQiOiJleGFtcGxlIn0.eyJzdWIiOiJ1LWV4YW1wbGUifQ.signature", server.takeRequest().headers["Authorization"])
        assertEquals("user-1", signedIn.id)
        assertEquals("Pat", signedIn.displayName)
        assertNull(signedIn.needsTerms) // the Terms check on every start decides
        assertTrue(api.signedIn)
    }

    @Test fun setButNotSignedInMeansSignInAgain() = runTest {
        answer(200, """{"ok":true,"signedIn":false}""")
        assertNull(api.confirmPasswordReset("pat@example.com", "123456", "Secret123"))
        assertFalse(api.signedIn)
    }

    @Test fun aWrongCodeSaysWhyAndSignsNothingIn() = runTest {
        answer(400, """{"error":"That code is wrong or has expired. Request a new one."}""")
        val e = runCatching { api.confirmPasswordReset("pat@example.com", "000000", "Secret123") }.exceptionOrNull() as ApiFailure
        assertEquals("That code is wrong or has expired. Request a new one.", e.message)
        assertFalse(api.signedIn)
    }
}
