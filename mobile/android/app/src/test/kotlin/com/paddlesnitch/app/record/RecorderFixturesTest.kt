package com.paddlesnitch.app.record

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// Every phone case in recorder-core/fixtures replayed through the app's own
// binding (RecorderCore over recorder_jni.c) and file writer: both files must
// match byte for byte, and each `expect` line's drop counts must hold
// (recorder-core/fixtures/README.md).
class RecorderFixturesTest {
    private val fixtures = File("../../../recorder-core/fixtures")
    private val cases = fixtures.listFiles { f -> f.isDirectory && f.name.startsWith("phone_") }!!.sortedBy { it.name }

    @Test fun everyPhoneFixtureIsReplayed() = assertTrue("found ${cases.size}", cases.size >= 8)

    @Test fun everyPhoneFixtureWritesTheSameFiles() {
        val failures = cases.mapNotNull { dir ->
            runCatching { replay(dir) }.exceptionOrNull()?.let { "${dir.name}: ${it.message}" }
        }
        assertEquals(emptyList<String>(), failures)
    }

    private fun replay(dir: File) {
        val out = Files.createTempDirectory("rec").toFile()
        val files = RecordingFiles(File(out, "track.csv"), File(out, "motion.csv"))
        var core: RecorderCore? = null
        try {
            dir.resolve("phone.csv").readLines().forEachIndexed { i, raw ->
                if (raw.isEmpty() || raw.startsWith("#")) return@forEachIndexed
                val f = raw.split(',')
                val c = core
                when {
                    f[0] == "phone" -> core = RecorderCore(
                        has = f[2].split(' ').filter { it.isNotEmpty() }.fold(0) { acc, w -> acc or flag(w) },
                        motion = f[3] == "1",
                        platform = if (f[1] == "ios") RecorderCore.IOS else RecorderCore.ANDROID,
                        lines = files::write,
                    )
                    c == null -> error("line ${i + 1}: the first call must be phone")
                    f[0] == "accel" -> c.accel(f[1].toLong(), f[2].toDouble(), f[3].toDouble(), f[4].toDouble())
                    f[0] == "gyro" -> c.gyro(f[1].toLong(), f[2].toDouble(), f[3].toDouble(), f[4].toDouble())
                    f[0] == "location" -> c.location(RecorderCore.Fix(f[1].toLong(), f[2].toLong(), f[3].toDouble(), f[4].toDouble(),
                        f[5].toDoubleOrNull(), f[6].toDoubleOrNull(), f[7].toDoubleOrNull()))
                    f[0] == "tick" -> c.tick(f[1].toLong(), f[2].toInt())
                    f[0] == "finish" -> c.finish()
                    f[0] == "expect" -> assertEquals("line ${i + 1}: dropped late, unpaired",
                        "${f[2]},${f[4]}", "${c.droppedLate},${c.droppedUnpaired}")
                    else -> error("line ${i + 1}: can't read $raw")
                }
            }
        } finally {
            core?.close()
            files.close()
        }
        assertArrayEquals("track.csv", dir.resolve("track.csv").readBytes(), files.track.readBytes())
        assertArrayEquals("motion.csv", dir.resolve("motion.csv").readBytes(), files.motion.readBytes())
        out.deleteRecursively()
    }

    private fun flag(word: String) = when (word) {
        "sats" -> 1 shl 0
        "hdop" -> 1 shl 1
        "batt_mv" -> 1 shl 2
        "tx_seq" -> 1 shl 3
        "imu_temp" -> 1 shl 4
        "raw_motion" -> 1 shl 5
        else -> error("flag $word?")
    }
}
