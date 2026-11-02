package com.paddlesnitch.app

import com.paddlesnitch.app.auth.GoogleSignIn
import java.io.Serializable
import java.net.URI

/** What a link or another app asked the app to do (MainActivity's intents). */
sealed interface Incoming : Serializable {
    /** Sign in with Google coming back from the Custom Tab (com.paddlesnitch.app:/signin/google). */
    data class GoogleReturn(val uri: String) : Incoming
    /** A paddlesnitch.com link to one paddle. */
    data class OpenPaddle(val id: String) : Incoming
    /** Another paddlesnitch.com link the app has no screen for: it opens in the browser. */
    data class OpenOnWeb(val url: String) : Incoming
    /** A GPS file opened with, or shared to, the app. */
    data class AddFile(val uri: String) : Incoming
}

const val SITE_HOST = "paddlesnitch.com"

/** The website's named pages under /paddles (everything else there is one paddle). IncomingTest checks the list against the website. */
val notPaddles = setOf("api", "compare", "new", "section", "sections", "shared")

/** Reads an intent's action, data and EXTRA_STREAM (as strings, so the JVM tests need no Android). */
fun incoming(action: String?, data: String?, stream: String?): Incoming? = when (action) {
    "android.intent.action.SEND" -> stream?.takeIf { it.startsWith("content:") }?.let { Incoming.AddFile(it) }
    "android.intent.action.VIEW" -> data?.let(::viewed)
    else -> null
}

private fun viewed(data: String): Incoming? {
    if (data.substringBefore('?') == GoogleSignIn.RETURN) return Incoming.GoogleReturn(data)
    if (data.startsWith("content:")) return Incoming.AddFile(data)
    val uri = runCatching { URI(data) }.getOrNull() ?: return null
    if (uri.scheme != "https" || uri.host != SITE_HOST) return null
    val parts = uri.path.orEmpty().split('/').filter { it.isNotEmpty() }
    return if (parts.size == 2 && parts[0] == "paddles" && parts[1] !in notPaddles) Incoming.OpenPaddle(parts[1]) else Incoming.OpenOnWeb(data)
}
