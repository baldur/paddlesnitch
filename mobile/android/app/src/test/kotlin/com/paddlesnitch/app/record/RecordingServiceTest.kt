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

    private var account: String? = "u-77"
    private val made = mutableListOf<File>()
    private val started = mutableListOf<String>()
    private val finished = mutableListOf<String>()

    private fun service(broken: Boolean = false) = Robolectric.buildService(RecordingService::class.java).create().also {
        it.get().signedInAccount = { account }
        it.get().onStarted = { _, a -> started += a }
        it.get().onFinished = { _, a -> finished += a }
        it.get().makeRecorder = { c, folder ->
            made += folder
            PhoneRecorder(c, if (broken) File(File(dir, "taken").apply { writeText("") }, "recordings") else File(dir, folder.name))
        }
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

    // C3: Start lets a removed phone be added again; a finished recording goes up, to the account that recorded it.
    @Test fun aRecordingUploadsOnceItStopsToTheAccountThatRecordedIt() {
        val s = service()
        s.startCommand(0, 1)
        assertEquals(listOf("u-77"), started)
        assertEquals(emptyList<String>(), finished)   // never while it runs
        account = "u-78"
        s.withIntent(Intent(app, RecordingService::class.java).setAction(RecordingService.ACTION_STOP)).startCommand(0, 2)
        waitFor("stopped") { RecordingService.state.value is RecordingService.State.Stopped }
        assertEquals(listOf("u-77"), finished)
    }

    @Test fun aRecordingTheSystemBringsBackIsntAStart() {
        service().startCommand(0, 1)
        service().get().onStartCommand(null, 0, 1)
        assertEquals(listOf("u-77"), started)
    }

    // This test phone has an accelerometer and no gyroscope: GPS only, and the screen says so.
    @Test fun withoutBothMotionSensorsItRecordsWithoutMotion() {
        service().startCommand(0, 1)
        assertEquals(false, (RecordingService.state.value as RecordingService.State.Recording).motion)
    }

    @Test fun aStartThatFailsLetsGoOfEverything() {
        val s = service(broken = true)
        s.startCommand(0, 1)
        assertEquals(RecordingService.State.Failed(locationRefused = false), RecordingService.state.value)
        assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
        assertTrue(shadowOf(s.get()).isStoppedBySelf)
    }

    @Test fun aRecordingTheSystemBringsBackKeepsItsAccountWhoeverIsSignedInNow() {
        service().startCommand(0, 1)                 // u-77 starts recording
        account = "u-78"                             // signs out; someone else signs in
        val restarted = service()                    // the system kills and restarts the service
        restarted.get().onStartCommand(null, 0, 1)   // as the system restarts a sticky service
        assertTrue(RecordingService.state.value is RecordingService.State.Recording)
        assertEquals(listOf("u-77", "u-77"), made.map { it.name })
        restarted.destroy()
        assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
    }

    // A refused token refresh signs out by itself (#702): the recording goes on, in the folder
    // of the account that tapped Record, and App.kt's signedOut() leaves it alone.
    @Test fun aForcedSignOutMidRecordingKeepsRecordingToTheSameAccount() {
        val s = service()
        s.startCommand(0, 1)
        val files = (RecordingService.state.value as RecordingService.State.Recording).files
        account = null
        RecordingService.forgetFinished()            // what signedOut() does
        assertTrue(RecordingService.state.value is RecordingService.State.Recording)
        assertTrue(ShadowPowerManager.getLatestWakeLock().isHeld)
        assertEquals(listOf("u-77"), made.map { it.name })
        s.withIntent(Intent(app, RecordingService::class.java).setAction(RecordingService.ACTION_STOP)).startCommand(0, 2)
        waitFor("stopped") { RecordingService.state.value is RecordingService.State.Stopped }
        assertEquals(File(dir, "u-77"), files.track.parentFile)
        assertTrue(files.log.exists())
    }

    @Test fun aStartWithNoOneSignedInFails() {
        account = null
        service().startCommand(0, 1)
        assertEquals(RecordingService.State.Failed(locationRefused = false), RecordingService.state.value)
    }

    @Test fun destroyingTheServiceEndsTheRecording() {
        val s = service()
        s.startCommand(0, 1)
        val files = (RecordingService.state.value as RecordingService.State.Recording).files
        s.destroy()
        assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
        assertTrue(files.track.readText().startsWith("timestamp,"))
    }

    // App.kt's onDeleted: the deleted account's recordings go; others', and a sign-out's, stay.
    @Test fun deletingAnAccountRemovesItsRecordingsOnly() {
        val base = RecordingService.recordingsDir(app)
        val mine = RecordingFiles.accountDir(base, "u-77").apply { mkdirs(); resolve("track_x.csv").writeText("x") }
        val theirs = RecordingFiles.accountDir(base, "u-78").apply { mkdirs(); resolve("track_y.csv").writeText("y") }
        com.paddlesnitch.app.deleteRecordings(app, null)   // no account known: nothing goes
        assertTrue(mine.exists())
        com.paddlesnitch.app.deleteRecordings(app, "u-77")
        assertFalse(mine.exists())
        assertTrue(theirs.resolve("track_y.csv").exists())
    }

    @Test fun deletingAnAccountDoesntStopSomeoneElsesRecording() {
        val base = RecordingService.recordingsDir(app)
        val theirs = RecordingFiles.create(RecordingFiles.accountDir(base, "u-78"), java.time.Instant.parse("2026-10-31T09:14:07Z"))
        RecordingService.set(RecordingService.State.Recording(theirs, kotlinx.coroutines.flow.MutableStateFlow(null), 0L))
        com.paddlesnitch.app.deleteRecordings(app, "u-77")
        assertEquals(null, shadowOf(app).nextStartedService)
        RecordingService.set(RecordingService.State.Idle)
        com.paddlesnitch.app.deleteRecordings(app, "u-78")   // but its own is stopped
        RecordingService.set(RecordingService.State.Recording(theirs, kotlinx.coroutines.flow.MutableStateFlow(null), 0L))
        com.paddlesnitch.app.deleteRecordings(app, "u-78")
        assertEquals(RecordingService.ACTION_STOP, shadowOf(app).nextStartedService?.action)
        theirs.close()
    }

    @Test fun signingOutForgetsAFinishedRecordingsMessage() {
        RecordingService.set(RecordingService.State.Stopped(RecordingFiles(File(dir, "a.csv"), File(dir, "b.csv")), 1000L))
        RecordingService.forgetFinished()
        assertEquals(RecordingService.State.Idle, RecordingService.state.value)
    }
}
