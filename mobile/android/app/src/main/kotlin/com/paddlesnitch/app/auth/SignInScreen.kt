package com.paddlesnitch.app.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.verticalScroll
import com.paddlesnitch.app.ui.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import com.paddlesnitch.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.BuildConfig
import com.paddlesnitch.app.R
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.Constants
import com.paddlesnitch.app.api.SignIn
import com.paddlesnitch.app.ui.Notice
import com.paddlesnitch.app.ui.PlexMono
import com.paddlesnitch.app.ui.PsColor
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.ButtonDefaults
import androidx.compose.runtime.remember
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentType
import com.paddlesnitch.app.api.ApiFailure
import kotlinx.coroutines.delay
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import com.paddlesnitch.app.ui.checkboxColors
import com.paddlesnitch.app.ui.fieldColors
import com.paddlesnitch.app.ui.textColors
import kotlinx.coroutines.launch
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import com.paddlesnitch.app.ui.OutlinedButton
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.alpha
import com.paddlesnitch.app.api.SignInOptions
import com.paddlesnitch.app.api.shown
import com.paddlesnitch.app.ui.outlinedColors

/**
 * Sign in or create an account, like the website's /signin: password sign-in,
 * sign-up, and Google when the server has it on ([loadOptions]).
 * [googleReturn] is the link that came back on.
 */
@Composable
fun SignInScreen(
    api: Api,
    google: GoogleSignIn,
    googleReturn: Uri?,
    onGoogleReturnHandled: () -> Unit,
    onSignedIn: (SignIn) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    /** Signing in again for a reason (deleting the account): the email to fill in, and why. */
    prefillEmail: String? = null,
    notice: String? = null,
    /** Forgot password, with the email typed so far. */
    onForgot: (email: String) -> Unit = {},
    /** Which sign-ins besides email are on; a failure shows email only. */
    loadOptions: suspend () -> SignInOptions = { api.signInOptions() },
) {
    var creating by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf(prefillEmail.orEmpty()) }
    var name by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var agreed by rememberSaveable { mutableStateOf(false) }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    // The sign-up code (#702): which request sent it ("signup" or "signin"), the code typed,
    // what happened to the last send (a status, not an error), and a pause between sends.
    var confirming by rememberSaveable { mutableStateOf<String?>(null) }
    var code by rememberSaveable { mutableStateOf("") }
    var codeStatus by rememberSaveable { mutableStateOf<String?>(null) }
    var resending by remember { mutableStateOf(false) }
    // Every code is an email from a small daily allowance: 30 s between sends, kept as a deadline
    // so turning the phone doesn't start the wait again.
    var coolUntil by rememberSaveable { mutableLongStateOf(0L) }
    val coolingDown = coolUntil > 0
    fun startPause() { coolUntil = System.currentTimeMillis() + CODE_PAUSE_MS }
    LaunchedEffect(coolUntil) { if (coolUntil > 0) { delay((coolUntil - System.currentTimeMillis()).coerceIn(0, CODE_PAUSE_MS)); coolUntil = 0 } }
    // Where the cursor goes next: the code after a new one is sent, the email to change it, the password after a failed sign-in.
    var focusCode by remember { mutableIntStateOf(0) }
    val emailFocus = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }
    var focusField by remember { mutableStateOf<FocusRequester?>(null) }
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    val context = LocalContext.current

    // Asked each time the screen opens: Google can be switched on and off on the server.
    var options by remember { mutableStateOf<SignInOptions?>(null) }
    var optionsAttempt by remember { mutableIntStateOf(0) }
    var optionsFailed by remember { mutableStateOf(false) }
    LaunchedEffect(optionsAttempt) {
        optionsFailed = false
        runCatching { loadOptions() }.onSuccess { options = it }.onFailure { optionsFailed = true }
    }
    var emailError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(googleReturn) {
        val back = googleReturn ?: return@LaunchedEffect
        busy = true; error = null
        runCatching { google.finish(back.getQueryParameter("code"), back.getQueryParameter("error")) }
            .onSuccess { if (it != null) onSignedIn(it) }
            .onFailure { error = it.shown("Couldn’t sign in with Google. Please try again.") }
        busy = false
        onGoogleReturnHandled()
    }

    fun openGoogle() {
        error = null
        runCatching { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(google.start())) }
            .onFailure { google.cancel(); error = "Couldn’t open Google sign-in. Turn on or install a web browser, then try again." }
    }

    fun submit() {
        if (creating && !agreed) { error = "You must agree to the Terms of Service to create an account."; return }
        if (email.isBlank() || password.isEmpty() || (creating && name.isBlank())) { error = "Fill in every field."; return }
        busy = true; error = null
        scope.launch {
            // Constants.tosVersion comes from mobile/contract/api/constants.json; if the
            // Terms change before an app update, the server's 422 says why.
            if (creating) runCatching { api.signUp(email.trim(), name.trim(), password, Constants.tosVersion) }
                .onSuccess { confirming = "signup"; code = ""; codeStatus = null; startPause() }
                .onFailure { error = it.message }
            else runCatching { api.login(email.trim(), password) }
                .onSuccess(onSignedIn)
                .onFailure {
                    // The right password for an account whose code was never entered: a new code has gone out.
                    if (it is ApiFailure && it.needsCode) { confirming = "signin"; code = ""; codeStatus = it.message; startPause() }
                    else error = it.message
                }
            busy = false
        }
    }

    fun confirm() {
        if (code.length != 6) { error = "Enter the 6-digit code from the email."; return }
        busy = true; error = null
        scope.launch {
            // The Terms were ticked on Create account; coming from Sign in they weren't, so needsTerms decides.
            runCatching { api.confirmSignUp(email.trim(), code, password, Constants.tosVersion.takeIf { confirming == "signup" }) }
                .onSuccess(onSignedIn)
                .onFailure {
                    codeStatus = null; error = it.message ?: "Couldn’t confirm your email. Please try again."
                    // Confirmed, but signing in failed: the Sign in form takes it from here.
                    if (it is ApiFailure && it.status == 500) { confirming = null; creating = false; focusField = passwordFocus }
                }
            busy = false
        }
    }

    /** Repeats the request that sent the first code: Create account again, or Sign in again. */
    fun sendNewCode() {
        resending = true; error = null; codeStatus = null
        scope.launch {
            runCatching { if (confirming == "signup") { api.signUp(email.trim(), name.trim(), password, Constants.tosVersion); null } else api.login(email.trim(), password) }
                .onSuccess { signedIn ->
                    // The code was entered meanwhile (on another device): signed in.
                    if (signedIn != null) onSignedIn(signedIn)
                    else { code = ""; codeStatus = NEW_CODE_SENT; startPause(); focusCode++ }
                }
                .onFailure {
                    // Signing in answers needsCode when a new code went out; anything else (429: too many) is an error.
                    if (it is ApiFailure && it.needsCode) { code = ""; codeStatus = NEW_CODE_SENT; startPause(); focusCode++ }
                    else error = it.message ?: "Couldn’t send a new code. Please try again."
                }
            resending = false
        }
    }

    fun changeEmail() { confirming = null; error = null; codeStatus = null; focusField = emailFocus }
    LaunchedEffect(focusField, confirming) { focusField?.let { if (confirming == null) { runCatching { it.requestFocus() }; focusField = null } } }

    Column(
        modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (confirming != null) "Confirm your email" else if (creating) "Create account" else "Sign in", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            TextButton(onClick = onCancel, colors = textColors()) { Text("Cancel") }
        }
        // Why they're here, as a notice rather than an error (the website's role="status" box).
        if (notice != null) Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) { Notice(notice) }
        if (confirming != null) {
            CodeStep(email.trim(), code, { code = it.filter(Char::isDigit).take(6); codeStatus = null }, codeStatus, error,
                busy = busy, resending = resending, coolingDown = coolingDown, focusCode = focusCode, onConfirm = ::confirm, onNewCode = ::sendNewCode, onChangeEmail = ::changeEmail)
            return@Column
        }
        SecondaryTabRow(selectedTabIndex = if (creating) 1 else 0) {
            Tab(selected = !creating, onClick = { creating = false; error = null }, selectedContentColor = PsColor.primaryText, unselectedContentColor = PsColor.muted, text = { Text("Sign in") })
            Tab(selected = creating, onClick = { creating = true; error = null }, selectedContentColor = PsColor.primaryText, unselectedContentColor = PsColor.muted, text = { Text("Create account") })
        }
        OutlinedTextField(email, { email = it }, colors = fieldColors(), label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth().focusRequester(emailFocus),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next))
        if (creating) OutlinedTextField(name, { name = it }, colors = fieldColors(), label = { Text("Display name") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            supportingText = { Text("Shown on leaderboards. You can change it later.") })
        OutlinedTextField(password, { password = it }, colors = fieldColors(), label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth().focusRequester(passwordFocus),
            visualTransformation = PasswordVisualTransformation(),
            supportingText = if (creating) ({ Text("At least 8 characters, with an uppercase letter, a lowercase letter and a number.") }) else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done))
        if (creating) Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(agreed, { agreed = it }, colors = checkboxColors())
            Text("I agree to the ", fontSize = MaterialTheme.typography.bodyMedium.fontSize)
            TextButton(onClick = { uri.openUri("${BuildConfig.API_BASE_URL}/terms") }, colors = textColors(), contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text("Terms of Service") }
        }
        // Always in the layout, so TalkBack reads each new error.
        Box(Modifier.fillMaxWidth().testTag("signin-error").semantics { liveRegion = LiveRegionMode.Polite }) {
            error?.let { Text(it, color = PsColor.red) }
        }
        Button(onClick = ::submit, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(when {
                busy && creating -> "Creating account…"
                busy -> "Signing in…"
                creating -> "Create account"
                else -> "Sign in"
            })
        }
        if (!creating) TextButton(onClick = { onForgot(email.trim()) }, colors = textColors()) { Text("Forgot password?") }
        // Failed: the email form, and a way to ask again.
        Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
            if (optionsFailed) Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                HorizontalDivider(color = PsColor.border)
                Text("Couldn’t load the other ways to sign in.", color = PsColor.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp))
                TextButton(onClick = { optionsAttempt++ }, colors = textColors(), modifier = Modifier.heightIn(min = 48.dp)) { Text("Try again") }
            }
        }
        // SignInOptions still has strava (older builds read it); this app never offers Strava.
        if (options?.google == true) {
            HorizontalDivider(color = PsColor.border)
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Or use your Google account", color = PsColor.muted)
                GoogleButton(enabled = !busy, onClick = ::openGoogle)
            }
        }
        // Accounts made through Strava have no password: on Sign in whatever the options say, not on Create account (lead).
        if (!creating) {
            HorizontalDivider(color = PsColor.border)
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // Email, not the public issue form: people would put their name and email in a report.
                Text(MADE_WITH_STRAVA, color = PsColor.muted, textAlign = TextAlign.Center)
                OutlinedButton(onClick = { emailError = if (emailUs(context)) null else NO_EMAIL_APP }, enabled = !busy, colors = outlinedColors(),
                    modifier = Modifier.heightIn(min = 48.dp)) { Text("Email us") }
                // Next to the button that failed, not up by the form.
                Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
                    emailError?.let { Text(it, color = PsColor.red, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
                }
            }
        }
    }
}

internal const val NO_BROWSER_REPORT = "Couldn’t open the issue form. Turn on or install a web browser, then try again."
internal const val NO_EMAIL_APP = "Couldn’t open an email app. Please email privacy@paddlesnitch.com."
internal const val EMAIL_US = "mailto:privacy@paddlesnitch.com?subject=Moving%20my%20account%20from%20Strava"
/** Strava is gone for good: an account made with it has no other way in until we move it (lead, 2026-11-01). */
internal const val MADE_WITH_STRAVA = "Made your account with Strava? Email us and we’ll move it to your email."

/** For an account made with Strava. False when there's no email app. */
fun emailUs(context: android.content.Context, mailto: String = EMAIL_US): Boolean =
    runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_SENDTO, Uri.parse(mailto))) }.isSuccess

/** Asking us to delete an account made with Strava, which can't sign in again: privately, with its Support ID. */
fun deleteMailto(supportId: String) = "mailto:privacy@paddlesnitch.com?subject=Delete%20my%20account&body=" + Uri.encode("Support ID: $supportId")

/**
 * Google's own dark button (their branding guidelines: fill #131314, border #8E918F,
 * text #E3E3E3, the unaltered G), as the website's GoogleButton.
 */
@Composable
private fun GoogleButton(enabled: Boolean, onClick: () -> Unit) {
    // Disabled, the whole button fades, so it still looks like Google's (the G can't be tinted).
    OutlinedButton(onClick = onClick, enabled = enabled,
        border = BorderStroke(1.dp, Color(0xFF8E918F)),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Color(0xFF131314), contentColor = Color(0xFFE3E3E3),
            disabledContainerColor = Color(0xFF131314), disabledContentColor = Color(0xFFE3E3E3)),
        modifier = Modifier.heightIn(min = 48.dp).alpha(if (enabled) 1f else 0.5f)) {
        Image(painterResource(R.drawable.google_g), contentDescription = null, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text("Sign in with Google", fontWeight = FontWeight.Medium)
    }
}

private const val CODE_PAUSE_MS = 30_000L
internal const val NEW_CODE_SENT = "We’ve sent a new code. You can ask for another in 30 seconds."

/** "Confirm your email", as the website's code step: no tabs, the code, and ways to get a new one. */
@Composable
private fun CodeStep(
    email: String, code: String, onCode: (String) -> Unit, status: String?, error: String?,
    busy: Boolean, resending: Boolean, coolingDown: Boolean, focusCode: Int, onConfirm: () -> Unit, onNewCode: () -> Unit, onChangeEmail: () -> Unit,
) {
    val focus = remember { FocusRequester() }
    // The address stands out, so a typo is easy to spot.
    Text(buildAnnotatedString {
        append("We’ve emailed a 6-digit code to ")
        withStyle(SpanStyle(color = PsColor.fg, fontWeight = FontWeight.SemiBold)) { append(email) }
        append(" to check the address is yours. It can take a minute; look in spam if it doesn’t arrive.")
    }, color = PsColor.muted)
    // Always in the layout, so TalkBack reads each new status.
    Box(Modifier.fillMaxWidth().testTag("code-status").semantics { liveRegion = LiveRegionMode.Polite }) { if (status != null) Notice(status) }
    OutlinedTextField(code, onCode, colors = fieldColors(), label = { Text("Code") }, singleLine = true, placeholder = { Text("000000") },
        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = PlexMono),
        modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag("signup-code").semantics { contentType = ContentType.SmsOtpCode },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onConfirm() }))
    LaunchedEffect(focusCode) { runCatching { focus.requestFocus() } }
    Box(Modifier.fillMaxWidth().testTag("code-error").semantics { liveRegion = LiveRegionMode.Assertive }) { if (error != null) Text(error, color = PsColor.red) }
    Button(onClick = onConfirm, enabled = !busy && !resending, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text(if (busy) "Confirming…" else "Confirm email")
    }
    TextButton(onClick = onNewCode, enabled = !busy && !resending && !coolingDown, colors = ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(if (resending) "Sending…" else "Send a new code") }
    TextButton(onClick = onChangeEmail, enabled = !busy && !resending, colors = ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Change email") }
}
