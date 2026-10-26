package com.paddlesnitch.app.account

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.layout.widthIn
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.platform.LocalView
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.activity.compose.LocalActivity
import com.paddlesnitch.app.api.StravaHistory
import com.paddlesnitch.app.api.HistorySpan
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import com.paddlesnitch.app.auth.VerifierStore
import com.paddlesnitch.app.api.StravaStatus
import com.paddlesnitch.app.Reauth
import com.paddlesnitch.app.R
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.Image
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.BuildConfig
import com.paddlesnitch.app.api.AccountApi
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.AuthUser
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.api.shown
import com.paddlesnitch.app.ui.Notice
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.switchColors
import com.paddlesnitch.app.ui.fieldColors
import com.paddlesnitch.app.ui.outlinedColors
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A website page, and whether it needs the website's sign-in. */
data class AccountLink(val label: String, val path: String, val signedIn: Boolean = true)

/** Help and the legal pages, which stay on the website. */
val aboutPages = listOf(
    AccountLink("Help", "/help", signedIn = false),
    AccountLink("Privacy", "/privacy", signedIn = false),
    AccountLink("Terms of Service", "/terms", signedIn = false),
)

/**
 * The sign-in email of an account made through Strava, which shares no email.
 * TODO(C5 Strava PR): use Contact.placeholderEmail instead (the website's isSyntheticStravaEmail).
 */
fun isPlaceholderEmail(email: String) = Regex("^strava-\\d+@noreply\\.paddlesnitch\\.com$", RegexOption.IGNORE_CASE).matches(email)

/** Where "Download my data" keeps the file between fetching and saving it. Personal data: [clearExport] whenever it isn't needed. */
fun exportFile(context: Context) = File(context.cacheDir, "account-export.json")
fun clearExport(context: Context) { exportFile(context).delete() }

/**
 * Account, as the website's /account: your details, public profile, Strava
 * and trackers (on the website for now), help, signing out, then your data
 * and deleting the account last.
 */
@Composable
fun AccountScreen(
    api: AccountApi, onBack: () -> Unit, onTracker: () -> Unit, onTrackers: () -> Unit, onSignOut: () -> Unit, onSignedOut: () -> Unit, onDeleted: () -> Unit,
    modifier: Modifier = Modifier,
    /** Back from signing in again: open Delete account, or show Strava, at once. */
    resume: Reauth.After? = null, onResumed: () -> Unit = {},
    /** Sign out and in again (Strava when [strava]), then come back with [resume]. */
    onSignInAgain: (userId: String, email: String?, strava: Boolean, then: Reauth.After) -> Unit = { _, _, _, _ -> },
    /** Connecting Strava came back to the app (com.paddlesnitch.app:/account/strava…). */
    stravaReturn: String? = null, onStravaReturnHandled: () -> Unit = {},
    /** Keeps the connect verifier; SharedPreferences unless a test gives one. */
    connectVerifiers: VerifierStore? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val connect = remember { StravaConnect(api, connectVerifiers ?: PrefsConnectVerifierStore(context)) }
    var user by remember { mutableStateOf<AuthUser?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(attempt) {
        loadError = null
        runCatching { api.me().user ?: throw SignedOut() }.onSuccess { user = it }
            .onFailure { if (it is SignedOut) onSignedOut() else loadError = it.shown("Couldn’t load your account. Please try again.") }
    }
    /** Runs [work]; a session that has ended goes back to signing in. */
    fun act(fallback: String, onError: (String) -> Unit = { error = it }, work: suspend () -> Unit): Job = scope.launch {
        runCatching { work() }.onFailure { if (it is SignedOut) onSignedOut() else onError(it.shown(fallback)) }
    }
    fun open(page: AccountLink) = act("Couldn’t open that page. Please try again.") {
        openTab(context, if (page.signedIn) api.signedInPage(page.path) else BuildConfig.API_BASE_URL + page.path)
    }

    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Account", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f).semantics { heading() })
            TextButton(onClick = onBack, colors = linkColors()) { Text("Done") }
        }
        val u = user
        if (u == null) {
            // Nothing below the header until we know whose account this is, so nothing jumps under a finger.
            if (loadError != null) {
                Message(loadError, red = true)
                Button(onClick = { attempt++ }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Try again") }
            } else Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            return@Column
        }
        fun signInAgain(then: Reauth.After) { val strava = isPlaceholderEmail(u.email); onSignInAgain(u.id, u.email.takeUnless { strava }, strava, then) }
        Message(error, red = true)
        Details(api, u, ::act)
        Divider()
        PublicProfile(api, u, ::act, onPreview = { path -> open(AccountLink("", path)) })
        Divider()
        StravaSection(api, ::act, connect, resume == Reauth.After.ConnectStrava, onResumed, stravaReturn, onStravaReturnHandled,
            onSignInAgain = { signInAgain(Reauth.After.ConnectStrava) }, onSignedOut = onSignedOut,
            stravaOnly = isPlaceholderEmail(u.email))
        Divider()
        Section("Trackers")
        Link("Your trackers", onClick = onTrackers)
        Link("Set up or sync a tracker", onClick = onTracker)
        Divider()
        aboutPages.forEach { Link("${it.label} ↗") { open(it) } }
        Link("Sign out", onClick = onSignOut)
        Divider()
        YourData(api, ::act)
        Divider()
        DeleteAccount(api, ::act, resume == Reauth.After.Delete, onResumed, onSignInAgain = { signInAgain(Reauth.After.Delete) }, onDeleted)
    }
}

private typealias Act = (fallback: String, onError: (String) -> Unit, work: suspend () -> Unit) -> Job

/** A message screen readers hear when it changes: the live region stays in the layout even when empty. */
@Composable
private fun Message(text: String?, red: Boolean = false, tag: String? = null, green: Boolean = false) =
    Box(Modifier.fillMaxWidth().semantics { liveRegion = if (red) LiveRegionMode.Assertive else LiveRegionMode.Polite }
        .then(if (tag != null) Modifier.testTag(tag) else Modifier)) {
        if (text != null) Text(text, color = if (red) PsColor.red else if (green) PsColor.green else PsColor.muted)
    }

/** A section's own load, so a failed load never looks like "nothing set". */
private class Load {
    var done by mutableStateOf(false)
    var failed by mutableStateOf<String?>(null)
    var attempt by mutableIntStateOf(0)
}

@Composable
private fun LoadState(load: Load) {
    if (load.failed != null) {
        Message(load.failed, red = true)
        TextButton(colors = linkColors(), onClick = { load.attempt++ }) { Text("Try again") }
    } else CircularProgressIndicator(Modifier.padding(8.dp))
}

@Composable
private fun Details(api: AccountApi, user: AuthUser, act: Act) {
    Section("Your details")
    Field("Email", user.email)
    Field("Display name", user.displayName)
    // For support: the one id we can look an account up by, so it can be copied.
    Column {
        Text("Support ID", color = PsColor.muted, style = MaterialTheme.typography.bodySmall)
        SelectionContainer { Text(user.id) }
    }
    if (!isPlaceholderEmail(user.email)) return
    val load = remember { Load() }
    var saved by remember { mutableStateOf<String?>(null) }
    var email by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(load.attempt) {
        load.failed = null
        act("Couldn’t load your contact email. Please try again.", { load.failed = it }) {
            saved = api.contact().contact?.email; email = saved.orEmpty(); load.done = true
        }
    }
    fun run(fallback: String, ok: String, work: suspend () -> Unit) {
        working = true; message = null
        act(fallback, { message = it; failed = true }) { work(); message = ok; failed = false }.invokeOnCompletion { working = false }
    }
    if (!load.done) { LoadState(load); return }
    OutlinedTextField(email, { email = it }, colors = fieldColors(), label = { Text("Contact email") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        placeholder = { Text("you@example.com") },
        supportingText = { Text("You signed in with Strava, which doesn't share your email. Add one so we can tell you about your account, invitations and changes to our Terms. We never share it.") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(colors = outlinedColors(), enabled = !working && email.isNotBlank() && email.trim() != saved, modifier = Modifier.testTag("contact-save"), onClick = {
            run("Couldn’t save the email. Please try again.", "Saved.") { saved = api.setContact(email.trim()).contact?.email }
        }) { Text(if (working) "Saving…" else if (saved != null) "Update" else "Save") }
        if (saved != null) TextButton(enabled = !working, colors = linkColors(), modifier = Modifier.testTag("contact-remove"), onClick = {
            run("Couldn’t remove the email. Please try again.", "Removed.") { api.removeContact(); saved = null; email = "" }
        }) { Text("Remove") }
    }
    Message(message, red = failed, tag = "contact-message")
}

@Composable
private fun PublicProfile(api: AccountApi, user: AuthUser, act: Act, onPreview: (String) -> Unit) {
    val load = remember { Load() }
    var public by remember { mutableStateOf(false) }
    var handle by remember { mutableStateOf<String?>(null) }
    var input by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(load.attempt) {
        load.failed = null
        act("Couldn’t load your profile. Please try again.", { load.failed = it }) {
            val p = api.profile(); public = p.public; handle = p.handle; input = p.handle.orEmpty(); load.done = true
        }
    }
    fun busy(fallback: String, ok: String?, work: suspend () -> Unit) {
        saving = true; message = null
        act(fallback, { message = it; failed = true }) { work(); message = ok; failed = false }.invokeOnCompletion { saving = false }
    }
    Section("Public profile")
    if (!load.done) { LoadState(load); return }
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = !saving, role = Role.Switch) {
        busy("Couldn’t update your profile. Please try again.", null) { public = api.setProfilePublic(!public).public }
    }.semantics(mergeDescendants = true) { toggleableState = ToggleableState(public); stateDescription = if (public) "Public" else "Private" },
        verticalAlignment = Alignment.CenterVertically) {
        Text("Show my profile to everyone", modifier = Modifier.weight(1f))
        Switch(checked = public, onCheckedChange = null, enabled = !saving, colors = switchColors())
    }
    Text("Show your race results and personal bests on a public page. Private and group-only results stay hidden. Off until you turn it on.", color = PsColor.muted)
    Link(if (public) "View my profile ↗" else "Preview my profile ↗") { onPreview("/profile/${handle ?: user.id}") }
    OutlinedTextField(input, { input = it }, colors = fieldColors(), label = { Text("Profile handle") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        placeholder = { Text("your-handle") },
        supportingText = { Text("A short link like /profile/${handle ?: "your-handle"}. Lowercase letters, numbers and hyphens, 3–30 characters.") },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(colors = outlinedColors(), enabled = !saving && input.isNotBlank() && input.trim() != handle, modifier = Modifier.testTag("handle-save"), onClick = {
            busy("Couldn’t save your handle. Please try again.", "Saved.") { handle = api.claimHandle(input.trim()).handle; input = handle.orEmpty() }
        }) { Text(if (saving) "Saving…" else if (handle != null) "Change" else "Save") }
        if (handle != null) TextButton(enabled = !saving, colors = linkColors(), modifier = Modifier.testTag("handle-remove"), onClick = {
            busy("Couldn’t remove your handle. Please try again.", "Removed.") { handle = api.releaseHandle().handle; input = "" }
        }) { Text("Remove") }
    }
    Message(message, red = failed, tag = "handle-message")
}

@Composable
private fun YourData(api: AccountApi, act: Act) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var working by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    val file = remember { exportFile(context) }
    // An export that never reached the save dialog (the app was closed while it was open) goes when the screen does.
    DisposableEffect(Unit) { onDispose { if (!working) file.delete() } }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) { file.delete(); working = false; return@rememberLauncherForActivityResult }
        scope.launch {
            val ok = runCatching {
                withContext(Dispatchers.IO) {
                    val out = context.contentResolver.openOutputStream(uri) ?: error("no stream")
                    out.use { o -> file.inputStream().use { it.copyTo(o) } }
                }
            }.isSuccess
            message = if (ok) "Saved." else "Couldn’t save the file. Please try again."
            failed = !ok
            file.delete(); working = false
        }
    }
    Section("Your data")
    Text("Download everything we hold about you as a JSON file: your account, paddles and diary notes, trials, courses and results, groups, and trackers. This is your right of access (UK GDPR Art. 15) and to data portability (Art. 20).", color = PsColor.muted)
    OutlinedButton(colors = outlinedColors(), enabled = !working, onClick = {
        working = true; message = null
        act("Couldn’t prepare your download. Please try again.", { message = it; failed = true; file.delete(); working = false }) {
            val name = api.exportAccount(file)
            try { save.launch(name) } catch (e: Exception) { file.delete(); throw e }
        }
    }) { Text(if (working) "Downloading…" else "Download my data") }
    Message(message, red = failed, tag = "data-message")
}

/**
 * Strava, as the website's Account section: connect (Strava's consent page in a
 * Custom Tab), who is connected, auto-import, older paddles, disconnect.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun StravaSection(
    api: AccountApi, act: Act, connect: StravaConnect, resume: Boolean, onResumed: () -> Unit,
    stravaReturn: String?, onReturnHandled: () -> Unit, onSignInAgain: () -> Unit, onSignedOut: () -> Unit,
    /** The account signs in only with Strava: disconnecting it is asked about first. */
    stravaOnly: Boolean,
) {
    val context = LocalContext.current
    val load = remember { Load() }
    var status by remember { mutableStateOf<StravaStatus?>(null) }
    var working by remember { mutableStateOf(false) }
    var switching by remember { mutableStateOf(false) }
    var needsSignIn by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var confirmDisconnect by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    val view = remember { BringIntoViewRequester() }
    fun say(text: String?, error: Boolean) { message = text; failed = error }
    LaunchedEffect(load.attempt) {
        load.failed = null
        act("Couldn’t check Strava. Please try again.", { load.failed = it }) { status = api.stravaStatus(); load.done = true }
    }
    // Back from Strava: a cue to finish (only a connect this app started), then the server's own status.
    LaunchedEffect(stravaReturn) {
        val back = stravaReturn?.let(Uri::parse) ?: return@LaunchedEffect
        onReturnHandled()
        working = true
        say("Connecting Strava…", false)
        runCatching { view.bringIntoView() }
        act(stravaConnectResult("exchange_failed"), { say(it, true); working = false }) {
            try {
                val now = connect.finish(back.getQueryParameter("code"), back.getQueryParameter("strava"))
                if (now != null) { status = now; say(stravaConnectResult("connected"), false) } else say(null, false)
            } catch (e: ApiFailure) {
                if (!e.reauth) throw e
                say(null, false); needsSignIn = true
            }
            working = false
        }
    }
    LaunchedEffect(resume) { if (resume) { onResumed(); runCatching { view.bringIntoView() } } }
    fun start() {
        working = true; say(null, false)
        act(stravaConnectResult("exchange_failed"), { say(it, true); working = false }) {
            try {
                val url = connect.start()
                if (openTab(context, url).isFailure) say("There’s no web browser on this phone to open Strava in.", true)
            } catch (e: ApiFailure) {
                if (!e.reauth) throw e
                needsSignIn = true
            }
            working = false
        }
    }
    fun disconnect() {
        working = true; confirmDisconnect = false; say(null, false)
        act("Couldn’t disconnect Strava. Please try again.", { say(it, true) }) {
            api.stravaDisconnect(); status = StravaStatus(connected = false)
        }.invokeOnCompletion { working = false }
    }

    Column(Modifier.bringIntoViewRequester(view), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Section("Strava")
        Text("Connect Strava to bring in your paddles and trial results without exporting files, and to sign in with Strava. We only read your activities; we never post.", color = PsColor.muted)
        // Always in the layout, so TalkBack reads what happened.
        Message(message, red = failed, green = !failed && message != "Connecting Strava…", tag = "strava-message")
        Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
            if (needsSignIn) Notice("For your safety, connecting Strava needs a recent sign-in. Sign in again and you’ll come straight back here.")
        }
        val s = status
        when {
            // The notice takes the button's place, as on the website.
            needsSignIn -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(enabled = !leaving, onClick = { leaving = true; onSignInAgain() }, modifier = Modifier.heightIn(min = 48.dp), colors = outlinedColors()) {
                    Text(if (leaving) "Sign in again…" else "Sign in again")
                }
                TextButton(enabled = !leaving, colors = linkColors(), onClick = { needsSignIn = false }) { Text("Cancel") }
            }
            !load.done -> LoadState(load)
            s == null || !s.connected -> {
                // Strava's own button, unaltered (their brand guidelines).
                Image(painterResource(R.drawable.connect_with_strava), contentDescription = "Connect with Strava",
                    modifier = Modifier.height(48.dp).alpha(if (working) 0.5f else 1f).clickable(enabled = !working, role = Role.Button, onClick = ::start))
                if (working) CircularProgressIndicator(Modifier.padding(4.dp))
            }
            else -> {
                Column(Modifier.card()) {
                    // Wraps at large text rather than squeezing the name to a letter a line.
                    FlowRow(Modifier.fillMaxWidth().padding(start = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                        itemVerticalAlignment = Alignment.CenterVertically) {
                        Text("Connected", color = PsColor.green, style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.border(1.dp, PsColor.green, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                        Text(s.athlete?.name.orEmpty(), modifier = Modifier.weight(1f, fill = true).widthIn(min = 96.dp))
                        if (!confirmDisconnect) TextButton(enabled = !working, colors = linkColors(),
                            onClick = { if (stravaOnly) confirmDisconnect = true else disconnect() }) { Text(if (working) "Disconnecting…" else "Disconnect") }
                    }
                    if (confirmDisconnect) Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        // Strava is this account's only way to sign in.
                        Text("You sign in with Strava. Once it’s disconnected, you can’t sign in to this account until you connect it again on the website.")
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = ::disconnect, colors = ButtonDefaults.outlinedButtonColors(contentColor = PsColor.red)) { Text("Disconnect") }
                            TextButton(colors = linkColors(), onClick = { confirmDisconnect = false }) { Text("Cancel") }
                        }
                    }
                }
                val on = s.autoImport ?: true
                Row(Modifier.card().heightIn(min = 48.dp).clickable(enabled = !working && !switching, role = Role.Switch) {
                    // At once, and back again if the server says no.
                    status = s.copy(autoImport = !on); say(null, false); switching = true
                    act("Couldn’t change auto-import. Please try again.", { status = status?.copy(autoImport = on); say(it, true) }) {
                        status = status?.copy(autoImport = api.setStravaAutoImport(!on).autoImport)
                    }.invokeOnCompletion { switching = false }
                }.semantics(mergeDescendants = true) { toggleableState = ToggleableState(on) }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).padding(end = 8.dp)) {
                        Text("Auto-import new paddles")
                        Text("New kayak, canoe, rowing and SUP activities on Strava appear in Paddles by themselves.", color = PsColor.muted)
                    }
                    Switch(checked = on, onCheckedChange = null, enabled = !working && !switching, colors = switchColors())
                }
                StravaImports(api, onSignedOut)
                // Attribution: this row shows the athlete's Strava profile name.
                Image(painterResource(R.drawable.powered_by_strava), contentDescription = "Powered by Strava", modifier = Modifier.height(20.dp))
                Text("You can also sign in with Strava. Disconnecting stops both importing and signing in with Strava.", color = PsColor.muted,
                    modifier = Modifier.testTag("strava-end"))
            }
        }
    }
}

/**
 * The first month by itself, then Older paddles (the website's StravaHistoryImport), kept in
 * [StravaImportModel] so they outlive turning the phone. Leaving Account stops them.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StravaImports(api: AccountApi, onSignedOut: () -> Unit) {
    val model: StravaImportModel = viewModel { StravaImportModel(api) }
    val activity = LocalActivity.current
    DisposableEffect(model) { onDispose { if (activity?.isChangingConfigurations != true) model.stop() } }
    LaunchedEffect(model) { model.startFirst() }
    LaunchedEffect(model.signedOut) { if (model.signedOut) onSignedOut() }
    // "Keep this screen open" means the phone mustn't sleep while Strava makes us wait.
    val view = LocalView.current
    DisposableEffect(model.running) { view.keepScreenOn = model.running; onDispose { view.keepScreenOn = false } }

    // The first month: a rule on the left marks it as something happening, as on the website.
    model.first?.let { p ->
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            Box(Modifier.width(2.dp).fillMaxHeight().background(PsColor.primary))
            ImportStatus(p, "your last month", "first-import", Modifier.padding(start = 12.dp))
        }
    }
    val spans = listOf(HistorySpan.Months3 to "Last 3 months", HistorySpan.Year to "Last year", HistorySpan.All to "Everything")
    var picking by remember { mutableStateOf(false) }
    // One import at a time against Strava's limit.
    val busy = model.running
    Column(Modifier.card().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Older paddles", fontWeight = FontWeight.Medium)
        Text("Bring in paddles you recorded on Strava before you connected it. Ones already here are skipped.", color = PsColor.muted)
        ExposedDropdownMenuBox(expanded = picking, onExpandedChange = { if (!busy) picking = it }) {
            OutlinedTextField(spans.first { it.first == model.span }.second, {}, readOnly = true, enabled = !busy, colors = fieldColors(), label = { Text("How far back") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(picking) },
                modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).testTag("import-span"))
            ExposedDropdownMenu(expanded = picking, onDismissRequest = { picking = false }) {
                spans.forEach { (value, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { model.span = value; picking = false }) }
            }
        }
        OutlinedButton(enabled = !busy, onClick = model::startOlder, modifier = Modifier.heightIn(min = 48.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = PsColor.primaryText)) {
            Text(if (model.olderRunning) "Bringing in…" else "Bring in older paddles")
        }
        model.older?.let { ImportStatus(it, "your paddles", "older-import") }
    }
}

/**
 * Progress, with TalkBack told only when it starts, waits, stops or ends
 * (importAnnouncement), and at once when it stops.
 */
@Composable
private fun ImportStatus(p: ImportProgress, what: String, tag: String, modifier: Modifier = Modifier) {
    val announce = importAnnouncement(p, what)
    Text(importStatus(p, what), color = if (p.stopped != null) PsColor.red else PsColor.muted,
        modifier = modifier.testTag(tag).semantics {
            contentDescription = announce
            liveRegion = if (p.stopped != null) LiveRegionMode.Assertive else LiveRegionMode.Polite
        })
}

/** A bordered surface box, as the website's cards. */
private fun Modifier.card() = fillMaxWidth().background(PsColor.surface, RoundedCornerShape(6.dp)).border(1.dp, PsColor.borderStrong, RoundedCornerShape(6.dp))

/** What the Delete account section shows. */
private enum class Deleting { No, Checking, NeedsSignIn, Confirming }

internal const val RECENT_SIGN_IN = "For your safety, deleting your account needs a recent sign-in. Sign in again and you’ll come straight back here."

/**
 * Deleting needs a sign-in from the last 10 minutes (mobile/contract/README.md § Account):
 * ask the server first, and if it's too old offer [onSignInAgain], which comes back here with [resume].
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DeleteAccount(api: AccountApi, act: Act, resume: Boolean, onResumed: () -> Unit, onSignInAgain: () -> Unit, onDeleted: () -> Unit) {
    var state by remember { mutableStateOf(Deleting.No) }
    var typed by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    val signInFocus = remember { FocusRequester() }
    val view = remember { BringIntoViewRequester() }
    fun check() {
        state = Deleting.Checking; typed = ""; message = null
        act("Couldn’t check your sign-in. Please try again.", { message = it; state = Deleting.No }) {
            state = if (api.accountStatus().recentSignIn) Deleting.Confirming else Deleting.NeedsSignIn
        }
    }
    // Back from signing in again: straight to the check, and the section in view.
    LaunchedEffect(resume) { if (resume) { onResumed(); check(); runCatching { view.bringIntoView() } } }
    Column(Modifier.bringIntoViewRequester(view), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Section("Delete account")
        Text("Deletes your account, your paddles and diary notes, your results (leaderboards update without you), your shared links and your tracker recordings. Courses and trials you created go too, unless a group owns them or someone else has a result in them. Your trackers are unlinked and Strava is disconnected. A group you own passes to one of its admins or members. This happens at once and can't be undone. This is your right to erasure (UK GDPR Art. 17).", color = PsColor.muted)
        // Always in the layout, so TalkBack reads the notice when it appears.
        Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
            if (state == Deleting.NeedsSignIn) Notice(RECENT_SIGN_IN)
        }
        when (state) {
            Deleting.No, Deleting.Checking ->
                OutlinedButton(enabled = state == Deleting.No, onClick = ::check, colors = ButtonDefaults.outlinedButtonColors(contentColor = PsColor.red)) {
                    Text(if (state == Deleting.Checking) "Checking…" else "Delete my account")
                }
            Deleting.NeedsSignIn -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(enabled = !leaving, onClick = { leaving = true; onSignInAgain() }, colors = outlinedColors(),
                    modifier = Modifier.heightIn(min = 48.dp).focusRequester(signInFocus)) { Text(if (leaving) "Sign in again…" else "Sign in again") }
                TextButton(enabled = !leaving, colors = linkColors(), onClick = { state = Deleting.No }) { Text("Cancel") }
                LaunchedEffect(Unit) { runCatching { signInFocus.requestFocus() } }
            }
            Deleting.Confirming -> {
                // Inline, as on the website: the words to type sit above the field and the button they unlock.
                Text("Type DELETE to confirm. There is no undo.")
                OutlinedTextField(typed, { typed = it }, colors = fieldColors(), label = { Text("Confirm") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag("delete-confirm"),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false))
                LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = typed == "DELETE" && !working, colors = ButtonDefaults.buttonColors(containerColor = PsColor.red, contentColor = PsColor.bg), onClick = {
                        working = true; message = null
                        act("Couldn’t delete your account. Please try again.", { message = it; working = false }) {
                            try { api.deleteAccount(); onDeleted() } catch (e: ApiFailure) {
                                if (!e.reauth) throw e
                                // The 10 minutes ran out while they typed: the same step as before, not an error.
                                working = false; state = Deleting.NeedsSignIn
                            }
                        }
                    }) { Text(if (working) "Deleting…" else "Delete for good") }
                    TextButton(enabled = !working, colors = linkColors(), onClick = { state = Deleting.No; typed = "" }) { Text("Cancel") }
                }
            }
        }
        Message(message, red = true, tag = "delete-message")
    }
}

@Composable
private fun Section(title: String) =
    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp).semantics { heading() })

@Composable
private fun Field(label: String, value: String) = Column {
    Text(label, color = PsColor.muted, style = MaterialTheme.typography.bodySmall)
    Text(value)
}

@Composable
private fun Divider() = HorizontalDivider(color = PsColor.border)

@Composable
internal fun linkColors() = ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText)

@Composable
private fun Link(label: String, onClick: () -> Unit) {
    Text(label, color = PsColor.primaryText,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick).padding(vertical = 12.dp))
}

internal fun openTab(context: Context, url: String) =
    runCatching { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url)) }
