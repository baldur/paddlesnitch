package com.paddlesnitch.app.account

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.BuildConfig
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.AuthUser
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.ui.PsColor
import kotlinx.coroutines.launch

/** A website page, and whether it needs the website's sign-in. */
data class AccountLink(val label: String, val path: String, val signedIn: Boolean = true)

/** What the app leaves to the website for now, as on the website's /account. */
val accountPages = listOf(
    AccountLink("Your details", "/account#details"),
    AccountLink("Strava", "/account#strava"),
    AccountLink("Devices", "/devices"),
    AccountLink("Download your data", "/account#data"),
    AccountLink("Delete account", "/account#delete"),
)
val aboutPages = listOf(
    AccountLink("Help", "/help", signedIn = false),
    AccountLink("Privacy", "/privacy", signedIn = false),
    AccountLink("Terms of Service", "/terms", signedIn = false),
)

/** Who's signed in, the account pages (opened on the website, signed in), and signing out. */
@Composable
fun AccountScreen(api: Api, onBack: () -> Unit, onSignOut: () -> Unit, onSignedOut: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<AuthUser?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { api.me().user }.onSuccess { user = it }.onFailure { if (it is SignedOut) onSignedOut() } }

    fun open(page: AccountLink) {
        error = null
        scope.launch {
            runCatching { if (page.signedIn) api.signedInPage(page.path) else BuildConfig.API_BASE_URL + page.path }
                .onSuccess { openTab(context, it) }
                .onFailure { if (it is SignedOut) onSignedOut() else error = it.message }
        }
    }

    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Account", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f).semantics { heading() })
            TextButton(onClick = onBack) { Text("Done") }
        }
        user?.let {
            Text(it.displayName, style = MaterialTheme.typography.titleMedium)
            Text(it.email, color = PsColor.muted)
        }
        error?.let { Text(it, color = PsColor.red) }
        Text("These open on paddlesnitch.com, already signed in.", color = PsColor.muted, modifier = Modifier.padding(top = 8.dp))
        accountPages.forEach { Link(it.label, red = it.path.endsWith("#delete")) { open(it) } }
        HorizontalDivider(color = PsColor.border)
        aboutPages.forEach { Link(it.label) { open(it) } }
        HorizontalDivider(color = PsColor.border)
        Link("Sign out", onClick = onSignOut)
    }
}

@Composable
private fun Link(label: String, red: Boolean = false, onClick: () -> Unit) {
    Text(label, color = if (red) PsColor.red else PsColor.primary,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick).padding(vertical = 12.dp))
}

private fun openTab(context: Context, url: String) =
    runCatching { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url)) }
