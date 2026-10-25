package com.paddlesnitch.app.paddles

import com.paddlesnitch.app.api.AnalysisPoint
import kotlin.math.roundToInt

/**
 * The route's colour scale, as the website's (components/map/colour-scale.ts):
 * slow (blue) to fast (red) between the paddle's own 10th and 90th
 * percentiles, so every paddle uses the whole ramp. Colours are 0xRRGGBB.
 */
object ColourScale {
    /** A point whose speed or rate is missing. */
    const val MISSING = 0x475569

    private val stops = listOf(0.0 to intArrayOf(37, 99, 235), 0.4 to intArrayOf(6, 182, 212), 0.7 to intArrayOf(234, 179, 8), 1.0 to intArrayOf(220, 38, 38))

    /** The colour at t in 0..1 (clamped). */
    fun ramp(t: Double): Int {
        val x = t.coerceIn(0.0, 1.0)
        for (i in 1 until stops.size) if (x <= stops[i].first) {
            val (a, ca) = stops[i - 1]; val (b, cb) = stops[i]
            val f = (x - a) / (b - a)
            val c = IntArray(3) { (ca[it] + f * (cb[it] - ca[it])).roundToInt() }
            return (c[0] shl 16) or (c[1] shl 8) or c[2]
        }
        return 0xDC2626
    }

    /** The low and high ends of the speed scale, or null with fewer than two moving points. */
    fun bounds(points: List<AnalysisPoint>): Pair<Double, Double>? {
        val v = points.map { it.speed }.filter { it > 0 }.sorted()
        if (v.size < 2) return null
        val q = { p: Int -> v[minOf(v.size - 1, (p / 100.0 * v.size).toInt())] }
        return q(10) to q(90)
    }

    /** Each point's colour by speed on this paddle's scale. */
    fun colours(points: List<AnalysisPoint>): List<Int> {
        val (lo, hi) = bounds(points) ?: return points.map { MISSING }
        val range = (hi - lo).takeIf { it != 0.0 } ?: 1.0
        return points.map { ramp((it.speed - lo) / range) }
    }
}
