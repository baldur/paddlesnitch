package com.paddlesnitch.app.record

import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * The two files a recording writes, named as the tracker names them
 * (track_<stamp>.csv and track_<stamp>_i10.csv, stamp = UTC start time), so the
 * server reads a phone recording as it reads a tracker's. Every line is
 * appended and flushed as it comes: a killed app keeps what it had.
 */
class RecordingFiles(val track: File, val motion: File) : AutoCloseable {
    private val trackOut = FileOutputStream(track, true)
    private val motionOut = FileOutputStream(motion, true)

    /** The core's write callback ([RecorderCore]'s `lines`). */
    fun write(stream: Int, line: ByteArray) {
        val out = when (stream) {
            RecorderCore.TRACK -> trackOut
            RecorderCore.MOTION -> motionOut
            else -> return   // RC_MOTION_RAW is never configured on a phone; RC_STROKE (phase 4) is ignored
        }
        out.write(line)
        out.flush()
        out.fd.sync()
    }

    override fun close() {
        trackOut.close()
        motionOut.close()
    }

    companion object {
        private val STAMP = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss").withZone(ZoneOffset.UTC)

        /** New files in [dir] for a recording started at [start]; never reuses a name. */
        fun create(dir: File, start: Instant): RecordingFiles {
            dir.mkdirs()
            val stamp = STAMP.format(start)
            var base = "track_$stamp"
            var n = 1
            while (File(dir, "$base.csv").exists()) base = "track_${stamp}_${n++}"
            return RecordingFiles(File(dir, "$base.csv"), File(dir, "${base}_i10.csv"))
        }
    }
}
