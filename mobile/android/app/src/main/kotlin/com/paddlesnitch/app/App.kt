package com.paddlesnitch.app

import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.compose.runtime.collectAsState
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
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import com.paddlesnitch.app.account.AccountScreen
import com.paddlesnitch.app.api.AnalysisSession
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.PaddleList
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.auth.KeystoreTokenStore
import com.paddlesnitch.app.auth.PrefsVerifierStore
import com.paddlesnitch.app.auth.StravaSignIn
import com.paddlesnitch.app.auth.SignInScreen
import com.paddlesnitch.app.paddles.PaddlesHost
import com.paddlesnitch.app.paddles.addedMessage
import com.paddlesnitch.app.paddles.rememberAddPaddle
import com.paddlesnitch.app.paddles.sampleFile
import com.paddlesnitch.app.tracker.TrackerSetupScreen
import com.paddlesnitch.app.ui.PsColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Signed out: the sample paddles and a way in. Signed in: your own paddles.
 * [incoming] carries what links and other apps ask for (Incoming.kt) from MainActivity.
 */
@Composable
fun App(incoming: MutableStateFlow<Incoming?> = MutableStateFlow(null)) {
    val context = LocalContext.current
    val api = remember { Api(BuildConfig.API_BASE_URL, KeystoreTokenStore(context), BuildConfig.VERSION_NAME) }
    val sample = remember {
        context.assets.open("api/paddles.list.json").bufferedReader().use { ApiJson.decodeFromString(PaddleList.serializer(), it.readText()) }
    }
    var signedIn by remember { mutableStateOf(api.signedIn) }
    var signingIn by rememberSaveable { mutableStateOf(false) }
    var needsTerms by rememberSaveable { mutableStateOf(false) }
    var inAccount by rememberSaveable { mutableStateOf(false) }
    var settingUpTracker by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val strava = remember { StravaSignIn(api, PrefsVerifierStore(context)) }
    var stravaReturn by remember { mutableStateOf<Uri?>(null) }
    // A paddle to open or a file to add, kept through signing in.
    var pending by rememberSaveable { mutableStateOf<Incoming?>(null) }
    val arrived by incoming.collectAsState()
    LaunchedEffect(arrived) {
        when (val it = arrived) {
            is Incoming.StravaReturn -> { stravaReturn = Uri.parse(it.uri); signingIn = true }
            is Incoming.OpenOnWeb -> openInBrowser(context, it.url)
            is Incoming.OpenPaddle, is Incoming.AddFile -> {
                pending = it; inAccount = false; settingUpTracker = false
                if (!signedIn) signingIn = true
            }
            null -> {}
        }
        incoming.value = null
    }

    Scaffold { inner ->
        val m = Modifier.padding(inner)
        when {
            signingIn -> {
                BackHandler { signingIn = false }
                SignInScreen(api, strava, stravaReturn, onReturnHandled = { stravaReturn = null },
                    onSignedIn = { signedIn = true; signingIn = false; needsTerms = it.needsTerms == true }, onCancel = { signingIn = false; pending = null }, modifier = m)
            }
            signedIn && settingUpTracker -> {
                BackHandler { settingUpTracker = false }
                TrackerSetupScreen(api, onClose = { settingUpTracker = false }, onSignedOut = { signedIn = false; settingUpTracker = false }, modifier = m)
            }
            signedIn && inAccount -> {
                BackHandler { inAccount = false }
                AccountScreen(api, onBack = { inAccount = false }, onTracker = { settingUpTracker = true }, onSignedOut = { signedIn = false; inAccount = false },
                    onSignOut = { scope.launch { api.signOut(); signedIn = false; inAccount = false } }, modifier = m)
            }
            signedIn -> MyPaddles(api, needsTerms, pending, onPendingHandled = { pending = null }, onSignedOut = { signedIn = false }, onAccount = { inAccount = true }, modifier = m)
            else -> PaddlesHost(sample, sample = true, load = { id -> readSample(context, sampleFile(id)) }, modifier = m, action = {
                Button(onClick = { signingIn = true }) { Text("Sign in") }
            })
        }
    }
}

@Composable
private fun MyPaddles(api: Api, needsTerms: Boolean, pending: Incoming?, onPendingHandled: () -> Unit, onSignedOut: () -> Unit, onAccount: () -> Unit, modifier: Modifier) {
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
    var adding by remember { mutableStateOf(false) }
    var added by remember { mutableStateOf<String?>(null) }
    val addPaddle = rememberAddPaddle(api, onBusy = { adding = it; if (it) added = null }) { result ->
        if (result.exceptionOrNull() is SignedOut) onSignedOut()
        added = addedMessage(result)
        if (result.isSuccess) attempt++
    }
    LaunchedEffect(pending) {
        if (pending is Incoming.AddFile) { addPaddle.add(Uri.parse(pending.uri)); onPendingHandled() }
    }
    val account: @Composable () -> Unit = { TextButton(onClick = onAccount) { Text("Account") } }
    val current = list
    when {
        current != null -> PaddlesHost(current, sample = false, load = { api.paddle(it) }, writeSummary = { api.writeSummary(it) }, modifier = modifier,
            openPaddle = (pending as? Incoming.OpenPaddle)?.id, onOpened = onPendingHandled, action = {
            Row {
                TextButton(onClick = addPaddle.pick, enabled = !adding) { Text("Add a file") }
                account()
            }
        }, notice = if (needsTerms || adding || added != null) ({
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (adding) Text("Adding your paddle…", color = PsColor.muted)
                added?.let { Text(it) }
                if (needsTerms) {
                    Text("The Terms of Service have changed. Please accept them on paddlesnitch.com.", color = PsColor.muted)
                    TextButton(onClick = { uri.openUri("${BuildConfig.API_BASE_URL}/terms/accept") }) { Text("Open the Terms") }
                }
            }
        }) else null)
        error != null -> Column(modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(error!!, color = PsColor.red)
            Button(onClick = { attempt++ }) { Text("Try again") }
            account()
        }
        else -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    }
}

private suspend fun readSample(context: android.content.Context, file: String): AnalysisSession = withContext(Dispatchers.IO) {
    context.assets.open(file).bufferedReader().use { ApiJson.decodeFromString(AnalysisSession.serializer(), it.readText()) }
}

/**
 * A paddlesnitch.com page the app has no screen for. The browser is named, since
 * an unnamed link to paddlesnitch.com/paddles/… would come straight back here.
 */
private fun openInBrowser(context: Context, url: String) {
    val uri = Uri.parse(url)
    runCatching {
        val tabs = CustomTabsIntent.Builder().build()
        val browser = CustomTabsClient.getPackageName(context, null)
        if (browser != null) { tabs.intent.setPackage(browser); tabs.launchUrl(context, uri) }
        else context.startActivity(Intent(Intent.ACTION_VIEW, uri).apply {
            selector = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
    }
}
