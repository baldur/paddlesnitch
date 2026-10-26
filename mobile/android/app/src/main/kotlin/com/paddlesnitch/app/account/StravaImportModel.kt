package com.paddlesnitch.app.account

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.paddlesnitch.app.api.AccountApi
import com.paddlesnitch.app.api.HistorySpan
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.api.StravaHistory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * The Strava imports on Account (the first month by itself, and Older paddles).
 * A ViewModel, so turning the phone or changing a setting during a long import
 * (Strava's waits are up to 15 minutes) carries on instead of starting again.
 * Leaving Account calls [stop]: what came in stays, as on the website.
 */
class StravaImportModel(private val api: AccountApi) : ViewModel() {
    private val importer = StravaImporter(api)
    var first by mutableStateOf<ImportProgress?>(null); private set
    var firstRunning by mutableStateOf(false); private set
    var older by mutableStateOf<ImportProgress?>(null); private set
    var olderRunning by mutableStateOf(false); private set
    var span by mutableStateOf(HistorySpan.Year)
    /** The session ended during an import: sign in again. */
    var signedOut by mutableStateOf(false); private set
    private var firstJob: Job? = null
    private var olderJob: Job? = null
    private var firstAsked = false

    val running get() = firstRunning || olderRunning

    /** Once per visit: about the last month, unless it was brought in before. */
    fun startFirst() {
        if (firstAsked) return
        firstAsked = true
        firstJob = viewModelScope.launch {
            firstRunning = true
            try {
                val h = api.stravaHistory(HistorySpan.First)
                if (h.status == StravaHistory.Status.Ok && !h.firstImportDone) {
                    val items = h.toImport.orEmpty()
                    if (items.isNotEmpty()) first = ImportProgress(0, items.size, 0)
                    // Marked done only when every paddle was tried; otherwise the next visit carries on.
                    if (importer.run(items) { first = it }) api.stravaHistoryDone()
                }
            } catch (e: CancellationException) { throw e } catch (e: SignedOut) { signedOut = true } catch (_: Exception) {
                // Quietly: Older paddles can do it by hand.
            } finally { firstRunning = false }
        }
    }

    fun startOlder() {
        if (olderRunning) return
        older = null
        olderJob = viewModelScope.launch {
            olderRunning = true
            try {
                val h = api.stravaHistory(span)
                when (h.status) {
                    StravaHistory.Status.RateLimited -> older = ImportProgress(0, 0, 0, stopped = ImportProgress.Stopped.DailyLimit)
                    StravaHistory.Status.Ok -> h.toImport.orEmpty().let { items -> older = ImportProgress(0, items.size, 0); importer.run(items) { older = it } }
                    else -> {} // not connected (any more): the section shows Connect once it knows, as on the website
                }
            } catch (e: CancellationException) { throw e } catch (e: SignedOut) { signedOut = true } catch (_: Exception) {
                older = ImportProgress(0, 0, 0, stopped = ImportProgress.Stopped.Error)
            } finally { olderRunning = false }
        }
    }

    /** Left Account (or Strava went): stop, and start afresh next visit. */
    fun stop() {
        firstJob?.cancel(); olderJob?.cancel()
        firstAsked = false; first = null; older = null
    }
}
