package com.paddlesnitch.app.record

import android.Manifest
import android.os.Build
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
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

const val RECORD_FAILED = "Couldn’t start recording. Allow location for paddlesnitch, then try again."

/** The stroke rate as the core gives it: "—" until it has one (rc_phone_live is NaN until phase 2). */
fun liveStrokeRate(live: RecorderCore.Live?): String = live?.spm?.takeIf { !it.isNaN() }?.roundToInt()?.toString() ?: "—"

/**
 * Record a paddle on the phone (debug builds only until recordings upload:
 * docs/features/android-app.md, Recording). Connects RecordScreen to
 * RecordingService and asks for location (and notifications) first.
 */
@Composable
fun Record(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val state by RecordingService.state.collectAsState()
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) RecordingService.start(context)
        else RecordingService.failed()
    }
    RecordScreen(
        state = state,
        onStart = {
            ask.launch(buildList {
                add(Manifest.permission.ACCESS_FINE_LOCATION)
                add(Manifest.permission.ACCESS_COARSE_LOCATION)
                if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
            }.toTypedArray())
        },
        onStop = { RecordingService.stop(context) },
        modifier = modifier,
    )
}

@Composable
fun RecordScreen(
    state: RecordingService.State,
    onStart: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
    now: () -> Long = SystemClock::elapsedRealtime,
) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Record", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
        when (state) {
            is RecordingService.State.Recording -> Recording(state, onStop, now)
            else -> {
                Text("Records GPS and boat motion, with the screen off. Recordings stay on this phone for now.", color = PsColor.muted)
                Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
                    when (state) {
                        is RecordingService.State.Failed -> Text(RECORD_FAILED, color = PsColor.red)
                        is RecordingService.State.Stopped -> Text("Saved on this phone as ${state.files.track.name}.", color = PsColor.fg)
                        else -> {}
                    }
                }
                Button(onClick = onStart, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp)) { Text("Start recording", fontSize = 18.sp) }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Recording(state: RecordingService.State.Recording, onStop: () -> Unit, now: () -> Long) {
    val live by state.live.collectAsState()
    var elapsedMs by remember { mutableLongStateOf(now() - state.startedAt) }
    LaunchedEffect(state.startedAt) {
        while (true) { elapsedMs = now() - state.startedAt; delay(1000) }
    }
    val elapsed = fmtClock(elapsedMs / 1000.0)
    Tile("Elapsed", elapsed, "Elapsed, $elapsed")
    val spm = liveStrokeRate(live)
    Tile("Stroke rate", spm, if (spm == "—") "Stroke rate, not measured yet" else "Stroke rate, $spm strokes per minute")
    Text("Keeps recording with the screen off. Stop from here or from the notification.", color = PsColor.muted)
    // Hold, not tap: a wet hand or a drybag mustn't end a paddle by brushing it.
    Box(
        Modifier.fillMaxWidth().heightIn(min = 96.dp)
            .background(PsColor.red.copy(alpha = 0.18f), RoundedCornerShape(PsRadius.control))
            .combinedClickable(onClick = {}, onLongClick = onStop)
            .clearAndSetSemantics { role = Role.Button; contentDescription = "Hold to stop"; onLongClick("Stop recording") { onStop(); true } },
        contentAlignment = Alignment.Center,
    ) { Text("Hold to stop", color = PsColor.red, fontSize = 20.sp, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun Tile(label: String, value: String, spoken: String) =
    Column(Modifier.fillMaxWidth().card().padding(16.dp).clearAndSetSemantics { contentDescription = spoken }) {
        Eyebrow(label)
        Text(value, fontFamily = PlexMono, fontSize = 40.sp, color = PsColor.fg)
    }
