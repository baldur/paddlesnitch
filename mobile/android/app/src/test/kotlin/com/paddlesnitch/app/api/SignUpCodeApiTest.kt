package com.paddlesnitch.app.api

import com.paddlesnitch.app.auth.MemoryTokenStore
import java.io.File
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

// Sign-up proves the email with a code (#702, mobile/contract/README.md § Signing in).
class SignUpCodeApiTest {
    private val server = MockWebServer()
    private val tokens = MemoryTokenStore()
    private lateinit var api: Api

    @Before fun start() { server.start(); api = Api(server.url("/").toString(), tokens, "0.1.0") }
    @After fun stop() = server.close()

    private fun answer(code: Int, body: String) = server.enqueue(MockResponse.Builder().code(code).body(body).build())
    private fun sent() = server.takeRequest().let { it.url.encodedPath to it.body?.utf8().orEmpty() }
    private fun fixture(name: String) = File("../../contract/fixtures/api/$name.json").readText()
    private val signedIn = fixture("auth.login")

    @Test fun creatingAnAccountSendsACodeAndSignsNothingIn() = runTest {
        answer(202, fixture("auth.signup"))
        assertEquals("sam@example.com", api.signUp("pat@example.com", "Pat", "Secret123", "002").email)
        assertEquals("/att/api/auth/signup" to """{"email":"pat@example.com","displayName":"Pat","password":"Secret123","acceptedTosVersion":"002"}""", sent())
        assertFalse(api.signedIn)
    }

    @Test fun theCodeSignsInWithTheTermsOnlyWhenJustTicked() = runTest {
        answer(201, signedIn)
        api.confirmSignUp("pat@example.com", "123456", "Secret123", "002")
        assertEquals("/att/api/auth/signup/confirm" to """{"email":"pat@example.com","code":"123456","password":"Secret123","acceptedTosVersion":"002"}""", sent())
        assertTrue(api.signedIn)

        answer(201, signedIn)
        api.confirmSignUp("pat@example.com", "123456", "Secret123", null)
        assertEquals("""{"email":"pat@example.com","code":"123456","password":"Secret123"}""", sent().second)
    }

    @Test fun aWrongCodeSaysWhy() = runTest {
        answer(400, """{"error":"That code is not valid. Check your email and try again."}""")
        val e = runCatching { api.confirmSignUp("pat@example.com", "000000", "Secret123", null) }.exceptionOrNull() as ApiFailure
        assertEquals("That code is not valid. Check your email and try again.", e.message)
        assertFalse(api.signedIn)
    }

    @Test fun signingInBeforeTheCodeWasEnteredAsksForIt() = runTest {
        answer(403, fixture("auth.login.needs-code"))
        val e = runCatching { api.login("pat@example.com", "Secret123") }.exceptionOrNull() as ApiFailure
        assertTrue(e.needsCode)
        assertEquals("Confirm your email first. We’ve sent you a new code.", e.message)
        assertFalse(api.signedIn)
    }

    @Test fun tooManyCodesIsARefusalNotACodeSent() = runTest {
        answer(429, fixture("auth.too-many-codes"))
        val e = runCatching { api.signUp("pat@example.com", "Pat", "Secret123", "002") }.exceptionOrNull() as ApiFailure
        assertEquals(429, e.status)
        assertFalse(e.needsCode)
        assertEquals("We’ve sent this email too many codes. Please wait an hour and try again.", e.message)
    }
}
