package com.paddlesnitch.app.tracker

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.api.AccountApi
import com.paddlesnitch.app.api.Recording
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.api.Tracker
import com.paddlesnitch.app.api.TrackerList
import com.paddlesnitch.app.api.TrackerSummary
import com.paddlesnitch.app.api.shown
import com.paddlesnitch.app.paddles.fmtAgo
import com.paddlesnitch.app.paddles.fmtDay
import com.paddlesnitch.app.paddles.fmtDayTime
import com.paddlesnitch.app.paddles.fmtDist
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.PlexMono
import kotlinx.coroutines.launch

/**
 * Your trackers, as the website's /devices: one card each, worked out by the server
 * (`summaries`: never recomputed here), then one tracker's recordings and Remove.
 */
@Composable
fun TrackersScreen(
    api: AccountApi, onBack: () -> Unit, onSetUp: () -> Unit, onSignedOut: () -> Unit, modifier: Modifier = Modifier,
    /** A recording that became a paddle opens it in Paddles. */
    onOpenPaddle: (String) -> Unit = {},
    /** For "seen 3m ago"; tests fix it. */
    now: () -> Long = System::currentTimeMillis,
) {
    var list by remember { mutableStateOf<TrackerList?>(null) }
    var recordings by remember { mutableStateOf<List<Recording>?>(null) }
    var failed by remember { mutableStateOf<String?>(null) }
    var recordingsFailed by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    var removed by remember { mutableStateOf<String?>(null) }
    // Kept here, so coming back from a tracker returns to the same place in the list.
    val scroll = rememberScrollState()
    LaunchedEffect(attempt) {
        failed = null; recordingsFailed = null
        runCatching { api.trackers() }
            .onSuccess { list = it }
            // A failed load is said as such: "no trackers" would tell owners they have none.
            .onFailure { if (it is SignedOut) onSignedOut() else failed = it.shown("Couldn’t load your trackers. Please try again.") }
        // Apart, so a failure here still shows the trackers; it's said on a tracker's own page.
        runCatching { api.recordings().sessions }
            .onSuccess { recordings = it }
            .onFailure { if (it is SignedOut) onSignedOut() else recordingsFailed = it.shown("Couldn’t load the recordings. Please try again.") }
    }
    val l = list
    val shown = open?.let { id -> l?.summaries?.firstOrNull { it.deviceId == id } }
    if (shown != null && l != null) {
        BackHandler { open = null }
        TrackerScreen(api, shown, l.devices.firstOrNull { it.deviceId == shown.deviceId }, recordings?.filter { it.deviceId == shown.deviceId },
            recordingsFailed, onRetry = { attempt++ },
            onBack = { open = null }, onRemoved = { open = null; removed = "Tracker removed."; attempt++ }, onSignedOut = onSignedOut, onOpenPaddle = onOpenPaddle, modifier = modifier)
        return
    }
    Column(modifier.fillMaxWidth().verticalScroll(scroll).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Header("Devices", onBack)
        Text("Your paddlesnitch trackers and what each one has recorded.", color = PsColor.muted)
        // Always in the layout, so TalkBack hears that a tracker was removed.
        Box(Modifier.fillMaxWidth().testTag("trackers-message").semantics { liveRegion = LiveRegionMode.Polite }) { removed?.let { Text(it, color = PsColor.green) } }
        when {
            failed != null -> {
                Text(failed!!, color = PsColor.red, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
                Button(onClick = { attempt++ }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Try again") }
            }
            l == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.semantics { contentDescription = "Loading your trackers" })
            }
            l.summaries.isEmpty() -> Column(Modifier.card().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("No trackers yet", fontWeight = FontWeight.Medium)
                Text("A paddlesnitch tracker records your paddle and uploads it over WiFi by itself. Add one with the code on its screen.", color = PsColor.muted)
                SetUp(onSetUp)
            }
            else -> {
                l.summaries.forEach { s -> TrackerCard(s, l.devices.firstOrNull { it.deviceId == s.deviceId }, now(), onOpen = { open = s.deviceId }) }
                Text("Each tracker’s paddles appear in Paddles by themselves. To remove a tracker, open it.", color = PsColor.muted)
            }
        }
        if (l?.summaries?.isEmpty() != true) SetUp(onSetUp)
    }
}

@Composable
private fun SetUp(onSetUp: () -> Unit) = OutlinedButton(onClick = onSetUp, modifier = Modifier.heightIn(min = 48.dp),
    colors = ButtonDefaults.outlinedButtonColors(contentColor = PsColor.primaryText)) { Text("Set up or sync a tracker") }

/** The arrow on something that opens, as the website's Chevron; TalkBack has the button role instead. */
@Composable
private fun Chevron() = Text("›", color = PsColor.muted, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.clearAndSetSemantics {})

/** One tracker, as the website's card: every number from the summary; the version and last word from its device record. */
@Composable
private fun TrackerCard(s: TrackerSummary, device: Tracker?, now: Long, onOpen: () -> Unit) {
    Row(Modifier.card().clickable(role = Role.Button, onClick = onOpen).padding(horizontal = 16.dp, vertical = 12.dp).testTag("tracker-${s.deviceId}"),
        verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Text(s.name, fontWeight = FontWeight.Medium)
            if (!s.linked) Badge("removed")
        }
        if (s.linked) Text(statusLine(s, device, now), style = MaterialTheme.typography.bodySmall, fontFamily = PlexMono)
        Text(recordingsLine(s), color = PsColor.muted, style = MaterialTheme.typography.bodySmall, fontFamily = PlexMono)
        // The id is for support, not for recognising your tracker: last, small.
        Text(s.deviceId + (device?.model?.let { " · $it" } ?: ""), color = PsColor.muted, style = MaterialTheme.typography.labelSmall, fontFamily = PlexMono)
    }
    Chevron()
    }
}

/** "firmware 0.19.3 · beta · up to date · seen 3m ago · crashed 2h ago (uplink)", coloured as on the website. */
private fun statusLine(s: TrackerSummary, device: Tracker?, now: Long) = buildAnnotatedString {
    withStyle(SpanStyle(color = PsColor.muted)) { append("firmware ") }
    append(device?.firmware?.takeIf { it.isNotBlank() } ?: "unknown")
    if (device?.beta == true) withStyle(SpanStyle(color = PsColor.split)) { append(" · beta") }
    when (s.firmwareState) {
        TrackerSummary.FirmwareState.UpdatePending -> withStyle(SpanStyle(color = PsColor.split)) {
            append(" · update pending")
            val target = device?.targetVersion
            if (target != null) append(" ($target)")
        }
        TrackerSummary.FirmwareState.UpToDate -> withStyle(SpanStyle(color = PsColor.green)) { append(" · up to date") }
        else -> {} // unknown: never shown as up to date
    }
    withStyle(SpanStyle(color = PsColor.muted)) { append(" · seen ") }
    withStyle(SpanStyle(color = if (s.quiet) PsColor.red else PsColor.fg)) {
        append(fmtAgo(device?.lastSeenAt, now))
        // In words too, not by colour alone.
        if (s.quiet) append(" · quiet")
    }
    val c = s.crash
    if (c != null) withStyle(SpanStyle(color = PsColor.red)) {
        append(" · crashed ${fmtAgo(c.at, now)}")
        if (c.task.isNotBlank()) append(" (${c.task})")
    }
}

/** "12 recordings · 84.21 km · 9 with boat motion · latest 24 Oct 2026". */
internal fun recordingsLine(s: TrackerSummary): String {
    if (s.recordings == 0L) return "no recordings yet"
    return buildString {
        append("${s.recordings} recording${if (s.recordings == 1L) "" else "s"}")
        if (s.distanceMetres > 0) append(" · ${fmtDist(s.distanceMetres.toDouble())}")
        if (s.motionRecordings > 0) append(" · ${s.motionRecordings} with boat motion")
        s.latestAt?.let { append(" · latest ${fmtDay(it)}") }
    }
}

/** One tracker: what it has recorded, and Remove. */
@Composable
private fun TrackerScreen(
    api: AccountApi, s: TrackerSummary, device: Tracker?, recordings: List<Recording>?, recordingsFailed: String?, onRetry: () -> Unit,
    onBack: () -> Unit, onRemoved: () -> Unit, onSignedOut: () -> Unit, onOpenPaddle: (String) -> Unit, modifier: Modifier,
) {
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Header(s.name, onBack, back = "Devices")
        Text(listOfNotNull(s.deviceId, device?.model, device?.firmware?.let { "firmware $it" }, device?.lastSeenAt?.let { "last seen ${fmtDay(it)}" }).joinToString(" · "),
            color = PsColor.muted, style = MaterialTheme.typography.bodySmall, fontFamily = PlexMono)
        if (!s.linked) Text("This tracker is no longer on your account, but its recordings are still yours. Add it again to get new ones.",
            color = PsColor.muted, modifier = Modifier.card().padding(16.dp))
        Text("Recordings", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
        Text("Each paddle opens in Paddles. A recording where the boat barely moved (a test at home) stays here.", color = PsColor.muted)
        when {
            recordingsFailed != null -> {
                Text(recordingsFailed, color = PsColor.red, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
                Button(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Text("Try again") }
            }
            recordings == null -> CircularProgressIndicator(Modifier.semantics { contentDescription = "Loading the recordings" })
            recordings.isEmpty() -> Text("No recordings yet. The tracker uploads them by itself when it’s switched on in range of your WiFi.", color = PsColor.muted)
        }
        recordings.orEmpty().forEach { r ->
            val paddle = r.paddleId
            val line = fmtDayTime(r.startedAt ?: r.uploadedAt) + (r.distanceMetres?.takeIf { it > 0 }?.let { " · ${fmtDist(it)}" } ?: "")
            if (paddle != null) Row(Modifier.card().clickable(role = Role.Button) { onOpenPaddle(paddle) }
                .padding(horizontal = 16.dp, vertical = 12.dp).testTag("recording-${r.sessionId}"), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(line, fontFamily = PlexMono)
                    Text("paddle" + (if (r.motion != null) " · with boat motion" else ""), color = PsColor.muted, style = MaterialTheme.typography.bodySmall)
                }
                Chevron()
            }
            // Not a paddle: nothing to open here yet, so it doesn't look like a button.
            else Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).testTag("recording-${r.sessionId}")) {
                Text(line, color = PsColor.muted, fontFamily = PlexMono)
                Text("not a paddle · ${r.filename}", color = PsColor.muted, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (s.linked) RemoveTracker(api, s.deviceId, onRemoved, onSignedOut)
    }
}

/** Asks once, as on the website. The tracker stops uploading until added again; its recordings stay. */
@Composable
private fun RemoveTracker(api: AccountApi, deviceId: String, onRemoved: () -> Unit, onSignedOut: () -> Unit) {
    var confirming by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    if (!confirming) {
        OutlinedButton(onClick = { confirming = true }, colors = ButtonDefaults.outlinedButtonColors(contentColor = PsColor.red),
            modifier = Modifier.heightIn(min = 48.dp)) { Text("Remove tracker") }
        return
    }
    Column(Modifier.fillMaxWidth().border(1.dp, PsColor.red, RoundedCornerShape(6.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Remove this tracker? It stops uploading until you add it again. Its recordings stay yours.")
        Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Assertive }) { error?.let { Text(it, color = PsColor.red) } }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(enabled = !busy, colors = ButtonDefaults.outlinedButtonColors(contentColor = PsColor.red), onClick = {
                busy = true; error = null
                scope.launch {
                    runCatching { api.removeTracker(deviceId) }
                        .onSuccess { onRemoved() }
                        .onFailure { if (it is SignedOut) onSignedOut() else error = "Couldn’t remove the tracker. Please try again." }
                    busy = false
                }
            }) { Text(if (busy) "Removing…" else "Remove") }
            TextButton(enabled = !busy, colors = ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText), onClick = { confirming = false; error = null }) { Text("Cancel") }
        }
    }
}

@Composable
private fun Header(title: String, onBack: () -> Unit, back: String = "Done") = Row(verticalAlignment = Alignment.CenterVertically) {
    Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f).semantics { heading() })
    TextButton(onClick = onBack, colors = ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText)) { Text(back) }
}

@Composable
private fun Badge(text: String) = Text(text, color = PsColor.muted, style = MaterialTheme.typography.labelMedium,
    modifier = Modifier.border(1.dp, PsColor.borderStrong, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))

private fun Modifier.card() = fillMaxWidth().background(PsColor.surface, RoundedCornerShape(6.dp)).border(1.dp, PsColor.borderStrong, RoundedCornerShape(6.dp))
