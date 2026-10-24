package com.paddlesnitch.app.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The signed-in person's tokens (docs/features/android-app.md, sign-in). */
interface TokenStore {
    val idToken: String?
    val refreshToken: String?
    fun save(idToken: String, refreshToken: String? = null)
    fun clear()
}

/** For tests, and for the moment between signing in and saving. */
class MemoryTokenStore : TokenStore {
    override var idToken: String? = null; private set
    override var refreshToken: String? = null; private set
    override fun save(idToken: String, refreshToken: String?) { this.idToken = idToken; if (refreshToken != null) this.refreshToken = refreshToken }
    override fun clear() { idToken = null; refreshToken = null }
}

/**
 * Keeps the tokens encrypted with an AES key that lives in the Android
 * Keystore (it never leaves the phone's secure hardware), so the refresh token
 * on disk is useless to anyone who copies the app's files.
 */
class KeystoreTokenStore(context: Context) : TokenStore {
    private val prefs = context.getSharedPreferences("auth", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as SecretKey?)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build())
        }.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(c.iv + c.doFinal(plain.toByteArray()), Base64.NO_WRAP)
    }

    // A value that won't decrypt (the key was wiped, say after a restore to a
    // new phone) reads as signed out rather than crashing.
    private fun decrypt(stored: String?): String? = stored?.let {
        runCatching {
            val bytes = Base64.decode(it, Base64.NO_WRAP)
            val c = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12)) }
            String(c.doFinal(bytes, 12, bytes.size - 12))
        }.getOrNull()
    }

    override val idToken get() = decrypt(prefs.getString("id", null))
    override val refreshToken get() = decrypt(prefs.getString("refresh", null))

    override fun save(idToken: String, refreshToken: String?) {
        prefs.edit().putString("id", encrypt(idToken)).apply {
            if (refreshToken != null) putString("refresh", encrypt(refreshToken))
        }.apply()
    }

    override fun clear() = prefs.edit().clear().apply()

    private companion object {
        const val ALIAS = "paddlesnitch-tokens"
        const val TRANSFORM = "AES/GCM/NoPadding"
    }
}
