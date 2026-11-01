package com.paddlesnitch.app.record

import android.Manifest
import android.os.Build
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
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
const val LOCATION_OFF = "Location is off on this phone. Turn it on to record."
const val NO_MOTION_SENSORS = "No motion sensors on this phone, so no stroke rate"
const val WRITE_FAILED = "Couldn’t save the rest of this recording. What it saved so far will upload when you stop."
private const val ASKED = "askedLocation"
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

/** Whether recording can start: location allowed and switched on (mobile/contract/README.md § Recording screen). */
enum class LocationReady { Ready, Refused, Off }

/**
 * Off first: with location switched off nothing records, whatever the permission. Not yet
 * granted counts as Refused only once the app has asked (until then Start asks).
 */
fun locationReady(granted: Boolean, asked: Boolean, enabled: Boolean): LocationReady = when {
    !enabled -> LocationReady.Off
    !granted && asked -> LocationReady.Refused
    else -> LocationReady.Ready
}

/**
 * Record a paddle on the phone (docs/features/android-app.md, Recording). Connects
 * RecordScreen to RecordingService and asks for location (and notifications) first.
 * Once someone has said no, the screen says so in place of Start, with the way to the setting.
 */
@Composable
fun Record(accountId: suspend () -> String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by RecordingService.state.collectAsState()
    val prefs = remember { context.getSharedPreferences("recording", android.content.Context.MODE_PRIVATE) }
    fun readiness(): LocationReady = locationReady(
        granted = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED,
        asked = prefs.getBoolean(ASKED, false),
        enabled = context.getSystemService(android.location.LocationManager::class.java)?.isLocationEnabled != false,
    )
    var location by remember { mutableStateOf(readiness()) }
    // Coming back from the settings: look again.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(lifecycle) {
        val o = androidx.lifecycle.LifecycleEventObserver { _, e -> if (e == androidx.lifecycle.Lifecycle.Event.ON_RESUME) location = readiness() }
        lifecycle.lifecycle.addObserver(o)
        onDispose { lifecycle.lifecycle.removeObserver(o) }
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        prefs.edit().putBoolean(ASKED, true).apply()
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) RecordingService.start(context)
        else RecordingService.set(RecordingService.State.Idle)
        location = readiness()
    }
    RecordScreen(
        state = state,
        location = location,
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
        onLocationSettings = { runCatching { context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) } },
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
    location: LocationReady = LocationReady.Ready,
    onSettings: () -> Unit = {},
    onLocationSettings: () -> Unit = {},
    notificationsOn: Boolean = true,
    now: () -> Long = SystemClock::elapsedRealtime,
) {
    if (state is RecordingService.State.Recording) { Recording(state, onStop, notificationsOn, now, modifier); return }
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Record", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
        Text("Records your route and boat motion. Each recording uploads after you stop it.", color = PsColor.muted)
        Column(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // Without location there's nothing to start: say so in place of Start, with the way to the setting.
            when {
                location == LocationReady.Refused || state is RecordingService.State.Failed && state.locationRefused -> {
                    Text(RECORD_LOCATION_REFUSED, color = PsColor.red)
                    OutlinedButton(onClick = onSettings, colors = outlinedColors(), modifier = Modifier.heightIn(min = 48.dp)) { Text("Open the app’s settings") }
                }
                location == LocationReady.Off -> {
                    Text(LOCATION_OFF, color = PsColor.red)
                    OutlinedButton(onClick = onLocationSettings, colors = outlinedColors(), modifier = Modifier.heightIn(min = 48.dp)) { Text("Open location settings") }
                }
                state is RecordingService.State.Failed -> Text(RECORD_FAILED, color = PsColor.red)
            }
        }
        val blocked = location != LocationReady.Ready || state is RecordingService.State.Failed && state.locationRefused
        if (!blocked) {
            val starting = state is RecordingService.State.Starting
            Button(onClick = onStart, enabled = !starting, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp)) {
                Text(if (starting) "Start recording…" else "Start recording", fontSize = 18.sp)
            }
        }
    }
}

@Composable
private fun Recording(state: RecordingService.State.Recording, onStop: () -> Unit, notificationsOn: Boolean, now: () -> Long, modifier: Modifier) {
    val live by state.live.collectAsState()
    var elapsedMs by remember { mutableLongStateOf(now() - state.startedAt) }
    var writeFailed by remember { mutableStateOf(state.files.failedLines > 0) }
    LaunchedEffect(state.startedAt) {
        while (true) { elapsedMs = now() - state.startedAt; writeFailed = state.files.failedLines > 0; delay(1000) }
    }
    // Hold to stop stays pinned to the bottom; the rest scrolls above it (large text).
    Column(modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
    // A failed write shows in place of the heading, where it's seen first.
    Box(Modifier.semantics { liveRegion = LiveRegionMode.Assertive }) {
        if (writeFailed) Text(WRITE_FAILED, color = PsColor.red, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        else Text("Recording", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
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
    if (!state.motion) Text(NO_MOTION_SENSORS, color = PsColor.muted)
    Text(
        if (notificationsOn) "Keeps recording with the screen off. Stop here or from the notification." else NOTIFICATIONS_OFF,
        color = PsColor.muted,
    )
    }
    HoldToStop(onStop)
    }
}

/**
 * Stops only after [HOLD_TO_STOP_MS] held, filling as it goes: a wet hand or a
 * drybag mustn't end a paddle by brushing it. A tap says to keep holding.
 * TalkBack gets a named action, Stop recording, that stops at once.
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
                // TalkBack: "Hold to stop" as what it is, and a named action that stops at once.
                .clearAndSetSemantics {
                    role = Role.Button; contentDescription = "Hold to stop"
                    customActions = listOf(CustomAccessibilityAction("Stop recording") { onStop(); true })
                },
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
 * The way to Record from Paddles. While a recording runs it says so, with the
 * time, so closing the screen never hides it; a tap opens the screen again.
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
 * signed out with nothing recording. Stopping goes back to Paddles, where the upload shows.
 */
@Composable
fun WithRecording(
    signedIn: Boolean,
    modifier: Modifier = Modifier,
    record: @Composable () -> Unit,
    content: @Composable (entry: (@Composable () -> Unit)?) -> Unit,
) {
    val state by RecordingService.state.collectAsState()
    var open by rememberSaveable { mutableStateOf(false) }
    // Stopped: back to Paddles, where the recording's upload shows.
    LaunchedEffect(state) { if (state is RecordingService.State.Stopped) { open = false; RecordingService.forgetFinished() } }
    val reachable = signedIn || state is RecordingService.State.Recording
    if (open && reachable) {
        BackHandler { open = false }
        Column(modifier.fillMaxSize()) {
            // Close hides the screen; a recording carries on (README § Recording screen).
            TextButton(onClick = { open = false }, colors = textColors(), modifier = Modifier.padding(horizontal = 4.dp).heightIn(min = 48.dp)) {
                Text("Close", fontSize = 16.sp)
            }
            record()
        }
    } else {
        content(if (reachable) ({ RecordEntry(state, onOpen = { open = true }) }) else null)
    }
}
