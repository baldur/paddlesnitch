package com.paddlesnitch.app.record

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.paddles.fmtDayTime
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.outlinedColors
import com.paddlesnitch.app.ui.textColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

const val UPLOAD_FAILED = "Couldn’t upload this recording. It’s kept on this phone."
const val NO_FIX = "No GPS fix, so this didn’t become a paddle"
const val PHONE_REMOVED = "This phone was removed from your account"

/**
 * The account's recordings that aren't paddles yet, one line each, on Paddles under Record
 * (mobile/contract/README.md § After Stop). Read from the account's folder each time an
 * upload changes something; the upload itself runs in Uploads.
 */
@Composable
fun UploadLines(accountId: String, onReport: () -> Unit) {
    val context = LocalContext.current
    val changed by Uploads.changed.collectAsState()
    val state by RecordingService.state.collectAsState()
    val running = (state as? RecordingService.State.Recording)?.files?.track
    var lines by remember { mutableStateOf(emptyList<UploadLine>()) }
    LaunchedEffect(accountId, changed, running) {
        lines = withContext(Dispatchers.IO) { PhoneUploader.lines(Uploads.dir(context, accountId), running) }
    }
    val online = rememberOnline(context)
    UploadLinesView(lines, online,
        onUploadNow = { Uploads.allowAddingAndSchedule(context, accountId) },
        onDismiss = { base -> PhoneUploader.dismiss(Uploads.dir(context, accountId), base); Uploads.bump(false) },
        onReport = onReport)
}

@Composable
fun UploadLinesView(lines: List<UploadLine>, online: Boolean, onUploadNow: () -> Unit, onDismiss: (String) -> Unit, onReport: () -> Unit) {
    // Always in the layout, so TalkBack hears a line that comes or changes.
    Column(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (line in lines) when (line) {
            is UploadLine.Waiting -> Text(listOfNotNull(day(line.at), if (online) "Uploading…" else "Waiting to upload").joinToString(" · "), color = PsColor.muted)
            is UploadLine.NoFix -> Column {
                Text(listOfNotNull(day(line.at), NO_FIX).joinToString(" · "), color = PsColor.fg)
                TextButton(onClick = { onDismiss(line.base) }, colors = textColors(), modifier = Modifier.heightIn(min = 48.dp)) { Text("Dismiss") }
            }
            is UploadLine.Failed -> Column {
                Text(listOfNotNull(day(line.at), UPLOAD_FAILED).joinToString(" · "), color = PsColor.red)
                TextButton(onClick = onReport, colors = textColors(), modifier = Modifier.heightIn(min = 48.dp)) { Text("Report an issue") }
            }
            is UploadLine.PhoneOff -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(line.said ?: PHONE_REMOVED, color = PsColor.fg)
                OutlinedButton(onClick = onUploadNow, colors = outlinedColors(), modifier = Modifier.heightIn(min = 48.dp)) { Text("Upload now") }
            }
        }
    }
}

private fun day(at: String?) = at?.let { runCatching { fmtDayTime(it) }.getOrNull() }

/** Whether the phone has a network now, followed as it changes. */
@Composable
private fun rememberOnline(context: Context): Boolean {
    val cm = remember { context.getSystemService(ConnectivityManager::class.java) }
    fun now() = cm?.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    var online by remember { mutableStateOf(now()) }
    DisposableEffect(cm) {
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { online = true }
            override fun onLost(network: Network) { online = now() }
        }
        runCatching { cm?.registerDefaultNetworkCallback(cb) }
        onDispose { runCatching { cm?.unregisterNetworkCallback(cb) } }
    }
    return online
}
