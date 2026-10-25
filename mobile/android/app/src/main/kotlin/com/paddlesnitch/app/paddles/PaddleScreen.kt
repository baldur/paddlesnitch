package com.paddlesnitch.app.paddles

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.paddlesnitch.app.api.AnalysisSession
import com.paddlesnitch.app.api.PaddleList
import com.paddlesnitch.app.ui.PsColor

/** The map on the paddle page; tests swap in a stand-in, as MapLibre can't draw on the JVM. */
typealias MapSlot = @Composable (PaddleDetail, Modifier) -> Unit

val routeMap: MapSlot = { d, m -> RouteMap(d.route, d.bounds!!, m) }

/**
 * The Paddles list, and one paddle over it when a card is tapped. Back (the
 * system's, or the page's own) returns to the list where it was.
 */
@Composable
fun PaddlesHost(
    list: PaddleList,
    sample: Boolean,
    load: suspend (id: String) -> AnalysisSession,
    modifier: Modifier = Modifier,
    /** Writes a summary that's still pending, as the website's paddle page does; null for the samples. */
    writeSummary: (suspend (id: String) -> AnalysisSession)? = null,
    action: (@Composable () -> Unit)? = null,
    notice: (@Composable () -> Unit)? = null,
    map: MapSlot = routeMap,
) {
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    val id = open
    if (id == null) {
        PaddlesScreen(list, sample, modifier, action, notice, listState, onOpen = { open = it })
    } else {
        BackHandler { open = null }
        PaddleLoader(id, load, writeSummary, onBack = { open = null }, modifier, map)
    }
}

@Composable
private fun PaddleLoader(id: String, load: suspend (String) -> AnalysisSession, writeSummary: (suspend (String) -> AnalysisSession)?, onBack: () -> Unit, modifier: Modifier, map: MapSlot) {
    var detail by remember(id) { mutableStateOf<PaddleDetail?>(null) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    var attempt by remember(id) { mutableIntStateOf(0) }
    LaunchedEffect(id, attempt) {
        error = null
        val session = runCatching { load(id) }.onFailure { error = it.message ?: "Couldn’t open this paddle." }.getOrNull() ?: return@LaunchedEffect
        detail = PaddleDetail(session)
        // The page shows at once; the summary follows when it's written.
        if (session.insightPending == true && writeSummary != null) {
            detail = runCatching { PaddleDetail(writeSummary(id)) }.getOrElse { PaddleDetail(session, summaryFailed = true) }
        }
    }
    val d = detail
    Column(modifier.fillMaxSize()) {
        TextButton(onClick = onBack, modifier = Modifier.padding(horizontal = 4.dp).heightIn(min = 48.dp)) { Text("← Paddles", fontSize = 16.sp) }
        when {
            d != null -> PaddlePage(d, map)
            error != null -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(error!!, color = PsColor.red)
                Button(onClick = { attempt++ }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Try again") }
            }
            else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
    }
}

/** One paddle, read only, top to bottom as the website's paddle page. */
@Composable
fun PaddlePage(d: PaddleDetail, map: MapSlot = routeMap, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        if (d.route.isNotEmpty() && d.bounds != null) Column {
            map(d, Modifier.fillMaxWidth().height(320.dp))
            d.legend?.let { Legend(it) }
        }
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                d.eyebrow?.let { Eyebrow(it) }
                Text(d.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
            }
            StatsGrid(d.stats)
            d.noGpsMessage?.let { Text(it, color = PsColor.muted, fontSize = 15.sp) }
            d.note?.let { LeftRule(PsColor.borderStrong) { Text(it, color = PsColor.muted, fontSize = 15.sp) } }
            if (d.insight != null || d.insightPending) LeftRule(PsColor.primary) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    d.insight?.let { Text(it, fontSize = 16.sp, lineHeight = 24.sp) }
                    if (d.insightPending) Text("Writing your summary…", color = PsColor.muted, fontSize = 14.sp)
                }
            }
            if (d.efforts.isNotEmpty() || d.rests.isNotEmpty() || d.repeats.isNotEmpty()) Efforts(d)
            if (d.splits.isNotEmpty()) Splits(d.splits)
        }
    }
}

@Composable
private fun Legend(ends: Pair<String, String>) {
    Column(Modifier.fillMaxWidth().background(PsColor.surface).padding(horizontal = 16.dp, vertical = 8.dp)
        .semantics(mergeDescendants = true) { contentDescription = "Speed colours: blue ${ends.first}, red ${ends.second}" }) {
        Box(Modifier.fillMaxWidth().height(6.dp).background(
            Brush.horizontalGradient(listOf(0.0, 0.4, 0.7, 1.0).map { Color(0xFF000000 or ColourScale.ramp(it).toLong()) }), RoundedCornerShape(3.dp)))
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            Text(ends.first, color = PsColor.muted, fontSize = 13.sp, modifier = Modifier.weight(1f))
            Text(ends.second, color = PsColor.muted, fontSize = 13.sp)
        }
    }
}

/** Three across, fewer as the text grows. */
@Composable
private fun StatsGrid(stats: List<Stat>) {
    val scale = LocalDensity.current.fontScale
    val across = if (scale >= 1.8f) 1 else if (scale >= 1.3f) 2 else 3
    Column(Modifier.fillMaxWidth().card().padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        stats.chunked(across).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { StatCell(it, Modifier.weight(1f)) }
                repeat(across - row.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun StatCell(s: Stat, modifier: Modifier) {
    val tone = when (s.label) { "Pace" -> PsColor.primaryText; "Stroke rate" -> PsColor.split; "River" -> PsColor.flow; else -> PsColor.fg }
    Column(modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Eyebrow(s.label)
        Text(s.value, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = tone)
        s.sub?.let { Text(it, fontSize = 13.sp, color = PsColor.muted) }
    }
}

@Composable
private fun LeftRule(colour: Color, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxWidth().drawBehind { drawRect(colour, size = size.copy(width = 2.dp.toPx())) }.padding(start = 14.dp)) { content() }
}

@Composable
private fun SectionTitle(text: String) =
    Text(text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })

@Composable
private fun Efforts(d: PaddleDetail) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("Efforts and rests")
        if (d.repeats.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Eyebrow("Repeats")
            d.repeats.forEach { Text(it, fontFamily = FontFamily.Monospace, fontSize = 15.sp) }
        }
        if (d.efforts.isNotEmpty()) Column(Modifier.fillMaxWidth().card()) {
            d.efforts.forEachIndexed { i, e ->
                if (i > 0) HorizontalDivider(color = PsColor.border)
                Column(Modifier.fillMaxWidth().padding(12.dp).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Effort ${e.number} at ${e.at}", color = PsColor.muted, fontSize = 14.sp)
                    Text("${e.lasted} · ${e.pace}/500 · ${e.spm} spm", fontFamily = FontFamily.Monospace, fontSize = 16.sp)
                    e.trend?.let { Text(it, color = PsColor.split, fontSize = 14.sp) }
                }
            }
        }
        if (d.rests.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Eyebrow("Rests")
            Text(d.rests.joinToString("   "), color = PsColor.muted, fontFamily = FontFamily.Monospace, fontSize = 14.sp)
        }
    }
}

@Composable
private fun Splits(rows: List<SplitRow>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionTitle("500 m splits")
        Column(Modifier.fillMaxWidth().card().padding(horizontal = 12.dp)) {
            SplitLine("km", "At", "/500", "Spm", header = true)
            rows.forEach {
                HorizontalDivider(color = PsColor.border)
                SplitLine(it.km, it.at, it.pace, it.spm, header = false)
            }
        }
    }
}

@Composable
private fun SplitLine(km: String, at: String, pace: String, spm: String, header: Boolean) {
    val colour = if (header) PsColor.muted else PsColor.fg
    val size = if (header) 12.sp else 15.sp
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        listOf(km, at, pace, spm).forEachIndexed { i, s ->
            Text(if (header) s.uppercase() else s, color = if (i == 2 && !header) PsColor.primaryText else colour, fontSize = size,
                fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
        }
    }
}

/** The golden answer behind a sample card (mobile/contract/fixtures/api), shipped as an asset. */
fun sampleFile(id: String) = "api/" + (mapOf("pdl-motion" to "paddles.get.motion-only.json", "pdl-strava" to "paddles.get.strava.json")[id] ?: "paddles.get.json")
