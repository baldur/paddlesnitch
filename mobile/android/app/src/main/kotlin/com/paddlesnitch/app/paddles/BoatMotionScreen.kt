package com.paddlesnitch.app.paddles

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import com.paddlesnitch.app.ui.Button
import com.paddlesnitch.app.ui.OutlinedButton
import com.paddlesnitch.app.ui.outlinedColors
import com.paddlesnitch.app.ui.TextButton
import com.paddlesnitch.app.ui.textColors
import com.paddlesnitch.app.api.ApiFailure
import androidx.compose.foundation.focusable
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.paddlesnitch.app.api.AnalysisSession
import com.paddlesnitch.app.api.AttitudeSample
import com.paddlesnitch.app.api.BoatMotion
import com.paddlesnitch.app.api.RecordingMotion
import com.paddlesnitch.app.api.RollHistogram
import com.paddlesnitch.app.ui.PlexMono
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.PsRadius
import kotlin.math.abs
import kotlin.math.max

// A tracker paddle's boat motion, as the website's /paddles/[id]/motion
// (mobile/contract/README.md § Boat motion). Every number comes from the
// server; this file only lays them out and draws them.

const val MOTION_FAILED = "Couldn’t read this recording."
/** A 404: the README's words as they are (a straight apostrophe, as the website's title). */
const val MOTION_NOT_FOUND = "We can't find this recording"

/** Whether a paddle can show boat motion: it came from one of your trackers. */
fun hasBoatMotion(s: AnalysisSession) =
    s.source.type == com.paddlesnitch.app.api.AnalysisSource.Type.Device && !s.source.deviceId.isNullOrEmpty() && !s.source.deviceSessionId.isNullOrEmpty()

/** One tile: what's drawn, and what a screen reader says ("°" as degrees, "spm" as strokes per minute). */
data class MotionTile(val label: String, val value: String, val note: String?, val spoken: String)

/** The four tiles, in the website's order. Stroke rate is the paddle's own average, not the recording's. */
fun motionTiles(a: BoatMotion, avgSR: Double?): List<MotionTile> {
    fun deg(label: String, v: Double?, note: String) =
        if (v == null) MotionTile(label, "—", null, "$label, not measured")
        else MotionTile(label, "${num(v)}°", note, "$label, ${num(v)} degrees, $note")
    val even = a.symmetry?.let { fmtEvenness(it.imbalancePct) }
    val sr = avgSR?.let { Math.round(it).toString() }
    return listOf(
        deg("Side-to-side roll", a.rollRmsDeg, "typical lean"),
        deg("Bow-to-stern pitch", a.pitchRmsDeg, "typical tilt"),
        if (even == null) MotionTile("Evenness", "—", null, "Evenness, not measured") else MotionTile("Evenness", even, "uneven", "Evenness, $even uneven"),
        if (sr == null) MotionTile("Stroke rate", "—", "not measured", "Stroke rate, not measured") else MotionTile("Stroke rate", sr, "spm", "Stroke rate, $sr strokes per minute"),
    )
}

/** The paddle page's two (README § Boat motion, On the paddle): Evenness, then Side-to-side roll, the screen's own tiles. */
fun balanceTiles(a: BoatMotion): List<MotionTile> = motionTiles(a, null).let { t -> listOf(t.first { it.label == "Evenness" }, t.first { it.label == "Side-to-side roll" }) }

/**
 * The balance part on the paddle page, only when the motion is in and readable: every other state shows
 * nothing, and the Boat motion button still leads to the screen, which explains.
 */
@Composable
fun BoatMotionSummary(a: BoatMotion, onAllCharts: () -> Unit) {
    if (!a.available) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.weight(1f)) { SectionTitle("Boat motion") }
            // Flush with the tiles' edge, as the website's link; still 48 dp each way to tap.
            TextButton(onClick = onAllCharts, colors = textColors(), contentPadding = PaddingValues(start = 12.dp),
                modifier = Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp)) { Text("All charts →", fontSize = 14.sp) }
        }
        Tiles(balanceTiles(a))
    }
}

/** The envelope chart's bound: the server's robust one, 10 when it has none. */
fun envelopeBound(a: BoatMotion) = a.plotBoundDeg ?: 10.0

/** Whether any of the envelope goes past the bound (and is drawn clipped). */
fun envelopeClipped(a: BoatMotion): Boolean {
    val m = envelopeBound(a)
    return a.envelope.any { abs(it.rollMin) > m || abs(it.rollMax) > m || abs(it.pitchMin) > m || abs(it.pitchMax) > m }
}

/** The note under the chart when the envelope went past its bound. */
fun clippedNote(a: BoatMotion) = "A few moments went past ±${toFixed(envelopeBound(a), 0)}° and are clipped at the chart’s edge."

/** The excerpt chart's bound: the largest value (at least 1°), with a tenth to spare. */
fun excerptBound(ex: List<AttitudeSample>) = max(ex.maxOfOrNull { max(abs(it.roll), abs(it.pitch)) } ?: 0.0, 1.0) * 1.1

/** "30 s at 10 Hz", or "30 s" when the rate isn't known. */
fun excerptLabel(a: BoatMotion): String {
    val s = Math.round((a.excerpt.last().t - a.excerpt.first().t) / 1000)
    return "$s s" + (a.sampleRateHz?.let { " at ${num(it)} Hz" } ?: "")
}

/** Each bin's count flipped about 0: the count of the bin nearest -centreDeg (the first such, on a tie). */
fun mirroredCounts(bins: List<RollHistogram.Bin>): List<Long> = bins.map { b ->
    bins.reduce { best, c -> if (abs(c.centreDeg + b.centreDeg) < abs(best.centreDeg + b.centreDeg)) c else best }.count
}

/** Label every nth tick so labels [lineHeight] tall, [gap] apart, keep a fifth of a line between them. */
fun labelEvery(gap: Float, lineHeight: Float): Int = generateSequence(1) { it + 1 }.first { gap * it >= lineHeight * 1.2f }

/** The histogram's x range, ±this: the widest bar's centre plus half a bin, at least 1°, so the edge bars sit inside. */
fun histogramRange(h: RollHistogram) = max(h.bins.maxOf { abs(it.centreDeg) } + h.binWidthDeg / 2, 1.0)

/** The histogram's edge labels' N, rounded. */
fun histogramEdge(h: RollHistogram) = toFixed(histogramRange(h), 0)

@Composable
fun BoatMotionScreen(
    paddle: AnalysisSession, load: suspend () -> RecordingMotion, modifier: Modifier = Modifier, onBack: () -> Unit = {},
    /** Where the recording's device can sync (Open tracker / Open phone) when its motion hasn't arrived; null: no button. */
    openDevice: (() -> Unit)? = null,
) {
    var motion by remember(paddle.id) { mutableStateOf<RecordingMotion?>(null) }
    var failed by remember(paddle.id) { mutableStateOf(false) }
    var notFound by remember(paddle.id) { mutableStateOf(false) }
    var attempt by remember(paddle.id) { mutableIntStateOf(0) }
    val errorFocus = remember { FocusRequester() }
    LaunchedEffect(paddle.id, attempt) {
        failed = false
        runCatching { load() }.onSuccess { motion = it }.onFailure {
            // A 404 would fail every time: no Try again. Anything else can be tried again.
            if ((it as? ApiFailure)?.status == 404) notFound = true else failed = true
        }
    }
    // Try again failed too: its button went while loading, so focus comes back to the error (the website's ReadError).
    // Only then is the error a focus stop; after the first failure Try again is the next stop, as on the website.
    val retriedAndFailed = failed && attempt > 0
    LaunchedEffect(retriedAndFailed, attempt) { if (retriedAndFailed) runCatching { errorFocus.requestFocus() } }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Eyebrow(fmtDayTime(paddle.paddledAt))
            Text("Boat motion", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
        }
        // Always there, so TalkBack reads the failure when it arrives.
        Box(Modifier.fillMaxWidth().testTag("motion-error").semantics { liveRegion = LiveRegionMode.Polite }) {
            if (failed) Column(Modifier.focusRequester(errorFocus).then(if (retriedAndFailed) Modifier.focusable() else Modifier), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(MOTION_FAILED, color = PsColor.red, fontSize = 16.sp)
                Button(onClick = { attempt++ }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Try again") }
            }
        }
        val m = motion
        when {
            failed -> {}
            // In the same card as "No boat motion", so the screen's empty states look alike.
            notFound -> Column(Modifier.box().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(MOTION_NOT_FOUND, color = PsColor.fg, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, modifier = Modifier.semantics { heading() })
                OutlinedButton(onClick = onBack, colors = outlinedColors(), modifier = Modifier.heightIn(min = 48.dp)) { Text("Back to the paddle") }
            }
            m == null -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                Text("Loading", color = PsColor.muted)
            }
            m.attitude?.available != true -> NoMotion(m.attitude, openDevice?.let { go -> deviceButton(paddle) to go })
            else -> Motion(m.attitude, paddle.result.avgSR)
        }
    }
}

private val controlShape = RoundedCornerShape(PsRadius.control)
private fun Modifier.box() = fillMaxWidth().background(PsColor.surface, controlShape).border(1.dp, PsColor.border, controlShape)
/** Charts are data: square corners. */
private fun Modifier.panel() = fillMaxWidth().background(PsColor.surface).border(1.dp, PsColor.border)

/** "Open phone" for a phone's recording (the server's `source.phone`), else "Open tracker". */
fun deviceButton(paddle: AnalysisSession) = if (paddle.source.phone == true) "Open phone" else "Open tracker"

/** The motion file hasn't arrived (no attitude, or no reason): not when it came and couldn't be measured. */
fun motionNotArrived(a: BoatMotion?) = a == null || a.reason.isNullOrEmpty()

@Composable
private fun NoMotion(a: BoatMotion?, device: Pair<String, () -> Unit>?) {
    Column(Modifier.box().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("No boat motion for this recording.", color = PsColor.fg, fontWeight = FontWeight.Medium, fontSize = 16.sp)
        Text(noMotionCopy(a), color = PsColor.muted, fontSize = 16.sp)
        // A way there, not a promise: an older recording never had motion.
        if (device != null && motionNotArrived(a)) OutlinedButton(onClick = device.second, colors = outlinedColors(), modifier = Modifier.heightIn(min = 48.dp)) { Text(device.first) }
    }
}

@Composable
private fun Motion(a: BoatMotion, avgSR: Double?) {
    Tiles(motionTiles(a, avgSR))
    ChartPanel("Through the session", "The shaded band shows how far the boat rolled and pitched through the recording. Roll is the side-to-side lean, pitch the bow rising and falling.",
        "Roll and pitch through the session, reaching about ${toFixed(envelopeBound(a), 0)} degrees", 260.dp, a.envelope.size >= 2,
        note = if (a.envelope.size >= 2 && envelopeClipped(a)) clippedNote(a) else null) { t -> envelope(a, t) }
    ChartPanel("Stroke shape", "30 seconds of typical paddling. An even stroke crosses the centre line equally on both sides.",
        "Thirty seconds of roll and pitch at full sample rate", 260.dp, a.excerpt.size >= 2) { t -> excerpt(a, t) }
    val h = a.rollHistogram
    ChartPanel("Where the boat spent its time", "Bars show how often the boat leaned each way. The dashed line is the same, flipped. If they match, your roll is even.",
        "Distribution of boat lean, with the mirrored distribution overlaid to show evenness", 230.dp, h != null && h.bins.isNotEmpty()) { t -> histogram(h!!, t) }
    Column(Modifier.box().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Lead("Reading this.", " Rowing: aim for little roll, so the boat stays level. Kayak: the boat should rock with the stroke; what matters is that it rocks evenly.")
        Lead("What this can't tell you.", " We can't tell port from starboard, and a tracker or phone mounted slightly crooked looks like a steady lean." +
            if (!a.axisConfident) " Roll and pitch were hard to tell apart in this recording." else "")
    }
}

@Composable
private fun Lead(lead: String, rest: String) = Text(buildAnnotatedString {
    withStyle(SpanStyle(color = PsColor.fg)) { append(lead) }
    append(rest)
}, color = PsColor.muted, fontSize = 14.sp, lineHeight = 20.sp)

/** Two across on a phone, four from 640 dp; one at the largest text, so labels wrap at spaces, not mid-word. */
@Composable
private fun Tiles(tiles: List<MotionTile>) {
    val scale = androidx.compose.ui.platform.LocalDensity.current.fontScale
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val across = if (scale >= 1.5f) (if (maxWidth >= 640.dp) 2 else 1) else if (maxWidth >= 640.dp) 4 else 2
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            tiles.chunked(across).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { Tile(it, Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun Tile(t: MotionTile, modifier: Modifier) {
    Column(modifier.box().padding(horizontal = 12.dp, vertical = 8.dp).clearAndSetSemantics { contentDescription = t.spoken }) {
        Eyebrow(t.label)
        Text(t.value, color = PsColor.fg, fontFamily = PlexMono, fontSize = 20.sp, modifier = Modifier.padding(top = 2.dp))
        t.note?.let { Text(it, color = PsColor.muted, fontSize = 14.sp) }
    }
}

/** A chart with its title above and caption below; the chart is one image to a screen reader, and draws nothing with too few points. */
@Composable
private fun ChartPanel(title: String, caption: String, label: String, height: Dp, drawable: Boolean, note: String? = null, draw: DrawScope.(TextMeasurer) -> Unit) {
    val text = rememberTextMeasurer()
    Column(Modifier.panel()) {
        Text(title, color = PsColor.fg, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp).semantics { heading() })
        // As wide as the panel and the website's height, whatever the width; the text stays 11 sp.
        if (drawable) Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp)) {
            Canvas(Modifier.fillMaxWidth().height(height).clearAndSetSemantics { contentDescription = label; role = Role.Image }) { draw(text) }
        } else Box(Modifier.height(12.dp))
        // Under the chart, outside its image.
        note?.let { Text(it, color = PsColor.muted, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp)) }
        Text(caption, color = PsColor.muted, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp))
    }
}

/* ---------------------------------------------------------------- charts --- */

private val axisText = TextStyle(fontFamily = PlexMono, fontSize = 11.sp, color = PsColor.muted)

/** The plot area inside a chart: room on the left for the degree labels, below for the time, above for a legend, sized to the text. */
private class Frame(scope: DrawScope, m: TextMeasurer, legend: Boolean) {
    private val line = m.measure("-12°", axisText).size
    val l = line.width + with(scope) { 10.dp.toPx() }
    val r = scope.size.width - with(scope) { 6.dp.toPx() }
    /** A legend has its own 34 dp band above the plot (more if large text needs it), so it never covers a band or bar. */
    val t = if (legend) max(with(scope) { 34.dp.toPx() }, line.height + with(scope) { 8.dp.toPx() }) else with(scope) { 6.dp.toPx() }
    val b = scope.size.height - line.height - with(scope) { 8.dp.toPx() }
    /** The middle of the legend band above the plot. */
    val legendMiddle = t / 2f
    /** Where the labels under the plot sit (their middle). */
    val under = scope.size.height - line.height / 2f - with(scope) { 2.dp.toPx() }
}

private fun DrawScope.label(m: TextMeasurer, s: String, x: Float, y: Float, align: Float = 0f) {
    val layout = m.measure(s, axisText)
    drawText(layout, topLeft = Offset(x - layout.size.width * align, y - layout.size.height / 2f))
}

/**
 * Gridlines and degree labels at the ticks, and the zero line over them. At large text the labels
 * would touch, so only every [labelEvery]th one (counting from 0) is labelled; every gridline stays.
 */
private fun DrawScope.degreeAxis(m: TextMeasurer, f: Frame, bound: Double, y: (Double) -> Float) {
    val ticks = axisTicks(bound)
    val gap = if (ticks.size > 1) abs(y(ticks[1].toDouble()) - y(ticks[0].toDouble())) else Float.MAX_VALUE
    val every = labelEvery(gap, m.measure("0°", axisText).size.height.toFloat())
    val step = if (ticks.size > 1) ticks[1] - ticks[0] else 1
    ticks.forEach { v ->
        drawLine(PsColor.border, Offset(f.l, y(v.toDouble())), Offset(f.r, y(v.toDouble())), 1.dp.toPx())
        if ((v / step) % every == 0) label(m, "$v°", f.l - 6.dp.toPx(), y(v.toDouble()), align = 1f)
    }
    drawLine(PsColor.muted, Offset(f.l, y(0.0)), Offset(f.r, y(0.0)), 1.2.dp.toPx())
}

/** A legend's sizes follow its text, so they keep their spacing at large text. */
private class Key(m: TextMeasurer) {
    val line = m.measure("pitch", axisText).size.height.toFloat()
    val mark = line * 0.6f
    val gap = line * 0.3f
    val space = line * 0.7f
}

/** Legend swatches, whatever the opacity of what they stand for, so each stays visible. */
private const val SWATCH_ALPHA = 0.8f

/** A swatch and its word, centred on [mid]; returns where the next one starts. */
private fun DrawScope.swatch(m: TextMeasurer, colour: Color, text: String, x: Float, mid: Float): Float {
    val k = Key(m)
    drawRect(colour, Offset(x, mid - k.mark / 2), Size(k.mark, k.mark), alpha = SWATCH_ALPHA)
    val layout = m.measure(text, axisText)
    drawText(layout, topLeft = Offset(x + k.mark + k.gap, mid - layout.size.height / 2f))
    return x + k.mark + k.gap + layout.size.width + k.space
}

private fun DrawScope.legendWidth(m: TextMeasurer, vararg texts: String): Float {
    val k = Key(m)
    return texts.sumOf { (k.mark + k.gap + m.measure(it, axisText).size.width + k.space).toDouble() }.toFloat() - k.space
}

private fun DrawScope.envelope(a: BoatMotion, m: TextMeasurer) {
    val env = a.envelope
    val f = Frame(this, m, legend = true)
    val bound = envelopeBound(a)
    val t0 = env.first().t; val t1 = env.last().t
    val x = { t: Double -> (f.l + (t - t0) / max(1.0, t1 - t0) * (f.r - f.l)).toFloat() }
    val y = { d: Double -> (f.t + (bound - d.coerceIn(-bound, bound)) / (2 * bound) * (f.b - f.t)).toFloat() }
    degreeAxis(m, f, bound, y)
    fun band(lo: (com.paddlesnitch.app.api.AttitudeBucket) -> Double, hi: (com.paddlesnitch.app.api.AttitudeBucket) -> Double) = Path().apply {
        env.forEachIndexed { i, b -> if (i == 0) moveTo(x(b.t), y(hi(b))) else lineTo(x(b.t), y(hi(b))) }
        env.asReversed().forEach { b -> lineTo(x(b.t), y(lo(b))) }
        close()
    }
    drawPath(band({ it.pitchMin }, { it.pitchMax }), PsColor.green, alpha = 0.28f)
    drawPath(band({ it.rollMin }, { it.rollMax }), PsColor.split, alpha = 0.5f)
    val bottom = f.under
    val (from, to) = envelopeXLabels(t1 - t0)
    label(m, from, f.l, bottom)
    label(m, to, f.r, bottom, align = 1f)
    var lx = f.r - legendWidth(m, "roll", "pitch")
    lx = swatch(m, PsColor.split, "roll", lx, f.legendMiddle)
    swatch(m, PsColor.green, "pitch", lx, f.legendMiddle)
}

private fun DrawScope.excerpt(a: BoatMotion, m: TextMeasurer) {
    val ex = a.excerpt
    val f = Frame(this, m, legend = false)
    val bound = excerptBound(ex)
    val t0 = ex.first().t; val t1 = ex.last().t
    val x = { t: Double -> (f.l + (t - t0) / max(1.0, t1 - t0) * (f.r - f.l)).toFloat() }
    val y = { d: Double -> (f.t + (bound - d) / (2 * bound) * (f.b - f.t)).toFloat() }
    degreeAxis(m, f, bound, y)
    fun line(pick: (AttitudeSample) -> Double) = Path().apply {
        ex.forEachIndexed { i, s -> if (i == 0) moveTo(x(s.t), y(pick(s))) else lineTo(x(s.t), y(pick(s))) }
    }
    drawPath(line { it.pitch }, PsColor.green, alpha = 0.7f, style = Stroke(1.2.dp.toPx()))
    drawPath(line { it.roll }, PsColor.split, style = Stroke(1.8.dp.toPx()))
    label(m, excerptLabel(a), f.l, f.under)
}

private fun DrawScope.histogram(h: RollHistogram, m: TextMeasurer) {
    val f = Frame(this, m, legend = true)
    val maxCount = max(h.bins.maxOf { it.count }, 1L).toDouble()
    // ±N degrees across the plot, N from the server's bins (histogramRange); each bar 0.86 of a bin wide.
    val edge = histogramRange(h)
    val x = { d: Double -> (f.l + (d + edge) / (2 * edge) * (f.r - f.l)).toFloat() }
    val bw = (0.86 * h.binWidthDeg / (2 * edge) * (f.r - f.l)).toFloat()
    val y = { c: Double -> (f.t + (1 - c / maxCount) * (f.b - f.t)).toFloat() }
    h.bins.forEach { b ->
        drawRect(PsColor.split, Offset(x(b.centreDeg) - bw / 2, y(b.count.toDouble())), Size(bw, max(0f, f.b - y(b.count.toDouble()))), alpha = 0.45f)
    }
    val dashes = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))
    val mirrored = mirroredCounts(h.bins)
    drawPath(Path().apply {
        h.bins.forEachIndexed { i, b -> if (i == 0) moveTo(x(b.centreDeg), y(mirrored[i].toDouble())) else lineTo(x(b.centreDeg), y(mirrored[i].toDouble())) }
    }, PsColor.red, style = Stroke(1.6.dp.toPx(), pathEffect = dashes))
    drawLine(PsColor.muted, Offset(x(0.0), f.t), Offset(x(0.0), f.b), 1.2.dp.toPx())
    val bottom = f.under
    val n = histogramEdge(h)
    label(m, "level", x(0.0), bottom, align = 0.5f)
    label(m, "−$n°", f.l, bottom)
    label(m, "+$n°", f.r, bottom, align = 1f)
    val mid = f.legendMiddle
    val k = Key(m)
    val lx = swatch(m, PsColor.split, "actual", f.l + 6.dp.toPx(), mid)
    drawLine(PsColor.red, Offset(lx, mid), Offset(lx + k.line * 1.2f, mid), 1.6.dp.toPx(), pathEffect = dashes, alpha = SWATCH_ALPHA)
    label(m, "mirrored", lx + k.line * 1.2f + k.gap, mid)
}
