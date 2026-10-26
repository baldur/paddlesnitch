package com.paddlesnitch.app.account

import com.paddlesnitch.app.api.AccountApi
import com.paddlesnitch.app.api.HistoryPaddle
import com.paddlesnitch.app.api.StravaImport
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay

/** How far an import has got (the website's StravaHistoryImport). */
data class ImportProgress(
    val done: Int,
    val total: Int,
    val added: Int,
    /** Strava asked us to slow down: carrying on at this time (ms). */
    val waitUntil: Long? = null,
    val stopped: Stopped? = null,
) {
    enum class Stopped { DailyLimit, Error }
}

/**
 * Brings in older Strava paddles one at a time, as the website does (#415): no
 * background job, so the open screen shows progress, and leaving it just stops
 * (what came in stays). When Strava asks us to slow down it waits for Strava's
 * next quarter hour and carries on.
 */
class StravaImporter(
    private val api: AccountApi,
    private val now: () -> Long = System::currentTimeMillis,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    /** Works through [items]; true when every one was tried. */
    suspend fun run(items: List<HistoryPaddle>, onProgress: (ImportProgress) -> Unit): Boolean {
        var added = 0
        var waits = 0
        var i = 0
        while (i < items.size) {
            val r = try { api.importStravaPaddle(items[i]) } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException || e is com.paddlesnitch.app.api.SignedOut) throw e
                onProgress(ImportProgress(i, items.size, added, stopped = ImportProgress.Stopped.Error)); return false
            }
            if (r.status == StravaImport.Status.Skipped && r.reason == StravaImport.Reason.RateLimited) {
                // Two hours of quarter-hour waits: past that, Strava's daily allowance is gone.
                if (++waits > MAX_WAITS) { onProgress(ImportProgress(i, items.size, added, stopped = ImportProgress.Stopped.DailyLimit)); return false }
                val until = nextQuarterHour(now())
                onProgress(ImportProgress(i, items.size, added, waitUntil = until))
                sleep(until - now())
                continue
            }
            if (r.status == StravaImport.Status.Imported) added++
            i++
            onProgress(ImportProgress(i, items.size, added))
        }
        return true
    }

    companion object {
        const val MAX_WAITS = 8
        /** Strava's limits reset on the quarter hour; 20 s after it, to be safe. */
        fun nextQuarterHour(now: Long) = Math.ceil(now / 900_000.0).toLong() * 900_000 + 20_000
    }
}

/** The website's words for an import's progress; [what] is "your last month" or "your paddles". */
fun importStatus(p: ImportProgress, what: String, zone: ZoneId = ZoneId.systemDefault()): String = when {
    p.stopped == ImportProgress.Stopped.DailyLimit ->
        "Strava’s limit for today is used up, so we stopped after ${p.done} of ${p.total}. What came in stays; try again tomorrow for the rest."
    p.stopped == ImportProgress.Stopped.Error -> "Couldn’t bring in all your Strava paddles (${p.done} of ${p.total}). Please try again later."
    p.done >= p.total -> if (p.added > 0) "Added ${p.added} paddle${if (p.added == 1) "" else "s"} from Strava." else "Your Strava paddles were already here."
    p.waitUntil != null -> "Strava asks us to slow down. Carrying on at ${clock(p.waitUntil, zone)} (${p.done} of ${p.total} so far). Keep this screen open."
    else -> "Bringing in $what from Strava: ${p.done} of ${p.total}."
}

private fun clock(ms: Long, zone: ZoneId) = DateTimeFormatter.ofPattern("HH:mm").withZone(zone).format(Instant.ofEpochMilli(ms))
