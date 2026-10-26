package com.paddlesnitch.app.auth

import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
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
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.first
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedButton
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.alpha
import com.paddlesnitch.app.api.SignInOptions
import com.paddlesnitch.app.api.shown
import com.paddlesnitch.app.ui.outlinedColors

/**
 * Sign in or create an account, like the website's /signin: password sign-in,
 * sign-up, and Google and Strava when the server has them on ([loadOptions]).
 * [stravaReturn] and [googleReturn] are the links those came back on.
 */
@Composable
fun SignInScreen(
    api: Api,
    strava: StravaSignIn,
    stravaReturn: Uri?,
    onReturnHandled: () -> Unit,
    google: GoogleSignIn,
    googleReturn: Uri?,
    onGoogleReturnHandled: () -> Unit,
    onSignedIn: (SignIn) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    /** Signing in again for a reason (deleting the account): the email to fill in, and why. */
    prefillEmail: String? = null,
    notice: String? = null,
    /** Open Strava straight away (signing in again with an account made with Strava). */
    startStrava: Boolean = false,
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

    // Asked each time the screen opens: Google and Strava can be switched on and off on the server.
    var options by remember { mutableStateOf<SignInOptions?>(null) }
    var optionsKnown by remember { mutableStateOf(false) }
    var optionsAttempt by remember { mutableIntStateOf(0) }
    var optionsFailed by remember { mutableStateOf(false) }
    LaunchedEffect(optionsAttempt) {
        optionsFailed = false
        runCatching { loadOptions() }.onSuccess { options = it }.onFailure { optionsFailed = true }
        optionsKnown = true
    }
    var emailError by remember { mutableStateOf<String?>(null) }

    // After the options, whose Strava switch decides the words of an error.
    // Waits inside one run: keyed on optionsKnown too, it would run again and wipe its own result.
    LaunchedEffect(googleReturn) {
        val back = googleReturn ?: return@LaunchedEffect
        snapshotFlow { optionsKnown }.first { it }
        busy = true; error = null
        runCatching { google.finish(back.getQueryParameter("code"), back.getQueryParameter("error"), strava = options?.strava == true) } // read now, not as first composed
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

    LaunchedEffect(stravaReturn) {
        val back = stravaReturn ?: return@LaunchedEffect
        busy = true; error = null
        runCatching { strava.finish(back.getQueryParameter("code"), back.getQueryParameter("error")) }
            .onSuccess(onSignedIn)
            .onFailure { error = it.message }
        busy = false
        onReturnHandled()
    }

    fun openStrava() {
        error = null
        runCatching { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(strava.start())) }
            .onFailure { error = "Couldn’t open Strava. Turn on or install a web browser, then try again." }
    }

    // Once, not again on rotation; a missing browser shows here, as from the button.
    var stravaStarted by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(startStrava) { if (startStrava && !stravaStarted) { stravaStarted = true; openStrava() } }

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
        // Failed: the email form, and a way to ask again (a Strava-made account needs the line below).
        Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
            if (optionsFailed) Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                HorizontalDivider(color = PsColor.border)
                Text("Couldn’t load the other ways to sign in.", color = PsColor.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp))
                TextButton(onClick = { optionsAttempt++ }, colors = textColors(), modifier = Modifier.heightIn(min = 48.dp)) { Text("Try again") }
            }
        }
        val o = options ?: return@Column
        if (o.google || o.strava) {
            HorizontalDivider(color = PsColor.border)
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(when { o.google && o.strava -> "Or use your Google or Strava account"; o.google -> "Or use your Google account"; else -> "Or use your Strava account" }, color = PsColor.muted)
                if (o.google) GoogleButton(enabled = !busy, onClick = ::openGoogle)
                // Strava's own button, unaltered (their brand guidelines).
                if (o.strava) Image(painterResource(R.drawable.connect_with_strava), contentDescription = "Connect with Strava",
                    modifier = Modifier.height(48.dp).clickable(enabled = !busy, role = Role.Button, onClick = ::openStrava))
                if (o.strava) Text("Already have an account? Sign in first, then connect Strava in Account on paddlesnitch.com.",
                    color = PsColor.muted, textAlign = TextAlign.Center)
            }
        }
        // Accounts made through Strava have no email or password to use instead.
        if (!o.strava) {
            HorizontalDivider(color = PsColor.border)
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // Email, not the public issue form: people would put their name and email in a report.
                Text("Signed up with Strava? Strava sign-in is off for now. Email us and we’ll help you sign in.",
                    color = PsColor.muted, textAlign = TextAlign.Center)
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
internal const val EMAIL_US = "mailto:privacy@paddlesnitch.com?subject=Signing%20in%20without%20Strava"

/** Help signing in without Strava (README, "When strava is false"). False when there's no email app. */
fun emailUs(context: android.content.Context): Boolean =
    runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_SENDTO, Uri.parse(EMAIL_US))) }.isSuccess

/**
 * Google's own dark button (their branding guidelines: fill #131314, border #8E918F,
 * text #E3E3E3, the unaltered G), as the website's GoogleButton.
 */
@Composable
private fun GoogleButton(enabled: Boolean, onClick: () -> Unit) {
    // Disabled, the whole button fades, so it still looks like Google's (the G can't be tinted).
    OutlinedButton(onClick = onClick, enabled = enabled, shape = RoundedCornerShape(6.dp),
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
