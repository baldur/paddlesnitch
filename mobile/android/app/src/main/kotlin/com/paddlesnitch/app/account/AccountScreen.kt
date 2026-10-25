package com.paddlesnitch.app.account

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import com.paddlesnitch.app.api.AuthUser
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.api.shown
import com.paddlesnitch.app.ui.PsColor
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A website page, and whether it needs the website's sign-in. */
data class AccountLink(val label: String, val path: String, val signedIn: Boolean = true)

/** What the app still leaves to the website (the next C5 parts bring these into the app). */
val accountPages = listOf(
    AccountLink("Strava", "/account#strava"),
    AccountLink("Your trackers", "/devices"),
)
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

/**
 * Account, as the website's /account: your details, public profile, your
 * data and deleting the account in the app; Strava and the trackers list on
 * the website for now; tracker setup; help; signing out.
 */
@Composable
fun AccountScreen(
    api: AccountApi, onBack: () -> Unit, onTracker: () -> Unit, onSignOut: () -> Unit, onSignedOut: () -> Unit, onDeleted: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<AuthUser?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { api.me().user }.onSuccess { user = it }.onFailure { if (it is SignedOut) onSignedOut() else error = it.shown("Couldn’t load your account. Please try again.") } }
    /** Runs [work]; a session that has ended goes back to signing in. */
    fun act(fallback: String, onError: (String) -> Unit = { error = it }, work: suspend () -> Unit): Job = scope.launch {
        runCatching { work() }.onFailure { if (it is SignedOut) onSignedOut() else onError(it.shown(fallback)) }
    }
    fun open(page: AccountLink) = act("Couldn’t open that page. Please try again.") {
        openTab(context, if (page.signedIn) api.signedInPage(page.path) else BuildConfig.API_BASE_URL + page.path)
    }

    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Account", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f).semantics { heading() })
            TextButton(onClick = onBack, colors = linkColors()) { Text("Done") }
        }
        error?.let { Text(it, color = PsColor.red, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        val u = user
        if (u != null) {
            Details(api, u, ::act)
            Divider()
            PublicProfile(api, u, ::act, onPreview = { path -> open(AccountLink("", path)) })
        }
        Divider()
        Section("Strava and trackers")
        Link("Set up or sync a tracker", onClick = onTracker)
        Text("These open on paddlesnitch.com, already signed in.", color = PsColor.muted)
        accountPages.forEach { Link(it.label) { open(it) } }
        Divider()
        YourData(api, ::act)
        Divider()
        DeleteAccount(api, ::act, onDeleted)
        Divider()
        aboutPages.forEach { Link(it.label) { open(it) } }
        Divider()
        Link("Sign out", onClick = onSignOut)
    }
}

private typealias Act = (fallback: String, onError: (String) -> Unit, work: suspend () -> Unit) -> Job

@Composable
private fun Details(api: AccountApi, user: AuthUser, act: Act) {
    Section("Your details")
    Field("Email", user.email)
    Field("Display name", user.displayName)
    // For support: the one id we can look an account up by.
    Field("Support ID", user.id)
    if (!isPlaceholderEmail(user.email)) return
    var saved by remember { mutableStateOf<String?>(null) }
    var email by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { api.contact().contact?.email }.onSuccess { saved = it; email = it.orEmpty() } }
    OutlinedTextField(email, { email = it }, label = { Text("Contact email") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        placeholder = { Text("you@example.com") },
        supportingText = { Text("You signed in with Strava, which doesn't share your email. Add one so we can tell you about your account, invitations and changes to our Terms. We never share it.") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(enabled = !working && email.isNotBlank() && email.trim() != saved, onClick = {
            working = true; message = null
            act("Couldn’t save the email. Please try again.", { message = it }) { saved = api.setContact(email.trim()).contact?.email; message = "Saved." }
                .invokeOnCompletion { working = false }
        }) { Text(if (working) "Saving…" else if (saved != null) "Update" else "Save") }
        if (saved != null) TextButton(enabled = !working, colors = linkColors(), onClick = {
            working = true; message = null
            act("Couldn’t remove the email. Please try again.", { message = it }) { api.removeContact(); saved = null; email = "" }
                .invokeOnCompletion { working = false }
        }) { Text("Remove") }
    }
    message?.let { Text(it, color = PsColor.muted, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
}

@Composable
private fun PublicProfile(api: AccountApi, user: AuthUser, act: Act, onPreview: (String) -> Unit) {
    var public by remember { mutableStateOf<Boolean?>(null) }
    var handle by remember { mutableStateOf<String?>(null) }
    var input by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { api.profile() }.onSuccess { public = it.public; handle = it.handle; input = it.handle.orEmpty() } }
    fun busy(work: suspend () -> Unit, fallback: String) {
        saving = true; message = null
        act(fallback, { message = it }) { work() }.invokeOnCompletion { saving = false }
    }
    Section("Public profile")
    val on = public == true
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = public != null && !saving, role = Role.Switch) {
        busy({ public = api.setProfilePublic(!on).public }, "Couldn’t update your profile. Please try again.")
    }.semantics(mergeDescendants = true) { toggleableState = ToggleableState(on); stateDescription = if (on) "Public" else "Private" },
        verticalAlignment = Alignment.CenterVertically) {
        Text("Show my profile to everyone", modifier = Modifier.weight(1f))
        Switch(checked = on, onCheckedChange = null, enabled = public != null && !saving)
    }
    Text("Show your race results and personal bests on a public page. Private and group-only results stay hidden. Off until you turn it on.", color = PsColor.muted)
    Link(if (on) "View my profile" else "Preview my profile") { onPreview("/profile/${handle ?: user.id}") }
    OutlinedTextField(input, { input = it }, label = { Text("Profile handle") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        placeholder = { Text("your-handle") },
        supportingText = { Text("A short link like /profile/${handle ?: "your-handle"}. Lowercase letters, numbers and hyphens, 3–30 characters.") },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(enabled = !saving && input.isNotBlank() && input.trim() != handle, onClick = {
            busy({ handle = api.claimHandle(input.trim()).handle; input = handle.orEmpty(); message = "Saved." }, "Couldn’t save your handle. Please try again.")
        }) { Text(if (saving) "Saving…" else if (handle != null) "Change" else "Save") }
        if (handle != null) TextButton(enabled = !saving, colors = linkColors(), onClick = {
            busy({ handle = api.releaseHandle().handle; input = ""; message = "Handle released." }, "Couldn’t remove your handle. Please try again.")
        }) { Text("Remove") }
    }
    message?.let { Text(it, color = PsColor.muted, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
}

@Composable
private fun YourData(api: AccountApi, act: Act) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var working by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    // Fetched first into the cache (the link lasts 5 minutes), then saved wherever the person picks.
    val file = remember { File(context.cacheDir, "account-export.json") }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) { file.delete(); working = false; return@rememberLauncherForActivityResult }
        scope.launch {
            message = runCatching {
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } } }
                "Saved."
            }.getOrElse { "Couldn’t save the file. Please try again." }
            file.delete(); working = false
        }
    }
    Section("Your data")
    Text("Download everything we hold about you as a JSON file: your account, paddles and diary notes, trials, courses and results, groups, and trackers. This is your right of access (UK GDPR Art. 15) and to data portability (Art. 20).", color = PsColor.muted)
    OutlinedButton(enabled = !working, onClick = {
        working = true; message = null
        act("Couldn’t prepare your download. Please try again.", { message = it; working = false }) { save.launch(api.exportAccount(file)) }
    }) { Text(if (working) "Preparing…" else "Download my data") }
    message?.let { Text(it, color = if (it == "Saved.") PsColor.muted else PsColor.red, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
}

@Composable
private fun DeleteAccount(api: AccountApi, act: Act, onDeleted: () -> Unit) {
    var confirming by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    Section("Delete account")
    Text("Deletes your account, your paddles and diary notes, your results (leaderboards update without you), your shared links and your tracker recordings. Courses and trials you created go too, unless a group owns them or someone else has a result in them. Your trackers are unlinked and Strava is disconnected. A group you own passes to one of its admins or members. This happens at once and can't be undone. This is your right to erasure (UK GDPR Art. 17).", color = PsColor.muted)
    if (!confirming) {
        OutlinedButton(onClick = { confirming = true; typed = ""; message = null }, colors = ButtonDefaults.outlinedButtonColors(contentColor = PsColor.red)) { Text("Delete my account") }
        return
    }
    // Inline, as on the website: the words to type sit right above the button they unlock.
    OutlinedTextField(typed, { typed = it }, label = { Text("Type DELETE to confirm. There is no undo.") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(enabled = typed == "DELETE" && !working, colors = ButtonDefaults.buttonColors(containerColor = PsColor.red, contentColor = PsColor.bg), onClick = {
            working = true; message = null
            act("Couldn’t delete your account. Please try again.", { message = it; working = false }) { api.deleteAccount(); onDeleted() }
        }) { Text(if (working) "Deleting…" else "Delete for good") }
        TextButton(enabled = !working, colors = linkColors(), onClick = { confirming = false; typed = "" }) { Text("Cancel") }
    }
    message?.let { Text(it, color = PsColor.red, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
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
