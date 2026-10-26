package com.paddlesnitch.app.account

import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// The Strava connect verifier: kept while Strava is open, never for long, gone on sign-out.
@RunWith(RobolectricTestRunner::class)
class ConnectVerifierStoreTest {
    private var clock = 1_000_000L
    private val store = PrefsConnectVerifierStore(ApplicationProvider.getApplicationContext()) { clock }

    @Test fun keptOnceForAConnectInProgress() {
        store.put("v-1")
        assertTrue(store.pending)
        assertEquals("v-1", store.take())
        assertNull(store.take())
        assertFalse(store.pending)
    }

    @Test fun anAbandonedConnectIsForgottenAfterTenMinutes() {
        store.put("v-1")
        clock += 10 * 60 * 1000L
        assertFalse(store.pending)
        assertNull(store.take())
    }

    @Test fun signingOutForgetsIt() {
        store.put("v-1")
        clearStravaConnect(ApplicationProvider.getApplicationContext())
        assertFalse(store.pending)
    }
}
