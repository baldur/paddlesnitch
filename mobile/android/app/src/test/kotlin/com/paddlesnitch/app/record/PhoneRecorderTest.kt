package com.paddlesnitch.app.record

import android.Manifest
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationManager
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.nio.file.Files
import java.time.Instant
import org.junit.After
import android.content.Intent
import android.os.BatteryManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSensor
import org.robolectric.shadows.SensorEventBuilder

// The sensor adapter: synthetic Android events go to the core as delivered
// (m/s², rad/s, SensorEvent.timestamp), and the core's files say what the
// tracker would: +1 g on the axis pointing up, deg/s.
@RunWith(RobolectricTestRunner::class)
class PhoneRecorderTest {
    // What Android reports for 1 g at rest (m/s²): an input as the phone gives it, not a conversion.
    private val G = SensorManager.STANDARD_GRAVITY

    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val sensors = context.getSystemService(SensorManager::class.java)
    private val dir: File = Files.createTempDirectory("rec").toFile()
    private var clockNs = 0L
    private lateinit var recorder: PhoneRecorder

    @Before fun setUp() {
        shadowOf(context as android.app.Application).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        recorder = PhoneRecorder(context, dir, now = { Instant.parse("2026-10-31T09:14:07Z") }, clock = { clockNs })
    }

    @After fun tearDown() { recorder.stop(); dir.deleteRecursively() }

    private fun addSensors(gyro: Boolean = true) {
        shadowOf(sensors).addSensor(ShadowSensor.newInstance(Sensor.TYPE_ACCELEROMETER))
        if (gyro) shadowOf(sensors).addSensor(ShadowSensor.newInstance(Sensor.TYPE_GYROSCOPE))
    }

    private fun send(type: Int, tNs: Long, x: Float, y: Float, z: Float) = recorder.onThread {
        val e = SensorEventBuilder.newBuilder().setSensor(sensors.getDefaultSensor(type)!!)
            .setValues(floatArrayOf(x, y, z)).setTimestamp(tNs).build()
        shadowOf(sensors).sendSensorEventToListeners(e)
    }

    /** Both sensors at 50 Hz from [fromS] to [toS] seconds, at one attitude. */
    private fun hold(fromS: Int, toS: Int, accel: Triple<Float, Float, Float>, gyro: Triple<Float, Float, Float>) {
        var t = fromS * 1_000_000_000L
        while (t < toS * 1_000_000_000L) {
            send(Sensor.TYPE_ACCELEROMETER, t, accel.first, accel.second, accel.third)
            send(Sensor.TYPE_GYROSCOPE, t, gyro.first, gyro.second, gyro.third)
            t += 20_000_000L
        }
    }

    private fun tickAt(s: Int) { clockNs = s * 1_000_000_000L; recorder.onThread { recorder.tickNow() } }

    private fun motionRows(f: RecordingFiles) = f.motion.readLines().drop(1).map { it.split(',') }

    @Test fun flatOnATableReadsPlusOneGOnZ() {
        addSensors()
        recorder.start()
        hold(10, 13, Triple(0f, 0f, G), Triple(0f, 0f, 0f))
        tickAt(11); tickAt(12)
        val f = recorder.stop()!!
        val rows = motionRows(f)
        assertTrue("motion rows: ${rows.size}", rows.size > 20)
        rows.forEach { assertEquals(listOf("0.0000", "0.0000", "1.0000"), it.subList(1, 4)) }
        // Timestamps are the events' own (10 s in = 10,000 ms), not when they arrived.
        assertEquals("10000", rows.first()[0])
        assertEquals(3, f.track.readLines().size)   // header + two rows
    }

    @Test fun tippedRightSideDownThenNoseDownMoveGravityAcrossAxes() {
        addSensors()
        recorder.start()
        hold(10, 12, Triple(G, 0f, 0f), Triple(0f, 0f, 0f))   // +x up
        hold(12, 14, Triple(0f, G, 0f), Triple(0f, 0f, 0f))   // +y up
        tickAt(11); tickAt(12); tickAt(13)
        val rows = motionRows(recorder.stop()!!)
        assertEquals(listOf("1.0000", "0.0000", "0.0000"), rows.first { it[0].toLong() < 12000 }.subList(1, 4))
        assertEquals(listOf("0.0000", "1.0000", "0.0000"), rows.last().subList(1, 4))
    }

    @Test fun theGyroscopeGoesInAsRadiansAndComesOutInDegrees() {
        addSensors()
        recorder.start()
        hold(10, 12, Triple(0f, 0f, G), Triple(0f, 0f, 1f))
        tickAt(11)
        val rows = motionRows(recorder.stop()!!)
        assertEquals(listOf("0.00", "0.00", "57.30"), rows.first().subList(4, 7))
    }

    @Test fun withoutAGyroscopeRowsAreWrittenAtOnceAndSamplesIgnored() {
        addSensors(gyro = false)
        val f = recorder.start()
        send(Sensor.TYPE_ACCELEROMETER, 10_000_000_000L, 0f, 0f, G)
        tickAt(11)
        // Read before stopping: finishing writes held rows, which would hide a core told motion=1.
        assertEquals(2, f.track.readLines().size)
        assertEquals(1, f.motion.readLines().size)   // the header only
    }

    @Test fun withBothSensorsRowsWaitForTheirSamples() {
        addSensors()
        val f = recorder.start()
        tickAt(11)
        assertEquals(1, f.track.readLines().size)   // held: no sensor has passed 11 s yet
        hold(10, 12, Triple(0f, 0f, G), Triple(0f, 0f, 0f))
        assertEquals(2, f.track.readLines().size)
    }

    @Test fun theBatteryVoltageGoesInEachRow() {
        context.sendStickyBroadcast(Intent(Intent.ACTION_BATTERY_CHANGED).putExtra(BatteryManager.EXTRA_VOLTAGE, 3949))
        addSensors(gyro = false)
        val f = recorder.start()
        recorder.onThread { }   // the sticky broadcast is delivered on the recorder thread
        shadowOf(recorder.looperForTest()).idle()
        tickAt(11)
        assertEquals("3949", f.track.readLines()[1].split(',')[12])
    }

    @Test fun ticksComeOnTheirOwnOnceASecond() {
        addSensors(gyro = false)
        recorder = PhoneRecorder(context, dir, clock = { android.os.SystemClock.uptimeMillis() * 1_000_000 })
        val f = recorder.start()
        val looper = shadowOf(recorder.looperForTest())
        repeat(3) { looper.idleFor(java.time.Duration.ofMillis(1_000)) }
        assertEquals(4, f.track.readLines().size)   // header + three rows
    }

    @Test fun afterAStallTheMissedTicksAreSkippedNotQueued() {
        assertEquals(2_000L, PhoneRecorder.nextTickAfter(1_000L, 1_500L))
        assertEquals(5_000L, PhoneRecorder.nextTickAfter(1_000L, 4_200L))   // 2 s, 3 s and 4 s passed: one tick, at 5 s
        assertEquals(5_000L, PhoneRecorder.nextTickAfter(1_000L, 4_000L))
    }

    @Test fun stoppingTwiceIsHarmlessAndTheFilesAreClosed() {
        addSensors(gyro = false)
        recorder.start()
        val f = recorder.stop()!!
        assertNull(recorder.stop())
        assertTrue(f.track.exists())
        assertNull(recorder.live.value)
    }

    @Test fun aStartThatFailsUndoesItself() {
        addSensors()
        val notADir = File(dir, "taken").apply { writeText("") }   // the recordings folder can't be made
        val broken = PhoneRecorder(context, File(notADir, "recordings"), clock = { clockNs })
        assertThrows(java.io.IOException::class.java) { broken.start() }
        assertEquals(0, shadowOf(sensors).getListeners().size)   // the sensors registered first are let go
        assertNull(broken.current)
        broken.threadForTest().join(2_000)
        assertFalse(broken.threadForTest().isAlive)
        assertNull(broken.stop())
    }

    @Test fun twoRecordingsStartedInTheSameSecondGetTheirOwnFiles() {
        val first = RecordingFiles.create(dir, Instant.parse("2026-10-31T09:14:07Z"))
        val second = RecordingFiles.create(dir, Instant.parse("2026-10-31T09:14:07Z"))
        first.close(); second.close()
        assertEquals("track_20261031_091407.csv", first.track.name)
        assertEquals("track_20261031_091407_1.csv", second.track.name)
        assertEquals("track_20261031_091407_1_i10.csv", second.motion.name)
    }

    @Test fun aFixGoesInWithTheTimeItWasTaken() {
        addSensors()
        recorder.start()
        val l = Location(LocationManager.GPS_PROVIDER).apply {
            latitude = 51.46; longitude = -0.97; time = Instant.parse("2026-10-31T09:14:07Z").toEpochMilli()
            elapsedRealtimeNanos = 10_500_000_000L; speed = 2.3f; bearing = 45f
        }
        recorder.onThread { shadowOf(context.getSystemService(LocationManager::class.java)).simulateLocation(l) }
        hold(10, 12, Triple(0f, 0f, G), Triple(0f, 0f, 0f))
        tickAt(11)
        val row = recorder.stop()!!.track.readLines()[1].split(',')
        // Taken 0.5 s before the row: the row is the fix's time plus its age.
        assertEquals("2026-10-31T09:14:08Z", row[0])
        assertEquals(listOf("1", "51.4600000", "-0.9700000", "0.0", "8.28", "45.0"), row.subList(4, 10))
    }

    private fun rowWithFix(l: Location): List<String> {
        addSensors(gyro = false)
        val f = recorder.start()
        recorder.onThread { shadowOf(context.getSystemService(LocationManager::class.java)).simulateLocation(l) }
        tickAt(11)
        return f.track.readLines()[1].split(',')
    }

    private fun fix() = Location(LocationManager.GPS_PROVIDER).apply {
        latitude = 51.46; longitude = -0.97; time = Instant.parse("2026-10-31T09:14:07Z").toEpochMilli()
        elapsedRealtimeNanos = 11_000_000_000L
    }

    @Test @Config(sdk = [34]) fun theAltitudeIsAboveSeaLevel() {
        val row = rowWithFix(fix().apply { altitude = 100.0; mslAltitudeMeters = 52.3 })
        assertEquals("52.3", row[7])
    }

    // getAltitude() is above the ellipsoid (~47 m off in the UK): with no sea-level value, no altitude.
    @Test @Config(sdk = [34]) fun theEllipsoidHeightIsNeverUsed() {
        val row = rowWithFix(fix().apply { altitude = 100.0 })
        assertEquals("0.0", row[7])
    }

    @Test fun theLiveValuesCarryTheCoresGpsState() {
        addSensors(gyro = false)
        recorder.start()
        tickAt(10)
        assertEquals(false, recorder.live.value!!.fix)
        assertTrue(recorder.live.value!!.sinceFixS.isNaN())   // no fix yet
        recorder.onThread { shadowOf(context.getSystemService(LocationManager::class.java)).simulateLocation(fix()) }   // taken at 11 s
        tickAt(11)
        assertEquals(true, recorder.live.value!!.fix)
        assertEquals(0f, recorder.live.value!!.sinceFixS)
        tickAt(15)                                            // 4 s old: not a fix any more
        assertEquals(false, recorder.live.value!!.fix)
        assertEquals(4f, recorder.live.value!!.sinceFixS)
    }

    @Test fun theFilesAreNamedAsTheTrackersAre() {
        addSensors()
        val f = recorder.start()
        assertEquals("track_20261031_091407.csv", f.track.name)
        assertEquals("track_20261031_091407_i10.csv", f.motion.name)
        assertTrue(f.track.readText().startsWith("timestamp,ms,"))
    }
}
