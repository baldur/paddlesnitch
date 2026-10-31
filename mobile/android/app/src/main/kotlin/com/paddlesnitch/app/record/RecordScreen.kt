package com.paddlesnitch.app.record

import android.Manifest
import android.os.Build
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.saveable.rememberSaveable
import com.paddlesnitch.app.BuildConfig
import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import com.paddlesnitch.app.ui.textColors
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import com.paddlesnitch.app.ui.outlinedColors
import kotlinx.coroutines.launch
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.paddlesnitch.app.paddles.Eyebrow
import com.paddlesnitch.app.paddles.card
import com.paddlesnitch.app.paddles.fmtClock
import com.paddlesnitch.app.ui.PlexMono
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.PsRadius
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

const val RECORD_LOCATION_REFUSED = "Couldn’t start recording without location. Allow location for paddlesnitch in the app’s settings."
const val RECORD_FAILED = "Couldn’t start recording. Please try again."
const val NOTIFICATIONS_OFF = "Notifications are off for paddlesnitch, so stop the recording here."
const val KEEP_HOLDING = "Keep holding to stop."

/** How long "Hold to stop" must be held: long enough that a brush or a drybag doesn't end a paddle. */
const val HOLD_TO_STOP_MS = 1500

/** The GPS line: what it shows, and what a screen reader reads for it. */
data class GpsLine(val shown: String, val spoken: String)

/**
 * The GPS line under the time, from the core's live values (rc_live_values.fix and
 * since_fix_s, 0.4.0), in the words lead and copy-style set for both apps
 * (#761, Phone recording). Never worked out in the app.
 */
fun gpsLine(live: RecorderCore.Live?): GpsLine {
    if (live == null || (!live.fix && live.sinceFixS.isNaN())) return GpsLine("Waiting for GPS", "Waiting for GPS")
    if (live.fix) return GpsLine("GPS fix", "GPS fix")
    val s = live.sinceFixS
    if (s < 1) return GpsLine("GPS lost", "GPS lost")
    if (s < 60) { val n = s.toInt(); return GpsLine("GPS lost $n s ago", "GPS lost $n ${if (n == 1) "second" else "seconds"} ago") }
    val m = (s / 60).toInt()   // whole minutes, rounded down, and still minutes past an hour
    return GpsLine("GPS lost $m min ago", "GPS lost $m ${if (m == 1) "minute" else "minutes"} ago")
}

/**
 * What to announce once when the GPS state changes from [before] to [now]: "GPS lost" as
 * it goes, "GPS back" when it returns after a loss, otherwise nothing (the line itself is
 * not a live region, so the count never talks every second).
 */
fun gpsAnnouncement(before: RecorderCore.Live?, now: RecorderCore.Live?): String? {
    fun lost(l: RecorderCore.Live?) = l != null && !l.fix && !l.sinceFixS.isNaN()
    return when {
        lost(now) && !lost(before) -> "GPS lost"
        now?.fix == true && lost(before) -> "GPS back"
        else -> null
    }
}

/** The stroke rate as the core gives it: "—" until it has one (rc_phone_live is NaN until phase 2). */
fun liveStrokeRate(live: RecorderCore.Live?): String = live?.spm?.takeIf { !it.isNaN() }?.roundToInt()?.toString() ?: "—"

/**
 * Record a paddle on the phone (debug builds only until recordings upload:
 * docs/features/android-app.md, Recording). Connects RecordScreen to
 * RecordingService and asks for location (and notifications) first.
 */
@Composable
fun Record(accountId: suspend () -> String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by RecordingService.state.collectAsState()
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) RecordingService.start(context)
        else RecordingService.set(RecordingService.State.Failed(locationRefused = true))
    }
    RecordScreen(
        state = state,
        onStart = {
            RecordingService.set(RecordingService.State.Starting)
            scope.launch {
                // The recording goes in this account's folder; a sign-in from before ids were kept asks once.
                if (runCatching { accountId() }.isFailure) { RecordingService.set(RecordingService.State.Failed(locationRefused = false)); return@launch }
                ask.launch(buildList {
                    add(Manifest.permission.ACCESS_FINE_LOCATION)
                    add(Manifest.permission.ACCESS_COARSE_LOCATION)
                    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
                }.toTypedArray())
            }
        },
        onStop = { RecordingService.stop(context) },
        onSettings = {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
        },
        notificationsOn = context.getSystemService(NotificationManager::class.java).areNotificationsEnabled(),
        modifier = modifier,
    )
}

@Composable
fun RecordScreen(
    state: RecordingService.State,
    onStart: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
    onSettings: () -> Unit = {},
    notificationsOn: Boolean = true,
    now: () -> Long = SystemClock::elapsedRealtime,
) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Record", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
        when (state) {
            is RecordingService.State.Recording -> Recording(state, onStop, notificationsOn, now)
            else -> {
                Text("Records your route and boat motion. Recordings stay on this phone for now.", color = PsColor.muted)
                Column(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    when (state) {
                        is RecordingService.State.Failed -> {
                            Text(if (state.locationRefused) RECORD_LOCATION_REFUSED else RECORD_FAILED, color = PsColor.red)
                            if (state.locationRefused) OutlinedButton(onClick = onSettings, colors = outlinedColors()) { Text("Open the app’s settings") }
                        }
                        is RecordingService.State.Stopped -> Text("Recording saved on this phone (${fmtClock(state.elapsedMs / 1000.0)}).", color = PsColor.fg)
                        else -> {}
                    }
                }
                val starting = state is RecordingService.State.Starting
                Button(onClick = onStart, enabled = !starting, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp)) {
                    Text(if (starting) "Start recording…" else "Start recording", fontSize = 18.sp)
                }
            }
        }
    }
}

@Composable
private fun Recording(state: RecordingService.State.Recording, onStop: () -> Unit, notificationsOn: Boolean, now: () -> Long) {
    val live by state.live.collectAsState()
    var elapsedMs by remember { mutableLongStateOf(now() - state.startedAt) }
    LaunchedEffect(state.startedAt) {
        while (true) { elapsedMs = now() - state.startedAt; delay(1000) }
    }
    val elapsed = fmtClock(elapsedMs / 1000.0)
    Tile("Elapsed", elapsed, "Elapsed, $elapsed")
    val gps = gpsLine(live)
    val view = LocalView.current
    var before by remember { mutableStateOf<RecorderCore.Live?>(null) }
    LaunchedEffect(live) {
        gpsAnnouncement(before, live)?.let { @Suppress("DEPRECATION") view.announceForAccessibility(it) }
        before = live
    }
    Text(gps.shown, color = if (live?.fix == true) PsColor.muted else PsColor.red, fontSize = 18.sp,
        modifier = Modifier.clearAndSetSemantics { contentDescription = gps.spoken })
    val spm = liveStrokeRate(live)
    Tile("Stroke rate", spm, if (spm == "—") "Stroke rate, not measured yet" else "Stroke rate, $spm strokes per minute")
    Text(
        if (notificationsOn) "Keeps recording with the screen off. Stop here or from the notification." else NOTIFICATIONS_OFF,
        color = PsColor.muted,
    )
    HoldToStop(onStop)
}

/**
 * Stops only after [HOLD_TO_STOP_MS] held, filling as it goes: a wet hand or a
 * drybag mustn't end a paddle by brushing it. A tap says to keep holding.
 * TalkBack gets a long-press action that stops at once.
 */
@Composable
private fun HoldToStop(onStop: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val fill = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var hint by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier.fillMaxWidth().heightIn(min = 96.dp)
                .background(PsColor.red.copy(alpha = 0.18f), RoundedCornerShape(PsRadius.control))
                .drawBehind { drawRect(PsColor.red.copy(alpha = 0.35f), size = size.copy(width = size.width * fill.value)) }
                .pointerInput(Unit) {
                    detectTapGestures(onPress = {
                        hint = false
                        val held = scope.launch { fill.animateTo(1f, tween(HOLD_TO_STOP_MS, easing = LinearEasing)) }
                        val released = tryAwaitRelease()
                        if (fill.value >= 1f) {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            onStop()
                        } else {
                            held.cancel()
                            if (released) hint = true
                            scope.launch { fill.animateTo(0f, tween(150)) }
                        }
                    })
                }
                .clearAndSetSemantics { role = Role.Button; contentDescription = "Hold to stop"; onLongClick("Stop recording") { onStop(); true } },
            contentAlignment = Alignment.Center,
        ) { Text("Hold to stop", color = PsColor.red, fontSize = 20.sp, fontWeight = FontWeight.SemiBold) }
        Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
            if (hint) Text(KEEP_HOLDING, color = PsColor.muted)
        }
    }
}
@Composable
private fun Tile(label: String, value: String, spoken: String) =
    Column(Modifier.fillMaxWidth().card().padding(16.dp).clearAndSetSemantics { contentDescription = spoken }) {
        Eyebrow(label)
        Text(value, fontFamily = PlexMono, fontSize = 40.sp, color = PsColor.fg)
    }

/**
 * The way to Record from Paddles (debug builds only, for now). While a
 * recording runs it says so, with the time, so leaving the screen never hides it.
 */
@Composable
fun RecordEntry(state: RecordingService.State, onOpen: () -> Unit, now: () -> Long = SystemClock::elapsedRealtime) {
    val recording = state as? RecordingService.State.Recording
    var label by remember { mutableStateOf("Record a paddle") }
    LaunchedEffect(recording?.startedAt) {
        while (true) {
            label = recording?.let { "Recording · ${fmtClock((now() - it.startedAt) / 1000.0)}" } ?: "Record a paddle"
            if (recording == null) break
            delay(1000)
        }
    }
    TextButton(onClick = onOpen, colors = if (recording != null) ButtonDefaults.textButtonColors(contentColor = PsColor.red) else textColors(),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text(label, fontSize = 16.sp, modifier = Modifier.weight(1f))
        Text("→", fontSize = 16.sp)
    }
}

/**
 * Puts Record above every screen. While a recording runs, its screen and Hold to stop
 * survive anything that changes the screen underneath, a forced sign-out included (a
 * refused token refresh signs out by itself: #702). [content] gets the Paddles row to
 * show ("Record a paddle", or "Recording · h:mm:ss"), or null when there's nothing to offer:
 * release builds, and signed out with nothing recording.
 */
@Composable
fun WithRecording(
    signedIn: Boolean,
    modifier: Modifier = Modifier,
    canRecord: Boolean = BuildConfig.DEBUG,
    record: @Composable () -> Unit,
    content: @Composable (entry: (@Composable () -> Unit)?) -> Unit,
) {
    val state by RecordingService.state.collectAsState()
    var open by rememberSaveable { mutableStateOf(false) }
    val reachable = canRecord && (signedIn || state is RecordingService.State.Recording)
    if (open && reachable) {
        BackHandler { open = false }
        Column(modifier.fillMaxSize()) {
            TextButton(onClick = { open = false }, colors = textColors(), modifier = Modifier.padding(horizontal = 4.dp).heightIn(min = 48.dp)) {
                Text("← Paddles", fontSize = 16.sp)
            }
            record()
        }
    } else {
        content(if (reachable) ({ RecordEntry(state, onOpen = { open = true }) }) else null)
    }
}
