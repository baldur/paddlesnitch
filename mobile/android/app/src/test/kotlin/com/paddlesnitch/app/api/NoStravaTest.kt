package com.paddlesnitch.app.api

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

// Strava is gone for good (owner, 2026-11-01), and the server removes its routes after this
// app ships: the app never calls one. Old paddles still say Strava (Format.kt's labels).
class NoStravaTest {
    private val calls = Regex("""api/strava|auth/strava|strava/init|sources\.(stravaHistory|importStravaPaddle|stravaHistoryDone)|/account/strava""", RegexOption.IGNORE_CASE)

    @Test fun noScreenOrCallReachesStrava() {
        val found = File("src/main").walk().filter { it.isFile && it.extension in setOf("kt", "xml") }.flatMap { f ->
            f.readLines().mapIndexedNotNull { i, l -> if (calls.containsMatchIn(l)) "${f.name}:${i + 1}" else null }
        }.toList()
        assertEquals(emptyList<String>(), found)
    }

    @Test fun theOnlyStravaWordsLeftAreTheLabelsAndTheWayInForStravaAccounts() {
        val allowed = setOf("Format.kt", "SignInScreen.kt", "AccountScreen.kt", "Api.kt", "PaddleScreen.kt")
        val found = File("src/main").walk().filter { it.isFile && it.extension in setOf("kt", "xml") && it.name !in allowed }
            .filter { it.readText().contains("strava", ignoreCase = true) }.map { it.name }.toList()
        assertEquals(emptyList<String>(), found)
    }
}
