package com.paddlesnitch.app.account

import com.paddlesnitch.app.api.HistoryPaddle
import com.paddlesnitch.app.api.HistorySpan
import com.paddlesnitch.app.api.StravaHistory
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

// The Strava imports' lifetime: once per visit, and stop() when Account is left.
@OptIn(ExperimentalCoroutinesApi::class)
class StravaImportModelTest {
    private val main = StandardTestDispatcher()
    private val paddles = (1L..2L).map { HistoryPaddle(it, "Paddle $it", "Kayaking", "2026-07-0${it}T06:30:00Z", 5000.0) }
    @Before fun setUp() = Dispatchers.setMain(main)
    @After fun tearDown() = Dispatchers.resetMain()

    @Test fun theFirstMonthIsAskedForOncePerVisit() = runTest(main) {
        val api = FakeAccountApi(history = { StravaHistory(StravaHistory.Status.Ok, paddles, 0, firstImportDone = false) })
        val model = StravaImportModel(api)
        model.startFirst(); model.startFirst() // recomposition, or turning the phone
        advanceUntilIdle()
        assertEquals(1, api.calls.count { it == "history first" })
        assertEquals(ImportProgress(2, 2, 2), model.first)
        assertTrue("history done" in api.calls)
    }

    @Test fun leavingStopsAnImportAndTheNextVisitStartsAfresh() = runTest(main) {
        val gate = CompletableDeferred<Unit>()
        val api = FakeAccountApi(importGate = gate, history = { StravaHistory(StravaHistory.Status.Ok, paddles, 0, firstImportDone = false) })
        val model = StravaImportModel(api)
        model.startFirst(); advanceUntilIdle()
        assertTrue(model.running)
        model.stop(); advanceUntilIdle()
        assertFalse(model.running)
        assertNull(model.first)
        gate.complete(Unit); advanceUntilIdle()
        assertFalse(api.calls.any { it.startsWith("import") }) // nothing after leaving
        model.startFirst(); advanceUntilIdle()
        assertEquals(2, api.calls.count { it == "history first" })
    }

    @Test fun anEndedSessionDuringAnImportSaysSo() = runTest(main) {
        val api = FakeAccountApi(history = { StravaHistory(StravaHistory.Status.Ok, paddles, 0, true) })
        val model = StravaImportModel(api)
        api.signedOut = true
        model.span = HistorySpan.All
        model.startOlder(); advanceUntilIdle()
        assertTrue(model.signedOut)
        assertFalse(model.running)
    }
}
