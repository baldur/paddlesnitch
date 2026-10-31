package com.paddlesnitch.app.record

import android.app.Application
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorManager
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowLooper
import org.robolectric.shadows.ShadowPowerManager
import org.robolectric.shadows.ShadowSensor

// The service that keeps a recording going with the screen off: it starts,
// holds the phone awake only while recording, and always lets go.
@RunWith(RobolectricTestRunner::class)
class RecordingServiceTest {
    private val app = ApplicationProvider.getApplicationContext<Application>()
    private val dir: File = Files.createTempDirectory("rec").toFile()

    @Before fun setUp() {
        RecordingService.set(RecordingService.State.Idle)
        shadowOf(app.getSystemService(SensorManager::class.java)).addSensor(ShadowSensor.newInstance(Sensor.TYPE_ACCELEROMETER))
    }

    @After fun tearDown() { dir.deleteRecursively() }

    private fun service(recordingsDir: File = dir) = Robolectric.buildService(RecordingService::class.java).create().also {
        it.get().makeRecorder = { c -> PhoneRecorder(c, recordingsDir) }
    }

    /** Stopping finishes the files on another thread, then comes back to the main one. */
    private fun waitFor(what: String, done: () -> Boolean) {
        val until = System.currentTimeMillis() + 5_000
        while (!done()) {
            check(System.currentTimeMillis() < until) { "never: $what" }
            ShadowLooper.idleMainLooper()
            Thread.sleep(10)
        }
    }

    @Test fun startingRecordsAndHoldsTheWakeLock() {
        val s = service()
        s.startCommand(0, 1)
        val state = RecordingService.state.value
        assertTrue("state $state", state is RecordingService.State.Recording)
        assertTrue(ShadowPowerManager.getLatestWakeLock().isHeld)
        assertNotEquals(null, shadowOf(s.get()).lastForegroundNotification)
        s.withIntent(Intent(app, RecordingService::class.java).setAction(RecordingService.ACTION_STOP)).startCommand(0, 2)
        waitFor("stopped") { RecordingService.state.value is RecordingService.State.Stopped }
        assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
        assertTrue(shadowOf(s.get()).isForegroundStopped)
        assertTrue(shadowOf(s.get()).isStoppedBySelf)
        assertTrue((state as RecordingService.State.Recording).files.track.length() > 0)
    }

    @Test fun aStartThatFailsLetsGoOfEverything() {
        val s = service(File(File(dir, "taken").apply { writeText("") }, "recordings"))
        s.startCommand(0, 1)
        assertEquals(RecordingService.State.Failed(locationRefused = false), RecordingService.state.value)
        assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
        assertTrue(shadowOf(s.get()).isStoppedBySelf)
    }

    @Test fun aRecordingTheSystemBringsBackStartsNewFiles() {
        val s = service()
        s.withIntent(null).startCommand(0, 1)
        assertTrue(RecordingService.state.value is RecordingService.State.Recording)
        s.destroy()
        assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
    }

    @Test fun destroyingTheServiceEndsTheRecording() {
        val s = service()
        s.startCommand(0, 1)
        val files = (RecordingService.state.value as RecordingService.State.Recording).files
        s.destroy()
        assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
        assertTrue(files.track.readText().startsWith("timestamp,"))
    }
}
