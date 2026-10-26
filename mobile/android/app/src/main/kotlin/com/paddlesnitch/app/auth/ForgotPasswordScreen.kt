package com.paddlesnitch.app.auth

import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.SignIn
import com.paddlesnitch.app.api.shown
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.PlexMono
import com.paddlesnitch.app.ui.fieldColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Forgot password, as the website's /signin/forgot and /signin/reset: the email, then
 * the emailed code and a new password. The code request never says whether the account
 * exists. [onSignedIn] when the reset signed in; [onPasswordSet] when it didn't (sign in again).
 */
@Composable
fun ForgotPasswordScreen(
    api: Api,
    email: String,
    onSignedIn: (SignIn) -> Unit,
    onPasswordSet: (email: String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    /** Milliseconds, for the bot check; tests drive it. */
    clock: () -> Long = SystemClock::elapsedRealtime,
) {
    // Not in saved state: an email and a live code together would set a new password.
    var address by remember { mutableStateOf(email) }
    var codeSent by rememberSaveable { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    // How long the screen has been open: the server's check against bots.
    val openedAt = remember { clock() }
    val scope = rememberCoroutineScope()
    val first = remember { FocusRequester() }
    val codeFocus = remember { FocusRequester() }
    LaunchedEffect(codeSent) { runCatching { (if (codeSent) codeFocus else first).requestFocus() } }

    fun sendCode() {
        if (address.isBlank()) { error = "Enter your email."; return }
        busy = true; error = null
        scope.launch {
            // The email often arrives filled in, so a tap can come within the server's 2 s bot check,
            // which then quietly sends nothing. Wait out the rest, then send the true time.
            (MIN_OPEN_MS - (clock() - openedAt)).takeIf { it > 0 }?.let { delay(it) }
            runCatching { api.requestPasswordReset(address.trim(), clock() - openedAt) }
                // On to the code whether or not the account exists: the next step looks the same either way.
                .onSuccess { codeSent = true; code = "" }
                .onFailure { error = it.shown("Couldn’t send the reset code. Please try again.") }
            busy = false
        }
    }

    fun reset() {
        if (code.length != 6) { error = "Enter the 6-digit code from the email."; return }
        if (password.isEmpty()) { error = "Choose a new password."; return }
        busy = true; error = null
        scope.launch {
            runCatching { api.confirmPasswordReset(address.trim(), code, password) }
                .onSuccess { signedIn -> if (signedIn != null) onSignedIn(signedIn) else onPasswordSet(address.trim()) }
                .onFailure { error = it.shown("Couldn’t reset your password. Please try again.") }
            busy = false
        }
    }

    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (codeSent) "Set a new password" else "Reset your password", style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f).semantics { heading() })
            TextButton(onClick = onBack, colors = ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText)) { Text("Cancel") }
        }
        Text(if (codeSent) "Enter the 6-digit code from your email and choose a new password." else "Enter your email and we’ll send you a 6-digit code.", color = PsColor.muted)
        OutlinedTextField(address, { address = it }, colors = fieldColors(), label = { Text("Email") }, singleLine = true,
            modifier = Modifier.fillMaxWidth().focusRequester(first).semantics { contentType = ContentType.EmailAddress },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = if (codeSent) ImeAction.Next else ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { sendCode() }))
        if (codeSent) {
            OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, colors = fieldColors(), label = { Text("Code from the email") }, singleLine = true,
                placeholder = { Text("000000") }, textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = PlexMono),
                modifier = Modifier.fillMaxWidth().focusRequester(codeFocus).testTag("reset-code").semantics { contentType = ContentType.SmsOtpCode },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Next))
            OutlinedTextField(password, { password = it }, colors = fieldColors(), label = { Text("New password") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                supportingText = { Text("At least 8 characters, with an uppercase letter, a lowercase letter and a number.") },
                modifier = Modifier.fillMaxWidth().testTag("reset-password").semantics { contentType = ContentType.NewPassword },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { reset() }))
        }
        // Always in the layout, so TalkBack reads an error when it appears.
        Box(Modifier.fillMaxWidth().testTag("reset-error").semantics { liveRegion = LiveRegionMode.Assertive }) { error?.let { Text(it, color = PsColor.red) } }
        Button(onClick = { if (codeSent) reset() else sendCode() }, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(when {
                codeSent && busy -> "Resetting…"
                codeSent -> "Reset password"
                busy -> "Sending…"
                else -> "Send code"
            })
        }
        val link = ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText)
        if (codeSent) TextButton(onClick = { codeSent = false; error = null }, enabled = !busy, colors = link,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Didn’t get a code? Request another") }
        TextButton(onClick = onBack, enabled = !busy, colors = link, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Back to sign in") }
    }
}

/** The server's bot check refuses a reset request sooner than this after the screen opened (apps/web/src/lib/anti-bot.ts). */
internal const val MIN_OPEN_MS = 2_000L
