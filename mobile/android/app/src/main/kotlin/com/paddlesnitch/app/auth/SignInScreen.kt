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
import com.paddlesnitch.app.ui.PsColor
import kotlinx.coroutines.launch

/**
 * Sign in or create an account, like the website's /signin: password sign-in,
 * sign-up and Strava. (The email code waits for email delivery, as on the
 * website.) [stravaReturn] is the link Strava sign-in came back on.
 */
@Composable
fun SignInScreen(
    api: Api,
    strava: StravaSignIn,
    stravaReturn: Uri?,
    onReturnHandled: () -> Unit,
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
) {
    var creating by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf(prefillEmail.orEmpty()) }
    var name by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var agreed by rememberSaveable { mutableStateOf(false) }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    val context = LocalContext.current

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
            .onFailure { error = "There’s no web browser on this phone to open Strava in." }
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
            runCatching { if (creating) api.signUp(email.trim(), name.trim(), password, Constants.tosVersion) else api.login(email.trim(), password) }
                .onSuccess(onSignedIn)
                .onFailure { error = it.message }
            busy = false
        }
    }

    Column(
        modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (creating) "Create account" else "Sign in", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            TextButton(onClick = onCancel) { Text("Cancel") }
        }
        // Why they're here, as a notice rather than an error (the website's role="status" box).
        if (notice != null) Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) { Notice(notice) }
        SecondaryTabRow(selectedTabIndex = if (creating) 1 else 0) {
            Tab(selected = !creating, onClick = { creating = false; error = null }, text = { Text("Sign in") })
            Tab(selected = creating, onClick = { creating = true; error = null }, text = { Text("Create account") })
        }
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next))
        if (creating) OutlinedTextField(name, { name = it }, label = { Text("Display name") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            supportingText = { Text("Shown on leaderboards. You can change it later.") })
        OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            supportingText = if (creating) ({ Text("At least 8 characters, with an uppercase letter, a lowercase letter and a number.") }) else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done))
        if (creating) Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(agreed, { agreed = it })
            Text("I agree to the ", fontSize = MaterialTheme.typography.bodyMedium.fontSize)
            TextButton(onClick = { uri.openUri("${BuildConfig.API_BASE_URL}/terms") }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text("Terms of Service") }
        }
        error?.let {
            Text(it, color = PsColor.red, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        }
        Button(onClick = ::submit, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(when {
                busy && creating -> "Creating account…"
                busy -> "Signing in…"
                creating -> "Create account"
                else -> "Sign in"
            })
        }
        if (!creating) TextButton(onClick = { onForgot(email.trim()) }) { Text("Forgot password?") }
        HorizontalDivider(color = PsColor.border)
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Or use your Strava account", color = PsColor.muted)
            // Strava's own button, unaltered (their brand guidelines).
            Image(painterResource(R.drawable.connect_with_strava), contentDescription = "Connect with Strava",
                modifier = Modifier.height(48.dp).clickable(enabled = !busy, role = Role.Button, onClick = ::openStrava))
            Text("Already have an account? Sign in first, then connect Strava in Account on paddlesnitch.com.",
                color = PsColor.muted, textAlign = TextAlign.Center)
        }
    }
}

