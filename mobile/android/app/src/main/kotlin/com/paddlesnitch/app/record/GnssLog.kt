package com.paddlesnitch.app.record

import android.content.Context
import android.location.GnssStatus
import android.location.Location
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.Locale

/**
 * The location-detail experiment (mobile/contract/README.md § The location-detail file): what
 * Android knows about each fix, to find out why phones over-read distance. Nothing on screen reads
 * it. Only a build made with -PgnssExperiment=true does any of this (BuildConfig.GNSS_EXPERIMENT).
 * Remove it, and everything it touches, when the experiment ends.
 */

/** Where the phone was, chosen on the Record screen. [wire] goes in the file's header. */
enum class Placement(val wire: String, val label: String) {
    DECK("deck", "On deck"), POCKET("pocket", "In a pocket"), DRY_BAG("dry_bag", "In a dry bag"), BODY("body", "Strapped on");

    companion object {
        /** No choice yet. */
        const val NOT_SET = "not_set"
        private const val PREFS = "recording"
        private const val KEY = "placement"

        fun load(context: Context): Placement? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
            ?.let { saved -> entries.firstOrNull { it.wire == saved } }

        fun save(context: Context, p: Placement) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, p.wire).apply()
        }
    }
}

/** One satellite as GnssStatus gives it. [carrierHz]: null when Android doesn't have it. */
data class Sat(val used: Boolean, val cn0: Float, val carrierHz: Float?)

/** One `sky` row. A null is an empty cell: no satellites used, or no carrier frequencies. */
data class Sky(val used: Int, val view: Int, val cn0Mean: Double?, val cn0Top4: Double?, val dualFreq: Boolean?)

fun satsOf(s: GnssStatus): List<Sat> = List(s.satelliteCount) { i ->
    Sat(s.usedInFix(i), s.getCn0DbHz(i), if (s.hasCarrierFrequencyHz(i)) s.getCarrierFrequencyHz(i) else null)
}

// GPS and Galileo L1/E1 are at 1575.42 MHz, but BeiDou B1I is at 1561.1 and GLONASS L1 at 1598-1606:
// all L1 band. L5, E5, L2 and B2 are below 1300 MHz.
private val L1_BAND_HZ = 1.559e9f..1.610e9f

fun skyOf(sats: List<Sat>): Sky {
    val used = sats.filter { it.used }
    val cn0 = used.map { it.cn0.toDouble() }
    val carriers = used.mapNotNull { it.carrierHz }
    return Sky(
        used = used.size,
        view = sats.size,
        cn0Mean = cn0.takeIf { it.isNotEmpty() }?.average(),
        cn0Top4 = cn0.takeIf { it.isNotEmpty() }?.sortedDescending()?.take(4)?.average(),
        dualFreq = carriers.takeIf { it.isNotEmpty() }?.any { it !in L1_BAND_HZ },
    )
}

/**
 * Full tracking on alternate recordings, the first one on. [dir]'s file holds what the last
 * recording asked for, so the turn goes with the account and survives the process.
 */
internal fun nextFullTracking(dir: File): Boolean {
    val note = File(dir, "gnss-full-tracking")
    val on = runCatching { note.readText().trim() != "1" }.getOrDefault(true)
    runCatching { note.writeText(if (on) "1" else "0") }
    return on
}

/**
 * Writes one `_gnss.csv`, every line as one write, so a killed app leaves whole rows. A failed
 * write (storage full) is logged once, and nothing more is written: never thrown into the
 * recorder. Called on the recorder thread only.
 */
internal class GnssLog(file: File, placement: String, fullTracking: Boolean, sdk: Int) : AutoCloseable {
    private val out = FileOutputStream(file, true)
    private var failed = false
    private var lastSkyMs: Long? = null

    init {
        line("# placement=$placement")
        line("# full_tracking=${if (fullTracking) 1 else 0}")
        line("# sdk=$sdk")
        line(COLUMNS.joinToString(","))
    }

    /** A `gps` or `fused` row for [l], with an empty cell for anything Android didn't give. */
    fun fix(kind: String, l: Location) = row(
        kind, l.time.toString(), (l.elapsedRealtimeNanos / 1_000_000).toString(),
        n(l.latitude, 7), n(l.longitude, 7),
        if (l.hasAltitude()) n(l.altitude, 1) else "",
        if (l.hasAccuracy()) n(l.accuracy, 1) else "",
        if (l.hasVerticalAccuracy()) n(l.verticalAccuracyMeters, 1) else "",
        if (l.hasSpeed()) n(l.speed, 2) else "",
        if (l.hasSpeedAccuracy()) n(l.speedAccuracyMetersPerSecond, 2) else "",
        if (l.hasBearing()) n(l.bearing, 1) else "",
        if (l.hasBearingAccuracy()) n(l.bearingAccuracyDegrees, 1) else "",
    )

    /** A `sky` row, at most about one a second (the callback's own rate varies by phone). */
    fun sky(rtMs: Long, s: Sky) {
        lastSkyMs?.let { if (rtMs - it < SKY_GAP_MS) return }
        lastSkyMs = rtMs
        row("sky", "", rtMs.toString(), "", "", "", "", "", "", "", "", "",
            s.used.toString(), s.view.toString(), s.cn0Mean?.let { n(it, 1) }.orEmpty(), s.cn0Top4?.let { n(it, 1) }.orEmpty(),
            s.dualFreq?.let { if (it) "1" else "0" }.orEmpty())
    }

    private fun row(vararg cells: String) = line(cells.toList().plus(List(COLUMNS.size - cells.size) { "" }).joinToString(","))

    private fun n(v: Number, decimals: Int): String =
        v.toDouble().takeIf { it.isFinite() }?.let { String.format(Locale.ROOT, "%.${decimals}f", it) }.orEmpty()

    private fun line(s: String) {
        if (failed) return
        try { out.write("$s\n".toByteArray()) } catch (e: IOException) { failed = true; Log.w(TAG, "couldn't write the location detail", e) }
    }

    /** Puts what's written on the flash (once a second, with the track). */
    fun sync() { runCatching { out.fd.sync() } }

    override fun close() {
        sync()
        out.close()
    }

    companion object {
        private const val TAG = "GnssLog"
        // A callback a few ms early still counts as the next second.
        private const val SKY_GAP_MS = 900L
        val COLUMNS = listOf("kind", "utc_ms", "rt_ms", "lat", "lon", "alt_m", "h_acc_m", "v_acc_m", "speed_ms", "speed_acc_ms",
            "course_deg", "course_acc_deg", "sats_used", "sats_view", "cn0_mean", "cn0_top4", "dual_freq")
    }
}
