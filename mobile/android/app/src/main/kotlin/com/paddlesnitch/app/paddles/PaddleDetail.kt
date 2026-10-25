package com.paddlesnitch.app.paddles

import com.paddlesnitch.app.api.AnalysisPoint
import com.paddlesnitch.app.api.AnalysisResult
import com.paddlesnitch.app.api.AnalysisSession
import com.paddlesnitch.app.api.Conditions
import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

data class Coord(val lat: Double, val lng: Double)

/** South-west and north-east corners. */
data class Bounds(val south: Double, val west: Double, val north: Double, val east: Double)

/** Neighbouring stretches of the route in one colour (0xRRGGBB). */
data class RouteRun(val coords: List<Coord>, val colour: Int)

data class Stat(val label: String, val value: String, val sub: String? = null)

data class SplitRow(val km: String, val at: String, val pace: String, val spm: String)

data class EffortRow(val number: Int, val at: String, val lasted: String, val pace: String, val spm: String, val trend: String?)

/**
 * One paddle, worked into what its page shows, top to bottom as the website's
 * AnalysisView.tsx. Pure, so it's tested without a screen.
 */
class PaddleDetail(s: AnalysisSession, summaryFailed: Boolean = false) {
    private val r = s.result
    val title: String = fmtWeekday(s.paddledAt)
    val eyebrow: String? = listOfNotNull(sourceLabel(s.source.type.wire), s.boatClass?.wire?.ifEmpty { "?" }).joinToString(" · ").ifEmpty { null }
    val motionOnly = r.noGps != null
    val stats: List<Stat> = (if (motionOnly) motionStats(r) else gpsStats(r)) + conditions(r.conditions)
    val noGpsMessage: String? = r.noGps?.let { noPaddleMessage(it.reason, true) }
    val route: List<RouteRun> = if (motionOnly) emptyList() else runs(r.points)
    val bounds: Bounds? = if (motionOnly) null else bounds(r.points)
    /** The ends of the colour scale as paces: "slower" end first. */
    val legend: Pair<String, String>? = ColourScale.bounds(r.points)?.let { (lo, hi) -> pace(lo, "slower") to pace(hi, "faster") }
    val note: String? = s.note.trim().ifEmpty { null }
    val insight: String? = s.insight.ifEmpty { r.insight }.ifEmpty { null }
    /** The summary is still to be written (and asking for it hasn't failed). */
    val insightPending = s.insightPending == true && !summaryFailed
    val repeats: List<String> = r.sets.filter { it.count > 1 }.map { set ->
        "${set.count} × ${fmtDur(set.avgDurS)} at ${split500(set.avgSpeed)}/500" + (set.avgSR?.let { ", ${it.roundToInt()} spm" } ?: "")
    }
    val efforts: List<EffortRow> = r.surges.mapIndexed { i, e ->
        EffortRow(i + 1, fmtClock(e.fromT), fmtDur(e.durS), split500(e.avgSpeed), e.avgSR?.roundToInt()?.toString() ?: "—", e.trend?.ifEmpty { null })
    }
    val rests: List<String> = r.stops.map { "${if (it.durS >= 60) fmtDur(it.durS) else "${it.durS.roundToInt()} s"} at ${fmtClock(it.fromT)}" }
    val splits: List<SplitRow> = if (motionOnly) emptyList() else splits(r.points)

    private fun pace(speed: Double, fallback: String) = split500(speed).let { if (it == "—") fallback else "$it/500" }

    companion object {
        fun gpsStats(r: AnalysisResult) = listOf(
            Stat("Time", fmtClock(r.durationS)),
            Stat("Distance", paddleKm(r.distanceKm, false)),
            Stat("Pace", split500(r.cruiseSpeed), "/500, cruising"),
            strokeRate(r, if (r.strokeRateDoubled) "spm, doubled" else "spm"),
            Stat("Per stroke", r.avgDps?.let { "${toFixed(it, 1)} m" } ?: "—"),
        )

        fun motionStats(r: AnalysisResult) = listOf(
            Stat("Paddling", fmtClock(r.durationS), "from the boat's motion"),
            Stat("Distance", "—", "no GPS"),
            strokeRate(r, "spm"),
            Stat("Strokes", roundStrokes(r.noGps!!.strokes.toDouble()), "about"),
        )

        private fun strokeRate(r: AnalysisResult, unit: String) =
            r.avgSR?.let { Stat("Stroke rate", "${it.roundToInt()}", unit) } ?: Stat("Stroke rate", "—", if (r.noGps != null) "spm" else "not in this file")

        fun conditions(c: Conditions?): List<Stat> = listOfNotNull(
            c?.windKmh?.let { Stat("Wind", "${Math.round(it)} km/h", c.windDir?.let { d -> "from the ${compassPoint(d)}" }) },
            c?.flowM3s?.let { Stat("River", "${toFixed(it, 1)} m³/s", c.flowStation?.let { st -> "at $st" }) },
        )

        /**
         * The route as runs of one colour, each segment coloured by its end
         * point as the website's map does, and each run sharing its first point
         * with the one before so the line has no gaps.
         */
        fun runs(points: List<AnalysisPoint>): List<RouteRun> {
            if (points.size < 2) return emptyList()
            val colours = ColourScale.colours(points)
            val out = mutableListOf<RouteRun>()
            var run = mutableListOf(points[0].coord())
            var colour = colours[1]
            for (i in 1 until points.size) {
                if (colours[i] != colour) {
                    out += RouteRun(run, colour)
                    run = mutableListOf(points[i - 1].coord())
                    colour = colours[i]
                }
                run += points[i].coord()
            }
            out += RouteRun(run, colour)
            return out
        }

        fun bounds(points: List<AnalysisPoint>): Bounds? =
            if (points.isEmpty()) null else Bounds(points.minOf { it.lat }, points.minOf { it.lng }, points.maxOf { it.lat }, points.maxOf { it.lng })

        /**
         * 500 m splits along the track: the clock at each 500 m mark
         * (interpolated between points), the pace over that 500 m and the mean
         * stroke rate in it. A last part of 100 m or more gets its own row.
         * None for a paddle under 500 m.
         */
        fun splits(points: List<AnalysisPoint>): List<SplitRow> {
            val rows = mutableListOf<SplitRow>()
            var dist = 0.0
            var fromT = points.firstOrNull()?.t ?: return rows
            var fromD = 0.0
            fun row(toD: Double, toT: Double) {
                val rates = points.filter { it.t in fromT..toT }.mapNotNull { it.sr }
                rows += SplitRow(
                    toFixed(toD / 1000, if (toD % 500 == 0.0) 1 else 2), fmtClock(toT - points[0].t),
                    split500((toD - fromD) / (toT - fromT)), if (rates.isEmpty()) "—" else "${rates.average().roundToInt()}",
                )
                fromT = toT; fromD = toD
            }
            for (i in 1 until points.size) {
                val a = points[i - 1]; val b = points[i]
                val d = haversine(a.lat, a.lng, b.lat, b.lng)
                while (d > 0 && dist + d >= fromD + 500) {
                    val mark = fromD + 500
                    row(mark, a.t + (b.t - a.t) * (mark - dist) / d)
                }
                dist += d
            }
            if (rows.isEmpty()) return rows
            if (dist - fromD >= 100) row(dist, points.last().t)
            return rows
        }

        private fun AnalysisPoint.coord() = Coord(lat, lng)

        /** Metres between two points (the website's haversine, packages/timing/src/geo.ts). */
        fun haversine(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
            val rad = PI / 180
            val dLat = (lat2 - lat1) * rad; val dLng = (lng2 - lng1) * rad
            val h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * rad) * cos(lat2 * rad) * sin(dLng / 2) * sin(dLng / 2)
            return 2 * 6371000 * asin(sqrt(h))
        }
    }
}
