package com.paddlesnitch.app.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** The app's own return address scheme (com.paddlesnitch.app:/…), for sign-ins in a Custom Tab. */
const val RETURN_SCHEME = "com.paddlesnitch.app"

interface VerifierStore {
    fun put(verifier: String)
    /** The verifier, once. */
    fun take(): String?
}

/** RFC 7636 S256. */
object Pkce {
    fun verifier(random: SecureRandom = SecureRandom()): String = ByteArray(32).also(random::nextBytes).b64()
    fun challenge(verifier: String): String = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()).b64()
    private fun ByteArray.b64() = Base64.getUrlEncoder().withoutPadding().encodeToString(this)
}
