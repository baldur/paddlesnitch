package com.paddlesnitch.app.paddles

import com.paddlesnitch.app.api.NoPaddleReason
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.OffsetDateTime
import java.time.ZoneOffset
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

/** An ISO timestamp or date → "13 Sep 2026" (UTC); none → "never". Unparseable → as given. */
fun fmtDay(value: String?): String {
    if (value == null) return "never"
    return utc(if (value.length == 10) "${value}T00:00:00Z" else value)?.let { "${it.dayOfMonth} ${MONTHS[it.monthValue - 1]} ${it.year}" } ?: value
}

/** An ISO timestamp → "13 Sep 2026, 09:11" in the phone's time zone (the website's fmtDayTime). */
fun fmtDayTime(value: String, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String =
    runCatching { OffsetDateTime.parse(value).atZoneSameInstant(zone) }.getOrNull()?.let {
        "${it.dayOfMonth} ${MONTHS[it.monthValue - 1]} ${it.year}, ${it.hour.toString().padStart(2, '0')}:${it.minute.toString().padStart(2, '0')}"
    } ?: value

/** A tracker's distance as the website's devices pages write it: "8.24 km", or "640 m" under a kilometre; none → "—". */
fun fmtDist(m: Double?): String = when {
    m == null -> "—"
    m >= 1000 -> "${toFixed(m / 1000, 2)} km"
    else -> "${Math.round(m)} m"
}

/** "42s ago", "3m ago", "5h ago", "2d ago": when a tracker was last heard from (the website's fmtAgo). */
fun fmtAgo(value: String?, nowMs: Long = System.currentTimeMillis()): String {
    val t = value?.let { runCatching { OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() } ?: return "never"
    val s = maxOf(0L, (nowMs - t) / 1000)
    if (s < 90) return "${s}s ago"
    val m = s / 60
    if (m < 90) return "${m}m ago"
    val h = m / 60
    return if (h < 48) "${h}h ago" else "${h / 24}d ago"
}

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

/**
 * JavaScript's toFixed: rounds the double's exact binary value, so 1.005
 * (really 1.00499…) gives "1.00". String.format rounds the shortest decimal
 * ("1.005") and would give "1.01".
 */
fun toFixed(x: Double, digits: Int): String = BigDecimal(x).setScale(digits, RoundingMode.HALF_UP).toPlainString()

/** A paddle's distance as shown: "—" for a paddle without a map, never "0 km". */
fun paddleKm(distanceKm: Double, noGps: Boolean): String =
    if (noGps) "—" else "${toFixed(distanceKm, 2)} km"

private val COMPASS = listOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")

/** Degrees the wind blows from → one of 8 compass points (22.4 → N, 22.6 → NE). */
fun compassPoint(deg: Double): String = COMPASS[((((deg % 360) + 360) % 360) / 45).roundToLong().toInt() % 8]

private fun plural(n: Long, unit: String) = "$n $unit${if (n == 1L) "" else "s"}"
private fun span(s: Double) = when {
    s < 90 -> plural(maxOf(1L, s.roundToLong()), "second")
    s < 5400 -> "${(s / 60).roundToLong()} minutes"
    else -> "${toFixed(s / 3600, 1)} hours"
}

/** Why a recording has no route, as the website says it. `hasMotion`: the boat motion was recorded. */
fun noPaddleMessage(reason: NoPaddleReason, hasMotion: Boolean): String {
    val motion = if (hasMotion) " The boat motion was." else ""
    return when (reason) {
        is NoPaddleReason.NoGps -> "The GPS never found the sky, so no route was recorded.$motion"
        is NoPaddleReason.GpsLost -> "The GPS lost the sky ${span(reason.lostAfterS)} after you set off, so no route was recorded after that.$motion"
        is NoPaddleReason.TooShort -> "Too short to be a paddle: the boat moved ${num(reason.movedM)} m, and a paddle needs ${num(reason.minM)} m."
        is NoPaddleReason.Unknown -> "No route was recorded.$motion"
    }
}

/** A number as JavaScript prints it in a template: 12.0 → "12", 12.5 → "12.5". */
internal fun num(x: Double) = if (x % 1.0 == 0.0) x.toLong().toString() else x.toString()

/** Kilometres with one decimal, as the logbook writes them ("6.3", "0"). */
fun km1(km: Double): String = if (km % 1.0 == 0.0) km.toLong().toString() else toFixed(km, 1)

/** Where a paddle came from, for its row: null for a plain file. */
fun sourceLabel(type: String): String? = mapOf("strava" to "Strava", "trial" to "Time trial", "device" to "Tracker")[type]

/** "Also recorded by …" for the same outing from another source. */
fun alsoRecordedBy(type: String): String =
    "Also recorded by " + (mapOf("strava" to "Strava", "trial" to "a time trial", "device" to "the tracker")[type] ?: "a file")

/** About how many strokes: to the hundred from 1,000, with commas ("12,300"). */
fun roundStrokes(n: Double): String =
    "%,d".format(java.util.Locale.ROOT, if (n >= 1000) Math.round(n / 100) * 100 else Math.round(n))

/** How uneven the boat's rocking was, as a whole percentage (the website's fmtEvenness; 10.5 → "11%"). */
fun fmtEvenness(imbalancePct: Double): String = "${toFixed(kotlin.math.abs(imbalancePct), 0)}%"

/**
 * Why there are no boat-motion charts. A `reason` means the motion file came
 * but couldn't be measured; none means it hasn't arrived. Never show the reason.
 */
fun noMotionCopy(attitude: com.paddlesnitch.app.api.BoatMotion?): String =
    if (!attitude?.reason.isNullOrEmpty()) "We couldn’t measure boat motion in this recording. The tracker may not have been fixed firmly in the boat."
    else "Motion data uploads after the GPS track. If this recording is recent, sync the tracker again. Older recordings have no motion data."

/** A boat-motion chart's y-axis ticks: every multiple of the step within ±maxDeg (the website's axisTicks). */
fun axisTicks(maxDeg: Double): List<Int> {
    val step = if (maxDeg > 12) 5 else if (maxDeg > 6) 3 else 2
    val top = kotlin.math.floor(maxDeg / step).toInt() * step
    return (-top..top step step).toList()
}
