package com.paddlesnitch.app.tracker

import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.PsRadius
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private data class Msg(val ok: Boolean, val text: String)

private enum class Phase { Start, Connecting, Pairing, Ready }

/**
 * Set up a tracker from the phone (docs/features/tracker-bluetooth-sync.md J3):
 * find it with the system's sheet, pair (the number on both screens, a hold on
 * the tracker), add it to your account, give it WiFi, and sync. The same steps
 * the website's /devices/bluetooth takes, through [Tracker].
 */
@Composable
fun TrackerSetupScreen(api: Api, onClose: () -> Unit, onSignedOut: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val account = remember { ApiTrackerAccount(api) }
    var phase by remember { mutableStateOf(Phase.Start) }
    var problem by remember { mutableStateOf<String?>(null) }
    var needsSettings by remember { mutableStateOf(false) }
    var tracker by remember { mutableStateOf<Tracker?>(null) }
    var link by remember { mutableStateOf<TrackerLink?>(null) }
    var about by remember { mutableStateOf<TrackerAbout?>(null) }
    var paired by remember { mutableStateOf(false) }
    var mine by remember { mutableStateOf(emptySet<String>()) }
    var device by remember { mutableStateOf<BluetoothDevice?>(null) }
    var remembered by remember { mutableStateOf(TrackerCompanion.remembered(context)) }
    var linking by remember { mutableStateOf(false) }
    var linkMsg by remember { mutableStateOf<Msg?>(null) }
    var ssid by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var wifiBusy by remember { mutableStateOf(false) }
    var wifiMsg by remember { mutableStateOf<Msg?>(null) }
    var syncing by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<SyncProgress?>(null) }
    var syncMsg by remember { mutableStateOf<Msg?>(null) }

    DisposableEffect(Unit) { onDispose { link?.close() } }

    fun reset(text: String?) {
        link?.close(); link = null; tracker = null; about = null; paired = false
        phase = Phase.Start; problem = text
    }

    fun signedOutOr(e: Throwable, say: () -> Unit) { if (e is SignedOut) onSignedOut() else if (e !is CancellationException) say() }

    fun pair() {
        val t = tracker ?: return
        scope.launch {
            phase = Phase.Pairing; problem = null
            if (!t.waitUntilPaired()) { phase = Phase.Ready; problem = Messages.PAIR_FAILED; return@launch }
            paired = true
            device?.let { TrackerCompanion.remember(context, it.address, t.name); remembered = it.address to t.name }
            runCatching { account.myTrackerIds() }.onSuccess { mine = it }.onFailure { e -> signedOutOr(e) {} }
            phase = Phase.Ready
        }
    }

    fun connect(d: BluetoothDevice) {
        device = d
        scope.launch {
            phase = Phase.Connecting; problem = null; linkMsg = null; wifiMsg = null; syncMsg = null
            try {
                val l = BleTrackerLink.connect(context, d)
                link = l
                val t = Tracker(l)
                val a = t.about() ?: return@launch reset(Messages.CANT_READ)
                tracker = t; about = a
                pair()
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                Log.w(TAG, "connect: $e")
                reset(if (e is TrackerError.NotThere) Messages.stale("the tracker") else "Couldn’t connect to the tracker. Make sure it’s switched on, close by and has Bluetooth on, then try again. ${Messages.TURN_ON}")
            }
        }
    }

    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r ->
        val d = if (r.resultCode == Activity.RESULT_OK) TrackerCompanion.chosen(context, r.data) else null
        if (d != null) connect(d) else reset(if (r.resultCode == Activity.RESULT_OK) Messages.NOT_FOUND else "No tracker chosen. If yours wasn’t in the list: ${Messages.TURN_ON}")
    }

    fun find() {
        problem = null; needsSettings = false
        when (TrackerCompanion.radio(context)) {
            TrackerCompanion.Radio.Missing -> return run { problem = Messages.NO_BLUETOOTH }
            TrackerCompanion.Radio.Off -> return run { problem = Messages.BLUETOOTH_OFF }
            TrackerCompanion.Radio.On -> {}
        }
        phase = Phase.Connecting
        TrackerCompanion.associate(context,
            onChooser = { chooser.launch(IntentSenderRequest.Builder(it).build()) },
            onFailure = { reset(Messages.NOT_FOUND) })
    }

    var next by remember { mutableStateOf<(() -> Unit)?>(null) }
    val enable = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (TrackerCompanion.radio(context) == TrackerCompanion.Radio.On) next?.invoke() else problem = Messages.BLUETOOTH_OFF
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.all { it }) next?.invoke() else { problem = Messages.PERMISSION; needsSettings = true }
    }

    /** Permission, then Bluetooth on, then [then]. Each refusal is explained. */
    fun ready(then: () -> Unit) {
        problem = null; needsSettings = false
        val afterPermission: () -> Unit = {
            if (TrackerCompanion.radio(context) == TrackerCompanion.Radio.Off) {
                next = then
                runCatching { enable.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)) }.onFailure { problem = Messages.BLUETOOTH_OFF }
            } else then()
        }
        if (TrackerCompanion.hasPermissions(context)) afterPermission()
        else { next = afterPermission; permission.launch(TrackerCompanion.permissions) }
    }

    fun addToAccount() {
        val t = tracker ?: return; val a = about ?: return
        scope.launch {
            linking = true; linkMsg = null
            try {
                when (val r = t.linkTo(account, a)) {
                    LinkOutcome.Linked -> { mine = mine + a.id; linkMsg = Msg(true, "Added to your account.") }
                    is LinkOutcome.Refused -> linkMsg = Msg(false, r.message)
                }
            } catch (e: Throwable) {
                // Pressing again starts over with a fresh token, which replaces anything half-done on both sides.
                signedOutOr(e) { linkMsg = Msg(false, if (e is TrackerError.NotThere) Messages.stale(t.name) else Messages.LINK_AGAIN) }
            } finally { linking = false }
        }
    }

    fun sendWifi() {
        val t = tracker ?: return
        Messages.wifiInput(ssid.trim(), pass)?.let { wifiMsg = Msg(false, it); return }
        scope.launch {
            wifiBusy = true; wifiMsg = null
            try {
                val st = t.tryWifi(ssid.trim(), pass)
                wifiMsg = if (st == null) Msg(false, Messages.WIFI_SILENT) else Msg(st == WifiState.Joined, Messages.wifi(st))
                if (st == WifiState.Joined) pass = ""
            } catch (e: Throwable) {
                signedOutOr(e) { wifiMsg = Msg(false, Messages.trouble(e, t.name)) }
            } finally { wifiBusy = false }
        }
    }

    fun sync() {
        val t = tracker ?: return; val a = about ?: return
        scope.launch {
            syncing = true; syncMsg = null; progress = null
            try {
                val r = t.sync(account, a) { progress = it }
                syncMsg = Msg(r.failed.none { it.second != FailReason.Unusable }, Messages.synced(r))
                runCatching { t.about() }.getOrNull()?.let { about = it }
            } catch (e: Throwable) {
                signedOutOr(e) { syncMsg = Msg(false, Messages.trouble(e, t.name)) }
            } finally { syncing = false; progress = null }
        }
    }

    Column(
        modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Your tracker", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f).semantics { heading() })
            TextButton(onClick = onClose) { Text(if (phase == Phase.Ready) "Done" else "Close") }
        }

        when (phase) {
            Phase.Start -> {
                Section {
                    Text("1. Turn on Bluetooth on the tracker", fontWeight = FontWeight.SemiBold)
                    Text(Messages.TURN_ON, color = PsColor.muted)
                    Text("2. Keep it next to this phone", fontWeight = FontWeight.SemiBold)
                    Text("Then press Find my tracker and choose it from the list (its name starts with PT-).", color = PsColor.muted)
                }
                BigButton("Find my tracker") { ready(::find) }
                remembered?.let { (address, name) ->
                    OutlinedButton(onClick = { ready { TrackerCompanion.byAddress(context, address)?.let(::connect) ?: run { problem = Messages.NOT_FOUND } } },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text("Connect to $name") }
                }
            }
            Phase.Connecting -> Waiting("Connecting to the tracker…")
            Phase.Pairing -> {
                Waiting("Pairing…")
                Section { Text(Messages.PAIR_HOW, style = MaterialTheme.typography.bodyLarge) }
            }
            Phase.Ready -> {}
        }

        problem?.let {
            Text(it, color = PsColor.red, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            if (needsSettings) OutlinedButton(onClick = {
                context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
            }) { Text("Open the app’s settings") }
            if (problem == Messages.BLUETOOTH_OFF) OutlinedButton(onClick = { ready(::find) }) { Text("Turn Bluetooth on") }
        }

        val t = tracker; val a = about
        if (phase == Phase.Ready && t != null && a != null) {
            Section {
                Text(t.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Fact("Recordings", Messages.waiting(a))
                Fact("Account", Messages.owner(ownership(a, mine)))
                Fact("Firmware", a.firmware)
                Fact("ID", a.id)
            }
            if (!paired) {
                BigButton("Try pairing again") { pair() }
                OutlinedButton(onClick = { reset(null) }, modifier = Modifier.fillMaxWidth()) { Text("Start again") }
                return@Column
            }

            Section {
                Text("Account", fontWeight = FontWeight.SemiBold)
                if (ownership(a, mine) == Ownership.Yours) Text("This tracker is on your account. Its recordings appear in Paddles.", color = PsColor.muted)
                else {
                    Text("Add the tracker to your account so its recordings appear in Paddles.", color = PsColor.muted)
                    BigButton(if (linking) "Adding…" else "Add to my account", enabled = !linking) { addToAccount() }
                }
                linkMsg?.let { Note(it) }
            }

            Section {
                Text("WiFi (optional)", fontWeight = FontWeight.SemiBold)
                Text("With WiFi the tracker uploads by itself at home. It tries the network first and keeps it only if it can join. 2.4 GHz networks only.", color = PsColor.muted)
                OutlinedTextField(ssid, { ssid = it }, label = { Text("Network name") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))
                OutlinedTextField(pass, { pass = it }, label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done))
                BigButton(if (wifiBusy) "Trying the network…" else "Send WiFi to the tracker", enabled = !wifiBusy && ssid.isNotBlank()) { sendWifi() }
                if (wifiBusy) Text("This takes up to 30 seconds.", color = PsColor.muted)
                wifiMsg?.let { Note(it) }
            }

            Section {
                Text("Recordings", fontWeight = FontWeight.SemiBold)
                Text("Sends the tracker’s waiting recordings to Paddles through this phone. Keep the app open and the tracker close until it finishes.", color = PsColor.muted)
                BigButton(if (syncing) "Syncing…" else "Sync now", enabled = !syncing && ownership(a, mine) == Ownership.Yours) { sync() }
                if (ownership(a, mine) != Ownership.Yours) Text("Add the tracker to your account first.", color = PsColor.muted)
                if (syncing) Text(progress?.let { "Recording ${it.index} of ${it.total} · piece ${it.part} of ${it.parts}" } ?: "Asking the tracker what it has…",
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                syncMsg?.let { Note(it) }
            }

            HorizontalDivider(color = PsColor.border)
            BigButton("Done") { onClose() }
        }
    }
}

@Composable
private fun Section(content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(PsRadius.sheet)
    Column(
        Modifier.fillMaxWidth().background(PsColor.surface, shape).border(1.dp, PsColor.border, shape).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) { content() }
}

@Composable
private fun BigButton(text: String, enabled: Boolean = true, onClick: () -> Unit) =
    Button(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text(text) }

@Composable
private fun Waiting(text: String) = Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    CircularProgressIndicator(Modifier.size(24.dp))
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
}

@Composable
private fun Fact(label: String, value: String) = Row {
    Text(label, color = PsColor.muted, modifier = Modifier.weight(0.4f))
    Text(value, modifier = Modifier.weight(0.6f))
}

@Composable
private fun Note(m: Msg) = Text(m.text, color = if (m.ok) PsColor.green else PsColor.red, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
