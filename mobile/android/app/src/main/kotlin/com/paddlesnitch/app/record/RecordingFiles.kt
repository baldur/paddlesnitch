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
 * appended and flushed to the system as it comes, so a killed app keeps what
 * it had; [sync] (once a second) puts it on the flash against a power cut.
 * A failed write (storage full) is logged, never thrown into the recorder; from
 * then on lines are counted, not written, and the files keep what came before.
 */
class RecordingFiles(val track: File, val motion: File) : AutoCloseable {
    /** track_<stamp>.log: what the recording dropped, written when it finishes (not uploaded). */
    val log = File(track.path.removeSuffix(".csv") + ".log")

    private val trackOut = FileOutputStream(track, true)
    private val motionOut = FileOutputStream(motion, true)

    /** The core's write callback ([RecorderCore]'s `lines`). */
    fun write(stream: Int, line: ByteArray) {
        val out = when (stream) {
            RecorderCore.TRACK -> trackOut
            RecorderCore.MOTION -> motionOut
            else -> return   // RC_MOTION_RAW is never configured on a phone; RC_STROKE (phase 4) is ignored
        }
        // After the first failure nothing more is written (a half-written line followed by
        // good ones would be a broken row mid-file); each line from then on is counted (as iOS).
        if (failedLines > 0) { failedLines++; return }
        try {
            out.write(line)
            out.flush()
        } catch (e: java.io.IOException) {
            if (failedLines++ == 0) android.util.Log.w("RecordingFiles", "couldn't write ${track.name}", e)
        }
    }

    /** Lines not written: the one that failed (storage full, say) and every one after it. */
    var failedLines = 0
        private set

    /** Puts what's written on the flash (once a second, not per line: 14 a second wore it and stalled the thread). */
    fun sync() {
        runCatching { trackOut.fd.sync(); motionOut.fd.sync() }
    }

    /** Writes the drop counts beside the recording (recorder_phone.h: log them with the recording). */
    fun writeLog(droppedLate: Long, droppedUnpaired: Long) {
        // Never re-create a folder that deleting the account removed while this was stopping.
        if (log.parentFile?.isDirectory == true) runCatching { log.writeText("dropped_late,$droppedLate\ndropped_unpaired,$droppedUnpaired\nfailed_lines,$failedLines\n") }
    }

    override fun close() {
        sync()
        trackOut.close()
        motionOut.close()
    }

    companion object {
        /**
         * This account's recordings: one folder per account, so a later upload only
         * ever reads the signed-in account's paddles (the same as iOS, #767).
         */
        fun accountDir(base: File, userId: String): File =
            File(base, if (userId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) userId else sha256(userId))

        /** Deleting an account removes its recordings, in one go; other accounts' stay. */
        fun deleteAccount(base: File, userId: String) { accountDir(base, userId).deleteRecursively() }

        private fun sha256(s: String) = java.security.MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

        private val STAMP = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss").withZone(ZoneOffset.UTC)

        /** New files in [dir] for a recording started at [start]; never reuses a name. */
        fun create(dir: File, start: Instant): RecordingFiles {
            if (!dir.isDirectory && !dir.mkdirs()) throw java.io.IOException("couldn't make $dir")
            val stamp = STAMP.format(start)
            var base = "track_$stamp"
            var n = 1
            while (File(dir, "$base.csv").exists()) base = "track_${stamp}_${n++}"
            return RecordingFiles(File(dir, "$base.csv"), File(dir, "${base}_i10.csv"))
        }
    }
}
