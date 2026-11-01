package com.paddlesnitch.app.account

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import com.paddlesnitch.app.ui.PsRadius
import android.content.Context
import android.net.Uri
import com.paddlesnitch.app.api.Contact
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import com.paddlesnitch.app.auth.NO_EMAIL_APP
import com.paddlesnitch.app.auth.deleteMailto
import com.paddlesnitch.app.auth.emailUs
import com.paddlesnitch.app.Reauth
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
import com.paddlesnitch.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import com.paddlesnitch.app.ui.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import com.paddlesnitch.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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

/** Where "Download my data" keeps the file between fetching and saving it. Personal data: [clearExport] whenever it isn't needed. */
fun exportFile(context: Context) = File(context.cacheDir, "account-export.json")
fun clearExport(context: Context) { exportFile(context).delete() }

/**
 * Account, as the website's /account: your details, public profile, trackers,
 * help, signing out, then your data and deleting the account last.
 */
@Composable
fun AccountScreen(
    api: AccountApi, onBack: () -> Unit, onTracker: () -> Unit, onTrackers: () -> Unit, onSignOut: () -> Unit, onSignedOut: () -> Unit, onDeleted: () -> Unit,
    modifier: Modifier = Modifier,
    /** Back from signing in again: open Delete account at once. */
    resume: Reauth.After? = null, onResumed: () -> Unit = {},
    /** Sign out and in again, then come back with [resume]. */
    onSignInAgain: (userId: String, email: String?, then: Reauth.After) -> Unit = { _, _, _ -> },
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<AuthUser?>(null) }
    // Whether the account was made through Strava (placeholderEmail), which has no password, so it
    // gets a contact email and can't sign in again to delete. Its own load: a failure here never
    // hides the rest of Account from anyone.
    var contact by remember { mutableStateOf<Contact?>(null) }
    val contactLoad = remember { Load() }
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
    LaunchedEffect(user != null, contactLoad.attempt) {
        if (user == null) return@LaunchedEffect
        contactLoad.failed = null
        act("Couldn’t load your contact details. Please try again.", { contactLoad.failed = it }) { contact = api.contact(); contactLoad.done = true }
    }
    /** Asked when Delete needs it, so a contact load that failed earlier is tried again then. */
    suspend fun madeWithStrava(): Boolean = (contact ?: api.contact().also { contact = it }).placeholderEmail == true
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
        // Only an account with a password signs in again (made with Strava, Delete offers Email us).
        fun signInAgain(then: Reauth.After) = onSignInAgain(u.id, u.email, then)
        Message(error, red = true)
        Details(api, u, contact, contactLoad, ::act)
        Divider()
        PublicProfile(api, u, ::act, onPreview = { path -> open(AccountLink("", path)) })
        Divider()
        Section("Devices")
        Link("Your trackers", onClick = onTrackers)
        Link("Set up or sync a tracker", onClick = onTracker)
        Divider()
        aboutPages.forEach { Link("${it.label} ↗") { open(it) } }
        // Made through Strava: no password, so signing out locks it out until we move it (lead).
        SignOut(::act, ::madeWithStrava, onSignOut)
        Divider()
        YourData(api, ::act)
        Divider()
        // Made through Strava: it has no way to sign in again, so signing out would lock it out.
        DeleteAccount(api, ::act, resume == Reauth.After.Delete, onResumed, onSignInAgain = { signInAgain(Reauth.After.Delete) }, onDeleted,
            madeWithStrava = ::madeWithStrava, supportId = u.id)
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
private fun Details(api: AccountApi, user: AuthUser, contact: Contact?, load: Load, act: Act) {
    Section("Your details")
    Field("Email", user.email)
    Field("Display name", user.displayName)
    // For support: the one id we can look an account up by, so it can be copied.
    Column {
        Text("Support ID", color = PsColor.muted, style = MaterialTheme.typography.bodySmall)
        SelectionContainer { Text(user.id) }
    }
    if (contact == null) { if (load.failed != null) LoadState(load); return }
    if (contact.placeholderEmail != true) return
    var saved by remember { mutableStateOf(contact.contact?.email) }
    var email by remember { mutableStateOf(saved.orEmpty()) }
    var working by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    fun run(fallback: String, ok: String, work: suspend () -> Unit) {
        working = true; message = null
        act(fallback, { message = it; failed = true }) { work(); message = ok; failed = false }.invokeOnCompletion { working = false }
    }
    OutlinedTextField(email, { email = it }, colors = fieldColors(), label = { Text("Contact email") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        placeholder = { Text("you@example.com") },
        supportingText = { Text("You made this account with Strava, which didn’t share your email. Add one so we can tell you about your account, invitations and changes to our Terms. We never share it.") },
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

/** A bordered surface box, as the website's cards. */
private fun Modifier.card() = fillMaxWidth().background(PsColor.surface, RoundedCornerShape(PsRadius.control)).border(1.dp, PsColor.borderStrong, RoundedCornerShape(PsRadius.control))

/** What the Delete account section shows. */
private enum class Deleting { No, Checking, NeedsSignIn, Confirming }

internal const val NO_SIGN_IN_AGAIN = "An account made with Strava can’t sign in again here. Email us and we’ll delete it."
internal const val SIGN_OUT_STRAVA = "You made this account with Strava, so you can’t sign back in until we move it to your email."

/** Sign out; an account made with Strava is asked first, with a way to email us (lead, 2026-11-01). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SignOut(act: Act, madeWithStrava: suspend () -> Boolean, onSignOut: () -> Unit) {
    val context = LocalContext.current
    var asking by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    Link("Sign out") {
        message = null
        act("Couldn’t check your account. Please try again.", { message = it }) { if (madeWithStrava()) asking = true else onSignOut() }
    }
    // Always in the layout, so TalkBack reads the question when it appears.
    Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
        if (asking) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Notice(SIGN_OUT_STRAVA)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(colors = outlinedColors(), modifier = Modifier.heightIn(min = 48.dp).focusRequester(focus),
                    onClick = { message = if (emailUs(context)) null else NO_EMAIL_APP }) { Text("Email us") }
                TextButton(colors = linkColors(), modifier = Modifier.heightIn(min = 48.dp), onClick = onSignOut) { Text("Sign out anyway") }
                TextButton(colors = linkColors(), modifier = Modifier.heightIn(min = 48.dp), onClick = { asking = false; message = null }) { Text("Cancel") }
            }
            LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        }
    }
    Message(message, red = true, tag = "signout-message")
}
internal const val RECENT_SIGN_IN = "For your safety, deleting your account needs a recent sign-in. Sign in again and you’ll come straight back here."

/**
 * Deleting needs a sign-in from the last 10 minutes (mobile/contract/README.md § Account):
 * ask the server first, and if it's too old offer [onSignInAgain], which comes back here with [resume].
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DeleteAccount(api: AccountApi, act: Act, resume: Boolean, onResumed: () -> Unit, onSignInAgain: () -> Unit, onDeleted: () -> Unit,
    /** True when this account has no way to sign in again (made through Strava): Email us instead. */
    madeWithStrava: suspend () -> Boolean = { false }, supportId: String = "") {
    val context = LocalContext.current
    var state by remember { mutableStateOf(Deleting.No) }
    var canSignInAgain by remember { mutableStateOf(true) }
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
            val recent = api.accountStatus().recentSignIn
            if (!recent) canSignInAgain = !madeWithStrava()
            state = if (recent) Deleting.Confirming else Deleting.NeedsSignIn
        }
    }
    // Back from signing in again: straight to the check, and the section in view.
    LaunchedEffect(resume) { if (resume) { onResumed(); check(); runCatching { view.bringIntoView() } } }
    Column(Modifier.bringIntoViewRequester(view), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Section("Delete account")
        Text("Deletes your account, your paddles and diary notes, your results (leaderboards update without you), your shared links and your tracker recordings. Courses and trials you created go too, unless a group owns them or someone else has a result in them. Your trackers are removed. A group you own passes to one of its admins or members. This happens at once and can’t be undone. This is your right to erasure (UK GDPR Art. 17).", color = PsColor.muted)
        // Always in the layout, so TalkBack reads the notice when it appears.
        Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
            if (state == Deleting.NeedsSignIn) Notice(if (canSignInAgain) RECENT_SIGN_IN else NO_SIGN_IN_AGAIN)
        }
        when (state) {
            Deleting.No, Deleting.Checking ->
                OutlinedButton(enabled = state == Deleting.No, onClick = ::check, colors = ButtonDefaults.outlinedButtonColors(contentColor = PsColor.red)) {
                    Text(if (state == Deleting.Checking) "Checking…" else "Delete my account")
                }
            Deleting.NeedsSignIn -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (canSignInAgain) OutlinedButton(enabled = !leaving, onClick = { leaving = true; onSignInAgain() }, colors = outlinedColors(),
                    modifier = Modifier.heightIn(min = 48.dp).focusRequester(signInFocus)) { Text(if (leaving) "Sign in again…" else "Sign in again") }
                // Privately, by email (not the public issue form), with the Support ID so we know whose it is.
                else OutlinedButton(colors = outlinedColors(), onClick = { message = if (emailUs(context, deleteMailto(supportId))) null else NO_EMAIL_APP },
                    modifier = Modifier.heightIn(min = 48.dp).focusRequester(signInFocus)) { Text("Email us") }
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
