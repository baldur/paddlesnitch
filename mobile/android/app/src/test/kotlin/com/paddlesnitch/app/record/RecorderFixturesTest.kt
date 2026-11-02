package com.paddlesnitch.app.record

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// Every phone case in recorder-core/fixtures replayed through the app's own
// binding (RecorderCore over recorder_jni.c) and file writer: both files must
// match byte for byte, each `expect` line's drop counts must hold, and a case
// that calls `trace` must write its trace.csv (recorder-core/fixtures/README.md).
class RecorderFixturesTest {
    private val fixtures = File("../../../recorder-core/fixtures")
    private val cases = fixtures.listFiles { f -> f.isDirectory && (f.name.startsWith("phone_") || f.name.startsWith(TRACE_PREFIX)) }!!
        .sortedBy { it.name }
    private val traceCases = cases.filter { it.name.startsWith(TRACE_PREFIX) }

    @Test fun everyPhoneFixtureIsReplayed() = assertTrue("found ${cases.size}", cases.size - traceCases.size >= 8)

    // The contract: the runner fails if it finds no trace_phone_ case (a count of all cases would pass without them).
    @Test fun everyTraceFixtureIsReplayedAndHasItsTrace() {
        assertTrue("found ${traceCases.map { it.name }}", traceCases.size >= 2)
        traceCases.forEach { assertTrue("${it.name}/trace.csv", it.resolve("trace.csv").isFile) }
    }

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
        val trace = StringBuilder()
        val stroke = java.io.ByteArrayOutputStream()   // RC_STROKE: the app keeps no file of it
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
                        lines = { stream, line -> if (stream == STROKE) stroke.write(line) else files.write(stream, line) },
                    )
                    c == null -> error("line ${i + 1}: the first call must be phone")
                    f[0] == "accel" -> c.accel(f[1].toLong(), f[2].toDouble(), f[3].toDouble(), f[4].toDouble())
                    f[0] == "gyro" -> c.gyro(f[1].toLong(), f[2].toDouble(), f[3].toDouble(), f[4].toDouble())
                    f[0] == "location" -> c.location(RecorderCore.Fix(f[1].toLong(), f[2].toLong(), f[3].toDouble(), f[4].toDouble(),
                        f[5].toDoubleOrNull(), f[6].toDoubleOrNull(), f[7].toDoubleOrNull()))
                    f[0] == "tick" -> c.tick(f[1].toLong(), f[2].toInt())
                    f[0] == "trace" -> trace.append(traceLines(c.trace()))
                    f[0] == "finish" -> c.finish()
                    f[0] == "expect_session" -> expectSession(f, String(stroke.toByteArray()), i + 1)
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
        assertArrayEquals("stroke.csv", dir.resolve("stroke.csv").readBytes(), stroke.toByteArray())
        val expected = dir.resolve("trace.csv")
        if (expected.isFile || trace.isNotEmpty()) assertEquals("trace.csv", expected.readText(), trace.toString())
        out.deleteRecursively()
    }

    // run_fixtures.c's expect_stroke: `expect_session,<set>,<min>,<max>` or `<set>,none`.
    private fun expectSession(f: List<String>, stroke: String, line: Int) {
        val v = stroke.lines().firstOrNull { it.startsWith("session,${f[1]},") }?.split(',') ?: error("line $line: no session line for ${f[1]}")
        val ok = v.size >= 6 && v[2] == "1"
        if (f[2] == "none") { assertTrue("line $line: wanted no ${f[1]} stroke rate, got $v", !ok); return }
        assertTrue("line $line: ${f[1]} stroke rate ${v.getOrNull(5)} (want ${f[2]}-${f[3]})", ok && v[5].toDouble() in f[2].toDouble()..f[3].toDouble())
    }

    // The screen tests draw these: the helper must give the same traces the runner checks.
    @Test fun theScreenTestsTracesAreTheFixtures() = traceCases.forEach {
        assertEquals(it.name, it.resolve("trace.csv").readText(), fixtureTraces(it.name).joinToString("") { t -> traceLines(t) })
    }

    @Test fun twoDecimalsAreCsOwn() {
        // C rounds the float's exact value, half to even, and keeps the sign of a negative that rounds to 0.
        assertEquals(listOf("0.12", "0.38", "1.00", "-0.00", "-0.00", "0.00", "38.76", "-4.33"),
            listOf(0.125f, 0.375f, 1.005f, -0.001f, -0f, 0f, 38.76f, -4.33f).map(::twoDecimals))
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

private const val TRACE_PREFIX = "trace_phone_"
private const val STROKE = 3   // rc_stream RC_STROKE

/** What run_fixtures.c's put_trace writes: `trace,<status>,<axis>,<n>,<scale>`, then `<ago_ms>,<dps>` per sample. */
internal fun traceLines(t: RecorderCore.Trace): String = buildString {
    append("trace,${t.status.name.lowercase()},${if (t.axis < 0) '-' else "xyz"[t.axis]},${t.n},${twoDecimals(t.scaleDps)}\n")
    for (i in 0 until t.n) append("${t.agoMs[i]},${twoDecimals(t.dps[i])}\n")
}

/** printf's "%.2f" of a float: its exact binary value rounded half to even, "-0.00" for a negative that rounds to 0. */
internal fun twoDecimals(f: Float): String {
    val v = java.math.BigDecimal(f.toDouble()).setScale(2, java.math.RoundingMode.HALF_EVEN)
    val s = v.abs().toPlainString()
    return if (1f / f < 0f || f < 0f) "-$s" else s
}

/**
 * Every trace a `trace_phone_` fixture takes, in order: the core's own output for a screen
 * test to draw, rather than samples made up for it.
 */
internal fun fixtureTraces(case: String): List<RecorderCore.Trace> {
    val traces = mutableListOf<RecorderCore.Trace>()
    var core: RecorderCore? = null
    try {
        File("../../../recorder-core/fixtures/$case/phone.csv").readLines().forEach { raw ->
            val f = raw.split(',')
            when (f[0]) {
                "phone" -> core = RecorderCore(has = 0, motion = f[3] == "1", lines = { _, _ -> })
                "accel" -> core!!.accel(f[1].toLong(), f[2].toDouble(), f[3].toDouble(), f[4].toDouble())
                "gyro" -> core!!.gyro(f[1].toLong(), f[2].toDouble(), f[3].toDouble(), f[4].toDouble())
                "location" -> core!!.location(RecorderCore.Fix(f[1].toLong(), f[2].toLong(), f[3].toDouble(), f[4].toDouble(),
                    f[5].toDoubleOrNull(), f[6].toDoubleOrNull(), f[7].toDoubleOrNull()))
                "tick" -> core!!.tick(f[1].toLong(), f[2].toInt())
                "trace" -> traces += core!!.trace()
            }
        }
    } finally { core?.close() }
    return traces
}
