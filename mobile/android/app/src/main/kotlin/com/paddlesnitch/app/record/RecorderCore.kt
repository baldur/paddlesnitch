package com.paddlesnitch.app.record

import androidx.annotation.Keep

/**
 * The shared recorder core's phone layer (recorder-core/include/recorder_phone.h),
 * through src/main/cpp/recorder_jni.c. Pass events exactly as Android delivers
 * them: SensorEvent values in m/s² and rad/s, SensorEvent.timestamp,
 * Location.elapsedRealtimeNanos. The layer converts units, orders the events and
 * decides what each line says; this class only carries them across.
 *
 * Not thread-safe by design: every call must come from the one recording
 * thread, and [lines] is called on it, during the call that wrote the line.
 */
class RecorderCore(has: Int, motion: Boolean, platform: Int = ANDROID, private val lines: (stream: Int, line: ByteArray) -> Unit) : AutoCloseable {
    private var handle = 0L

    init {
        loadLibrary()
        handle = nativeInit(platform, has, motion)
        check(handle != 0L) { "recorder core didn't start" }
    }

    fun accel(tNs: Long, x: Double, y: Double, z: Double) = nativeAccel(open(), tNs, x, y, z)
    fun gyro(tNs: Long, x: Double, y: Double, z: Double) = nativeGyro(open(), tNs, x, y, z)
    fun location(fix: Fix) = with(fix) {
        nativeLocation(open(), tNs, utcMs, lat, lon, alt != null, alt ?: 0.0, speedMs != null, speedMs ?: 0.0, courseDeg != null, courseDeg ?: 0.0)
    }
    fun tick(tNs: Long, battMv: Int) = nativeTick(open(), tNs, battMv)
    fun finish() = nativeFinish(open())
    fun live(): Live = FloatArray(8).also { nativeLive(open(), it) }.let { Live(it[0], it[1], it[2], it[3], it[4], it[5], it[6] != 0f, it[7]) }
    val droppedLate: Long get() = nativeDroppedLate(open())
    val droppedUnpaired: Long get() = nativeDroppedUnpaired(open())

    override fun close() {
        if (handle != 0L) nativeFree(handle)
        handle = 0L
    }

    private fun open() = handle.also { check(it != 0L) { "recorder core closed" } }

    // Called from C for every line the core writes (headers included), ending in '\n'.
    @Keep @Suppress("unused") private fun line(stream: Int, bytes: ByteArray) = lines(stream, bytes)

    private external fun nativeInit(platform: Int, has: Int, motion: Boolean): Long
    private external fun nativeAccel(h: Long, t: Long, x: Double, y: Double, z: Double)
    private external fun nativeGyro(h: Long, t: Long, x: Double, y: Double, z: Double)
    private external fun nativeLocation(h: Long, t: Long, utc: Long, lat: Double, lon: Double, altValid: Boolean, alt: Double,
                                        speedValid: Boolean, speed: Double, courseValid: Boolean, course: Double)
    private external fun nativeTick(h: Long, t: Long, battMv: Int)
    private external fun nativeFinish(h: Long)
    private external fun nativeLive(h: Long, out: FloatArray)
    private external fun nativeDroppedLate(h: Long): Long
    private external fun nativeDroppedUnpaired(h: Long): Long
    private external fun nativeFree(h: Long)

    /** A location as the platform gave it; null = the platform didn't give that field. */
    data class Fix(val tNs: Long, val utcMs: Long, val lat: Double, val lon: Double, val alt: Double?, val speedMs: Double?, val courseDeg: Double?)

    /**
     * The core's live values; NaN = not ready (show "—"). [fix]: the latest tick's row has a
     * GPS fix; [sinceFixS]: seconds since the last one (0 with a fix, NaN before the first).
     */
    data class Live(
        val spm: Float, val rollDeg: Float, val pitchDeg: Float, val evennessPct: Float, val speedKmh: Float, val distanceM: Float,
        val fix: Boolean = false, val sinceFixS: Float = Float.NaN,
    )

    companion object {
        // recorder_phone.h: rc_platform, rc_stream and the RC_HAS_* bits.
        const val ANDROID = 1
        const val IOS = 2
        const val TRACK = 0
        const val MOTION = 1
        const val HAS_SATS = 1 shl 0
        const val HAS_BATT_MV = 1 shl 2

        @Volatile private var loaded = false
        private fun loadLibrary() {
            if (loaded) return
            // The unit tests build the library for the host and say where it is. The JVM
            // lets one file load in one classloader only, and Robolectric's sandbox is
            // another, so each loads its own copy.
            val host = System.getProperty("paddlesnitch.recorder.lib")
            if (host != null) {
                val copy = java.io.File.createTempFile("librecorder", java.io.File(host).name).apply { deleteOnExit() }
                java.io.File(host).copyTo(copy, overwrite = true)
                System.load(copy.path)
            } else System.loadLibrary("recorder")
            loaded = true
        }
    }
}
