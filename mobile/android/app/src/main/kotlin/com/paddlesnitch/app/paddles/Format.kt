package com.paddlesnitch.app.paddles

import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.roundToLong

// How the website writes numbers and dates (packages/core/src/format.ts and
// packages/analysis/src/analysis.ts), so the app reads the same. Dates are UTC
// with fixed English names, as on the website.

private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
private val WEEKDAYS = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

private fun utc(value: String) = runCatching { OffsetDateTime.parse(value).withOffsetSameInstant(ZoneOffset.UTC) }.getOrNull()

/** An ISO timestamp → "Sun, 13 Sep 2026". Unparseable → as given. */
fun fmtWeekday(value: String): String = utc(value)?.let {
    "${WEEKDAYS[it.dayOfWeek.value - 1]}, ${it.dayOfMonth} ${MONTHS[it.monthValue - 1]} ${it.year}"
} ?: value

/** An ISO timestamp → "Sep 2026". Unparseable → as given. */
fun fmtMonth(value: String): String = utc(value)?.let { "${MONTHS[it.monthValue - 1]} ${it.year}" } ?: value

/** Seconds → "m:ss", rounded first (119.6 → "2:00", never "1:60"). */
fun fmtDur(s: Double): String {
    val r = s.roundToLong()
    return "${r / 60}:${(r % 60).toString().padStart(2, '0')}"
}

/** Seconds → "m:ss", or "h:mm:ss" from an hour. */
fun fmtClock(s: Double): String {
    val t = s.roundToLong()
    val h = t / 3600; val m = (t % 3600) / 60; val sec = (t % 60).toString().padStart(2, '0')
    return if (h > 0) "$h:${m.toString().padStart(2, '0')}:$sec" else "$m:$sec"
}

/** Pace per 500 m from a speed in m/s; "—" when barely moving. */
fun split500(speed: Double): String = if (speed > 0.2) fmtDur(500 / speed) else "—"

/** A paddle's distance as shown: "—" for a paddle without a map, never "0 km". */
fun paddleKm(distanceKm: Double, noGps: Boolean): String =
    if (noGps) "—" else String.format(Locale.US, "%.2f km", distanceKm)

/** Kilometres with one decimal, as the logbook writes them ("6.3", "0"). */
fun km1(km: Double): String = if (km % 1.0 == 0.0) km.toLong().toString() else String.format(Locale.US, "%.1f", km)

/** Where a paddle came from, for its row: null for a plain file. */
fun sourceLabel(type: String): String? = mapOf("strava" to "Strava", "trial" to "Time trial", "device" to "Tracker")[type]

/** "Also recorded by …" for the same outing from another source. */
fun alsoRecordedBy(type: String): String =
    "Also recorded by " + (mapOf("strava" to "Strava", "trial" to "a time trial", "device" to "the tracker")[type] ?: "a file")
