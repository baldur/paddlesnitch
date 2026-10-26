package com.paddlesnitch.app.account

import com.paddlesnitch.app.api.AccountApi
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.HistoryPaddle
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.api.StravaImport
import java.time.ZoneOffset
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Older Strava paddles one at a time, as the website's StravaHistoryImport.
class StravaImporterTest {
    private val items = (1L..3L).map { HistoryPaddle(it, "Paddle $it", "Kayaking", "2026-07-0${it}T06:30:00Z", 5000.0) }
    private var clock = 1_000_000_000L
    private val slept = mutableListOf<Long>()
    private val answers = ArrayDeque<() -> StravaImport>()
    private val sent = mutableListOf<Long>()
    private val api = object : AccountApi by FakeAccountApi() {
        override suspend fun importStravaPaddle(paddle: HistoryPaddle): StravaImport { sent += paddle.id; return answers.removeFirst()() }
    }
    private val importer = StravaImporter(api, now = { clock }, sleep = { slept += it; clock += it })
    private val progress = mutableListOf<ImportProgress>()
    private fun answer(vararg a: StravaImport) = a.forEach { r -> answers.addLast { r } }
    private val imported = StravaImport(StravaImport.Status.Imported, "pdl-1")
    private val duplicate = StravaImport(StravaImport.Status.Duplicate, "pdl-2")
    private val rateLimited = StravaImport(StravaImport.Status.Skipped, reason = StravaImport.Reason.RateLimited)

    @Test fun eachPaddleInTurnCountingOnlyTheNewOnes() = runTest {
        answer(imported, duplicate, StravaImport(StravaImport.Status.Skipped, reason = StravaImport.Reason.NotWaterSport))
        assertTrue(importer.run(items) { progress += it })
        assertEquals(listOf(1L, 2L, 3L), sent)
        assertEquals(ImportProgress(3, 3, 1), progress.last())
    }

    @Test fun whenStravaAsksToSlowDownItWaitsForTheNextQuarterHourAndRetriesThatPaddle() = runTest {
        answer(imported, rateLimited, imported, imported)
        assertTrue(importer.run(items) { progress += it })
        assertEquals(listOf(1L, 2L, 2L, 3L), sent)
        val wait = progress.first { it.waitUntil != null }
        assertEquals(StravaImporter.nextQuarterHour(1_000_000_000L), wait.waitUntil)
        assertEquals(0L, (wait.waitUntil!! - 20_000) % 900_000) // on Strava's quarter hour, plus 20 s
        assertEquals(ImportProgress(3, 3, 3), progress.last())
    }

    @Test fun pastTwoHoursOfWaitingTodaysLimitIsGone() = runTest {
        repeat(StravaImporter.MAX_WAITS + 1) { answer(rateLimited) }
        assertFalse(importer.run(items) { progress += it })
        assertEquals(StravaImporter.MAX_WAITS, slept.size)
        assertEquals(ImportProgress(0, 3, 0, stopped = ImportProgress.Stopped.DailyLimit), progress.last())
    }

    @Test fun aFailureStopsAndSaysHowFarItGot() = runTest {
        answers.addLast { imported }; answers.addLast { throw ApiFailure("x", 500, generic = true) }
        assertFalse(importer.run(items) { progress += it })
        assertEquals(ImportProgress(1, 3, 1, stopped = ImportProgress.Stopped.Error), progress.last())
    }

    @Test(expected = SignedOut::class) fun anEndedSessionIsNotSwallowed() = runTest {
        answers.addLast { throw SignedOut() }
        importer.run(items) {}
    }

    @Test fun theWebsitesWords() {
        val utc = ZoneOffset.UTC
        assertEquals("Bringing in your last month from Strava: 1 of 3.", importStatus(ImportProgress(1, 3, 1), "your last month", utc))
        assertEquals("Added 1 paddle from Strava.", importStatus(ImportProgress(3, 3, 1), "x", utc))
        assertEquals("Added 2 paddles from Strava.", importStatus(ImportProgress(3, 3, 2), "x", utc))
        assertEquals("Your Strava paddles were already here.", importStatus(ImportProgress(3, 3, 0), "x", utc))
        assertEquals("Strava asks us to slow down. Carrying on at 10:15 (1 of 3 so far). Keep this screen open.",
            importStatus(ImportProgress(1, 3, 1, waitUntil = java.time.Instant.parse("2026-07-04T10:15:20Z").toEpochMilli()), "x", utc))
        assertEquals("Strava’s limit for today is used up, so we stopped after 1 of 3. What came in stays; try again tomorrow for the rest.",
            importStatus(ImportProgress(1, 3, 1, stopped = ImportProgress.Stopped.DailyLimit), "x", utc))
        assertEquals("Couldn’t bring in all your Strava paddles (1 of 3). Please try again later.",
            importStatus(ImportProgress(1, 3, 1, stopped = ImportProgress.Stopped.Error), "x", utc))
        // Stopped before anything was listed: no "0 of 0".
        assertEquals("Strava’s limit for today is used up. Please try again tomorrow.", importStatus(ImportProgress(0, 0, 0, stopped = ImportProgress.Stopped.DailyLimit), "x", utc))
        assertEquals("Couldn’t bring in your Strava paddles. Please try again later.", importStatus(ImportProgress(0, 0, 0, stopped = ImportProgress.Stopped.Error), "x", utc))
    }

    @Test fun talkBackHearsOnlyWhenItStartsWaitsStopsOrEnds() {
        val utc = ZoneOffset.UTC
        assertEquals("Bringing in your paddles from Strava.", importAnnouncement(ImportProgress(0, 40, 0), "your paddles", utc))
        assertEquals("Bringing in your paddles from Strava.", importAnnouncement(ImportProgress(17, 40, 12), "your paddles", utc)) // not every paddle
        assertEquals("Added 30 paddles from Strava.", importAnnouncement(ImportProgress(40, 40, 30), "your paddles", utc))
        assertTrue(importAnnouncement(ImportProgress(17, 40, 12, waitUntil = 0), "your paddles", utc).startsWith("Strava asks us to slow down."))
    }

    @Test fun leavingTheScreenStopsTheImportMidWait() = runTest {
        val waiting = kotlinx.coroutines.CompletableDeferred<Unit>()
        val stuck = StravaImporter(api, now = { clock }, sleep = { waiting.complete(Unit); kotlinx.coroutines.awaitCancellation() })
        answer(imported, rateLimited, imported, imported)
        val job = launch { stuck.run(items) { progress += it } }
        waiting.await()
        job.cancel(); job.join()
        assertTrue(job.isCancelled)
        assertEquals(listOf(1L, 2L), sent) // nothing more after leaving
        assertTrue(progress.none { it.stopped != null }) // it stopped; it didn't fail
    }
}
