package com.paddlesnitch.app.paddles

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.paddlesnitch.app.api.PaddleCard
import com.paddlesnitch.app.api.PaddleList
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.PlexMono
import com.paddlesnitch.app.ui.PsRadius
import kotlin.math.max
import kotlin.math.roundToInt

private val cardShape = RoundedCornerShape(PsRadius.sheet)
internal fun Modifier.card() = background(PsColor.surface, cardShape).border(1.dp, PsColor.border, cardShape)

/**
 * The Paddles list, as the website's /paddles draws it
 * (apps/web/src/components/paddles/PaddlesList.tsx): the logbook, then one
 * card per outing. Everything is worked out on the server (paddles.list).
 */
@Composable
fun PaddlesScreen(
    list: PaddleList,
    sample: Boolean,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
    notice: (@Composable () -> Unit)? = null,
    state: LazyListState = rememberLazyListState(),
    onOpen: (id: String) -> Unit = {},
) {
    LazyColumn(
        modifier.fillMaxWidth(),
        state = state,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Paddles", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f).semantics { heading() })
                action?.invoke()
            }
        }
        if (notice != null) item { Box(Modifier.fillMaxWidth().card().padding(12.dp)) { notice() } }
        if (sample) item {
            Text(
                "Sample paddles. Sign in to see your own.",
                color = PsColor.muted, fontSize = 14.sp,
                modifier = Modifier.fillMaxWidth().background(PsColor.surface2, RoundedCornerShape(PsRadius.control)).padding(12.dp),
            )
        }
        if (list.cards.isEmpty()) {
            item { Text("No paddles yet. Add one from a GPS file, Strava or a time trial on paddlesnitch.com. A tracker adds its own.", color = PsColor.muted) }
        } else {
            item { Logbook(list) }
            item { Eyebrow("All paddles") }
            items(list.cards, key = { it.id }) { PaddleRow(it, onOpen) }
        }
    }
}

@Composable
internal fun Eyebrow(text: String) =
    Text(text.uppercase(), fontFamily = PlexMono, fontSize = 12.sp, letterSpacing = 1.sp, color = PsColor.muted)

@Composable
private fun Stat(label: String, value: String, sub: String?, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Eyebrow(label)
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, fontFamily = PlexMono)
        if (sub != null) Text(sub, fontSize = 13.sp, color = PsColor.muted)
    }
}

@Composable
private fun Logbook(list: PaddleList) {
    val book = list.logbook
    val streak = book.streakWeeks
    Column(Modifier.card().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Stat("This week", "${km1(book.weeks.lastOrNull()?.km ?: 0.0)} km", null, Modifier.weight(1f))
            Stat("This month", "${km1(book.thisMonthKm)} km", "${km1(book.lastMonthKm)} km last month", Modifier.weight(1f))
            Stat("Streak", if (streak > 0) "$streak wk" else "—",
                if (streak > 0) "week${if (streak == 1L) "" else "s"} in a row" else "start one this week", Modifier.weight(1f))
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Eyebrow("Last 12 weeks")
            if (book.weeks.all { it.km == 0.0 }) Text("No paddles in the last 12 weeks.", color = PsColor.muted, fontSize = 14.sp)
            else WeeksChart(book.weeks.map { it.km })
        }
        val t = list.totals
        Text(
            "In all: ${t.count} paddle${if (t.count == 1L) "" else "s"}, ${toFixed(t.totalKm, 1)} km, " +
                "${fmtClock(t.totalS)} on the water${t.since?.let { ", since ${fmtMonth(it)}" } ?: ""}.",
            color = PsColor.muted, fontSize = 14.sp,
        )
    }
}

/** Kilometres per week as bars, this week on the right and highlighted; an empty week is just baseline. */
@Composable
private fun WeeksChart(weeks: List<Double>) {
    val top = max(1.0, weeks.max())
    Row(
        Modifier.fillMaxWidth().height(48.dp)
            .semantics { contentDescription = "Kilometres per week, last 12 weeks" },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        weeks.forEachIndexed { i, km ->
            Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
                if (km > 0) Box(
                    Modifier.fillMaxWidth().fillMaxHeight(max(0.08f, (km / top).toFloat()))
                        .background(if (i == weeks.lastIndex) PsColor.primaryText else PsColor.primary, RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp)),
                )
            }
        }
    }
    HorizontalDivider(color = PsColor.borderStrong)
}

@Composable
private fun PaddleRow(p: PaddleCard, onOpen: (String) -> Unit) {
    val noGps = p.noGps == true
    Column(Modifier.card().clip(cardShape).clickable(onClickLabel = "Open this paddle") { onOpen(p.id) }) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (noGps) NoGpsTag() else RouteThumb(p.route)
            Column(Modifier.weight(1f)) {
                Text(
                    buildAnnotatedString {
                        append(fmtWeekday(p.paddledAt))
                        sourceLabel(p.sourceType)?.let { append(" · $it") }
                        p.boatClass?.let { withStyle(SpanStyle(color = PsColor.split)) { append(" · ${it.wire.ifEmpty { "?" }}") } }
                    },
                    color = PsColor.muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text("${paddleKm(p.distanceKm, noGps)} · ${fmtClock(p.durationS)}", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, fontFamily = PlexMono)
                val spm = p.avgSR?.let { "${it.roundToInt()} spm" }
                Text(
                    if (noGps) spm.orEmpty() else listOfNotNull("${split500(p.cruiseSpeed)} /500", spm).joinToString(" · "),
                    color = PsColor.muted, fontSize = 14.sp, fontFamily = PlexMono,
                )
                p.note?.let { Text(it, color = PsColor.split, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }
        // The same outing from another source, shown once under it.
        p.sameOuting.orEmpty().forEach { o ->
            HorizontalDivider(color = PsColor.border)
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(alsoRecordedBy(o.sourceType), color = PsColor.muted, fontSize = 14.sp)
                Spacer(Modifier.weight(1f))
            }
        }
    }
}
