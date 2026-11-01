package com.paddlesnitch.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// PKCE for the sign-ins that come back from a Custom Tab (Google).
class PkceTest {
    @Test fun pkceMatchesTheRfcExample() =
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))

    @Test fun verifiersAreFreshAndTheRightShape() {
        val a = Pkce.verifier()
        assertTrue(a.matches(Regex("[A-Za-z0-9_-]{43}")))
        assertTrue(a != Pkce.verifier())
    }
}
