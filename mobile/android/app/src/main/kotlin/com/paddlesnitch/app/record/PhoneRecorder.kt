package com.paddlesnitch.app.record

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.GnssMeasurementRequest
import android.location.GnssMeasurementsEvent
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import androidx.annotation.RequiresApi
import com.paddlesnitch.app.BuildConfig
import java.io.File
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Records the phone as a tracker: accelerometer and gyroscope (about 50 Hz),
 * GPS (1 Hz) and a tick each second, all handed to the recorder core's phone
 * layer exactly as Android delivers them (recorder_phone.h). Every core call
 * happens on one HandlerThread; the core is not thread-safe and needs one
 * order of calls.
 *
 * The caller holds the partial wake lock and the foreground service
 * (RecordingService); without them the sensor FIFO is only emptied when the
 * screen wakes and rows are written without their samples.
 */
class PhoneRecorder(
    private val context: Context,
    private val dir: File,
    private val now: () -> Instant = Instant::now,
    private val clock: () -> Long = SystemClock::elapsedRealtimeNanos,   // ticks' t_ns (recorder_phone.h, CLOCK)
    /** Where the phone is, for the location-detail file's header. */
    private val placement: () -> Placement? = { Placement.load(context) },
    /** Off in every build but the experiment's: then none of the location detail happens. */
    private val gnssExperiment: Boolean = BuildConfig.GNSS_EXPERIMENT,
) {
    private val thread = HandlerThread("recorder").apply { start() }
    private val handler = Handler(thread.looper)
    private val sensors = context.getSystemService(SensorManager::class.java)
    private val locations = context.getSystemService(LocationManager::class.java)

    private var core: RecorderCore? = null
    private var files: RecordingFiles? = null
    private var battMv = 0
    private var nextTick = 0L

    private val _live = MutableStateFlow<RecorderCore.Live?>(null)
    /** The core's live values after each tick; null when not recording. */
    val live: StateFlow<RecorderCore.Live?> = _live

    /** Whether this recording has motion (both sensors delivering); false records GPS only. */
    @Volatile var motion = false
        private set

    /** The files being written, once started. */
    @Volatile var current: RecordingFiles? = null
        private set

    private val sensorListener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            val c = core ?: return
            val v = e.values
            when (e.sensor.type) {
                Sensor.TYPE_ACCELEROMETER -> c.accel(e.timestamp, v[0].toDouble(), v[1].toDouble(), v[2].toDouble())
                Sensor.TYPE_GYROSCOPE -> c.gyro(e.timestamp, v[0].toDouble(), v[1].toDouble(), v[2].toDouble())
            }
        }
        override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
    }

    private val locationListener = LocationListener { l ->
        core?.location(fixOf(l))
        detail { gnss?.fix("gps", l) }
    }

    // The location-detail experiment (GnssLog.kt). None of it feeds the core.
    private var gnss: GnssLog? = null
    private var measurements: GnssMeasurementsEvent.Callback? = null
    private val fusedListener = LocationListener { l -> detail { gnss?.fix("fused", l) } }
    private val skyCallback = object : GnssStatus.Callback() {
        override fun onSatelliteStatusChanged(s: GnssStatus) = detail { gnss?.sky(clock() / 1_000_000, skyOf(satsOf(s))) }
    }

    /** Full-tracking measurement events seen, for the tests: the callback has nothing else to do. */
    @Volatile internal var measurementEvents = 0
        private set

    /** Nothing in the experiment may stop or damage the recording. */
    private inline fun detail(work: () -> Unit) {
        try { work() } catch (e: Exception) { Log.w(TAG, "location detail failed", e) }
    }

    private val battery = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { battMv = i.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0).coerceAtLeast(0) }
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!tickNow()) return
            nextTick = nextTickAfter(nextTick, SystemClock.uptimeMillis())
            handler.postAtTime(this, nextTick)
        }
    }

    internal fun looperForTest() = thread.looper
    internal fun threadForTest(): Thread = thread
    internal fun gnssLogForTest() = gnss

    /** This second's row. On the recorder thread only. */
    internal fun tickNow(): Boolean {
        val c = core ?: return false
        c.tick(clock(), battMv)
        files?.sync()
        detail { gnss?.sync() }
        // No motion sensors: no trace (the core would read the missing samples as a fault).
        _live.value = c.live().let { if (motion) it.copy(trace = c.trace()) else it }
        logDrops(c, false)
        return true
    }

    /**
     * Starts recording; returns once the files exist and the headers are written.
     * If anything fails part way, everything started so far is undone and the
     * recorder is finished with: make a new one to try again.
     */
    @SuppressLint("MissingPermission")   // RecordingService starts only with location permission
    fun start(): RecordingFiles = try {
        onThread {
            check(core == null) { "already recording" }
            val accel = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            val gyro = sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
            // Motion only with both sensors really delivering; otherwise track only,
            // or rows would wait for a gyroscope that never comes. Events before the
            // core exists are ignored (core is null).
            val motion = accel != null && gyro != null &&
                sensors.registerListener(sensorListener, accel, SAMPLE_US, MAX_LATENCY_US, handler) &&
                sensors.registerListener(sensorListener, gyro, SAMPLE_US, MAX_LATENCY_US, handler)
            if (!motion) sensors.unregisterListener(sensorListener)
            this.motion = motion
            val f = RecordingFiles.create(dir, now())
            files = f
            core = RecorderCore(has = RecorderCore.HAS_BATT_MV, motion = motion, lines = f::write)
            context.registerReceiver(battery, IntentFilter(Intent.ACTION_BATTERY_CHANGED), null, handler)
            locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, locationListener, thread.looper)
            if (gnssExperiment) startDetail(f)
            nextTick = SystemClock.uptimeMillis() + 1000
            handler.postAtTime(tick, nextTick)
            current = f
            Log.i(TAG, "recording ${f.track.name}, motion=$motion")
            f
        }
    } catch (e: Exception) {
        runCatching { stop() }
        throw e
    }

    /** Stops: writes everything still held, closes the files and ends the thread. Safe to call again. */
    fun stop(): RecordingFiles? = if (finished) null else try {
        onThread {
            val c = core
            val f = files
            handler.removeCallbacks(tick)
            sensors.unregisterListener(sensorListener)
            locations.removeUpdates(locationListener)
            if (gnssExperiment) stopDetail()
            runCatching { context.unregisterReceiver(battery) }
            try {
                c?.finish()
                c?.let { logDrops(it, true); f?.writeLog(it.droppedLate, it.droppedUnpaired) }
            } finally {
                c?.close()
                f?.close()
                core = null
                files = null
                current = null
                _live.value = null
            }
            f
        }
    } finally {
        finished = true
        thread.quitSafely()
    }

    @Volatile private var finished = false

    /** Opens the location-detail file and starts its sources. On the recorder thread, after the fixes are asked for. */
    @SuppressLint("MissingPermission")   // as start()
    private fun startDetail(f: RecordingFiles) {
        var full = false
        detail { if (Build.VERSION.SDK_INT >= 31 && nextFullTracking(dir)) full = startFullTracking() }
        detail { gnss = GnssLog(f.gnss, placement()?.wire ?: Placement.NOT_SET, full, Build.VERSION.SDK_INT) }
        if (gnss == null) { stopDetail(); return }
        detail { locations.registerGnssStatusCallback(skyCallback, handler) }
        detail {
            if (Build.VERSION.SDK_INT >= 31 && locations.hasProvider(LocationManager.FUSED_PROVIDER))
                // High accuracy, as GPS_PROVIDER runs: the plain call would ask for BALANCED here.
                locations.requestLocationUpdates(LocationManager.FUSED_PROVIDER, fusedRequest(), Executor { handler.post(it) }, fusedListener)
        }
    }

    /** True if Android took the request. The callback's only job is to hold full tracking on. */
    @RequiresApi(31)
    @SuppressLint("MissingPermission")
    private fun startFullTracking(): Boolean {
        val callback = object : GnssMeasurementsEvent.Callback() {
            override fun onGnssMeasurementsReceived(event: GnssMeasurementsEvent) { measurementEvents++ }
        }
        val taken = locations.registerGnssMeasurementsCallback(fullTrackingRequest(), Executor { handler.post(it) }, callback)
        if (taken) measurements = callback
        return taken
    }

    private fun stopDetail() {
        detail { locations.unregisterGnssStatusCallback(skyCallback) }
        detail { locations.removeUpdates(fusedListener) }
        detail { measurements?.let { locations.unregisterGnssMeasurementsCallback(it) } }
        measurements = null
        detail { gnss?.close() }
        gnss = null
    }

    private var lastDrops = 0L to 0L
    private fun logDrops(c: RecorderCore, end: Boolean) {
        val drops = c.droppedLate to c.droppedUnpaired
        if (end || drops != lastDrops) Log.i(TAG, "dropped late ${drops.first}, unpaired ${drops.second}${if (end) " (final)" else ""}")
        lastDrops = drops
    }

    internal fun <T> onThread(work: () -> T): T {
        if (Thread.currentThread() == thread) return work()
        var result: Result<T>? = null
        val done = CountDownLatch(1)
        check(handler.post { result = runCatching(work); done.countDown() }) { "recorder stopped" }
        check(done.await(10, TimeUnit.SECONDS)) { "recorder thread stuck" }
        return result!!.getOrThrow()
    }

    companion object {
        private const val TAG = "PhoneRecorder"
        const val SAMPLE_US = 20_000          // ~50 Hz (recorder_phone.h, SAMPLE RATE)
        const val MAX_LATENCY_US = 2_000_000  // batches at most 2 s late; the layer holds 15 s

        @RequiresApi(31) internal fun fusedRequest(): LocationRequest = LocationRequest.Builder(1000L).setQuality(LocationRequest.QUALITY_HIGH_ACCURACY).build()

        @RequiresApi(31) internal fun fullTrackingRequest(): GnssMeasurementRequest = GnssMeasurementRequest.Builder().setFullTracking(true).build()

        /**
         * When the tick after one due at [due] goes, with the clock at [now] (both
         * uptime ms): the next whole second from the start, skipping any a stall
         * missed, so ticks never queue up behind each other.
         */
        fun nextTickAfter(due: Long, now: Long): Long {
            var next = due + 1000
            while (next <= now) next += 1000
            return next
        }

        /** A Location as the core takes it: taken-at on the monotonic clock, and only the fields Android gave. */
        fun fixOf(l: Location) = RecorderCore.Fix(
            tNs = l.elapsedRealtimeNanos,
            utcMs = l.time,
            lat = l.latitude,
            lon = l.longitude,
            // Above sea level, as the tracker's GGA (recorder_phone.h). getAltitude() is above
            // the WGS84 ellipsoid, ~47 m off in the UK: never mixed in, so no MSL = no altitude.
            alt = if (Build.VERSION.SDK_INT >= 34 && l.hasMslAltitude()) l.mslAltitudeMeters else null,
            speedMs = if (l.hasSpeed()) l.speed.toDouble() else null,
            courseDeg = if (l.hasBearing()) l.bearing.toDouble() else null,
        )
    }
}
