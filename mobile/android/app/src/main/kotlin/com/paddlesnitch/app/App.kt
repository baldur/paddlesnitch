package com.paddlesnitch.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.PaddleList
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.auth.KeystoreTokenStore
import com.paddlesnitch.app.auth.SignInScreen
import com.paddlesnitch.app.paddles.PaddlesScreen
import com.paddlesnitch.app.tracker.TrackerSetupScreen
import com.paddlesnitch.app.ui.PsColor
import kotlinx.coroutines.launch

/** Signed out: the sample paddles and a way in. Signed in: your own paddles. */
@Composable
fun App() {
    val context = LocalContext.current
    val api = remember { Api(BuildConfig.API_BASE_URL, KeystoreTokenStore(context), BuildConfig.VERSION_NAME) }
    val sample = remember {
        context.assets.open("api/paddles.list.json").bufferedReader().use { ApiJson.decodeFromString(PaddleList.serializer(), it.readText()) }
    }
    var signedIn by remember { mutableStateOf(api.signedIn) }
    var signingIn by rememberSaveable { mutableStateOf(false) }
    var needsTerms by rememberSaveable { mutableStateOf(false) }
    var settingUpTracker by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Scaffold { inner ->
        val m = Modifier.padding(inner)
        when {
            signingIn -> {
                BackHandler { signingIn = false }
                SignInScreen(api, onSignedIn = { signedIn = true; signingIn = false; needsTerms = it.needsTerms == true }, onCancel = { signingIn = false }, modifier = m)
            }
            signedIn && settingUpTracker -> {
                BackHandler { settingUpTracker = false }
                TrackerSetupScreen(api, onClose = { settingUpTracker = false }, onSignedOut = { signedIn = false; settingUpTracker = false }, modifier = m)
            }
            signedIn -> MyPaddles(api, needsTerms, onTracker = { settingUpTracker = true }, onSignedOut = { signedIn = false }, onSignOut = { scope.launch { api.signOut(); signedIn = false } }, modifier = m)
            else -> PaddlesScreen(sample, sample = true, modifier = m, action = {
                Button(onClick = { signingIn = true }) { Text("Sign in") }
            })
        }
    }
}

@Composable
private fun MyPaddles(api: Api, needsTerms: Boolean, onTracker: () -> Unit, onSignedOut: () -> Unit, onSignOut: () -> Unit, modifier: Modifier) {
    var list by remember { mutableStateOf<PaddleList?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    val uri = LocalUriHandler.current
    LaunchedEffect(attempt) {
        error = null
        runCatching { api.paddles() }
            .onSuccess { list = it }
            .onFailure { if (it is SignedOut) onSignedOut() else error = it.message }
    }
    val signOut: @Composable () -> Unit = { TextButton(onClick = onSignOut) { Text("Sign out") } }
    val actions: @Composable () -> Unit = { Row { TextButton(onClick = onTracker) { Text("Tracker") }; signOut() } }
    val current = list
    when {
        current != null -> PaddlesScreen(current, sample = false, modifier = modifier, action = actions, notice = if (needsTerms) ({
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("The Terms of Service have changed. Please accept them on paddlesnitch.com.", color = PsColor.muted)
                TextButton(onClick = { uri.openUri("${BuildConfig.API_BASE_URL}/terms/accept") }) { Text("Open the Terms") }
            }
        }) else null)
        error != null -> Column(modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(error!!, color = PsColor.red)
            Button(onClick = { attempt++ }) { Text("Try again") }
            signOut()
        }
        else -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    }
}
