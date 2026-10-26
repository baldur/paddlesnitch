package com.paddlesnitch.app.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.BuildConfig
import com.paddlesnitch.app.api.AccountApi
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.api.shown
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.checkboxColors
import kotlinx.coroutines.launch

/**
 * The Terms changed since this account last agreed (sign-in said `needsTerms`):
 * the website's /terms/accept, in the app. The documents open in a browser tab.
 */
@Composable
fun TermsScreen(api: AccountApi, onAccepted: () -> Unit, onSignOut: () -> Unit, onSignedOut: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var ticked by remember { mutableStateOf(false) }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Terms of Service", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
        Text("Before you carry on, please read and agree to our Terms of Service and Privacy Policy. They say what we do with your paddles and results, and what you agree to when you use the site.", color = PsColor.muted)
        // One above the other: side by side they don't fit at the largest text.
        Column {
            TextButton(colors = linkColors(), onClick = { openTab(context, BuildConfig.API_BASE_URL + "/terms") }) { Text("Terms of Service ↗") }
            TextButton(colors = linkColors(), onClick = { openTab(context, BuildConfig.API_BASE_URL + "/privacy") }) { Text("Privacy Policy ↗") }
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(ticked, role = Role.Checkbox) { ticked = it }, verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = ticked, onCheckedChange = null, colors = checkboxColors())
            Text("I have read and agree to the Terms of Service and Privacy Policy.", modifier = Modifier.padding(start = 12.dp))
        }
        // The live region stays in the layout, so TalkBack reads the error when it appears.
        Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Assertive }) { error?.let { Text(it, color = PsColor.red) } }
        Button(enabled = ticked && !working, modifier = Modifier.heightIn(min = 48.dp), onClick = {
            working = true; error = null
            scope.launch {
                runCatching { api.acceptTerms() }
                    .onSuccess { onAccepted() }
                    .onFailure { if (it is SignedOut) onSignedOut() else error = it.shown("Couldn’t save that. Please try again.") }
                working = false
            }
        }) { Text(if (working) "Continue…" else "Continue") }
        // Not agreeing is a choice too: sign out rather than be stuck here.
        TextButton(enabled = !working, colors = linkColors(), onClick = onSignOut) { Text("Sign out") }
    }
}
