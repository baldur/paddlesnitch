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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.sp
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
import androidx.compose.ui.unit.dp
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import com.paddlesnitch.app.account.AccountScreen
import com.paddlesnitch.app.account.TermsScreen
import com.paddlesnitch.app.account.PrefsConnectVerifierStore
import com.paddlesnitch.app.account.clearExport
import com.paddlesnitch.app.account.clearStravaConnect
import com.paddlesnitch.app.api.AnalysisSession
import com.paddlesnitch.app.api.RecordingMotion
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.PaddleList
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.auth.GoogleSignIn
import com.paddlesnitch.app.auth.KeystoreTokenStore
import com.paddlesnitch.app.auth.PrefsGoogleVerifierStore
import com.paddlesnitch.app.auth.PrefsVerifierStore
import com.paddlesnitch.app.auth.StravaSignIn
import com.paddlesnitch.app.auth.ForgotPasswordScreen
import com.paddlesnitch.app.auth.SignInScreen
import com.paddlesnitch.app.paddles.PaddlesHost
import com.paddlesnitch.app.paddles.AddCard
import com.paddlesnitch.app.paddles.AddPaddleCard
import com.paddlesnitch.app.paddles.displayName
import com.paddlesnitch.app.paddles.rememberAddPaddle
import com.paddlesnitch.app.paddles.sampleFile
import com.paddlesnitch.app.tracker.TrackerSetupScreen
import com.paddlesnitch.app.tracker.TrackersScreen
import com.paddlesnitch.app.ui.PsColor
import com.paddlesnitch.app.ui.textColors
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
    // Forgot password, inside signing in: the email it started with, and what the sign-in screen says after.
    var forgotFor by remember { mutableStateOf<String?>(null) } // an email: kept out of saved state
    var resetNotice by rememberSaveable { mutableStateOf<String?>(null) }
    var needsTerms by rememberSaveable { mutableStateOf(false) }
    var inAccount by rememberSaveable { mutableStateOf(false) }
    var settingUpTracker by rememberSaveable { mutableStateOf(false) }
    var inTrackers by rememberSaveable { mutableStateOf(false) }
    // Signing in again to delete the account (Reauth.kt). The email to fill in isn't kept past the process.
    var reauth by rememberSaveable { mutableStateOf(Reauth()) }
    var reauthEmail by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val strava = remember { StravaSignIn(api, PrefsVerifierStore(context)) }
    var stravaReturn by remember { mutableStateOf<Uri?>(null) }
    val googleVerifiers = remember { PrefsGoogleVerifierStore(context) }
    val google = remember { GoogleSignIn(api, googleVerifiers) }
    var googleReturn by remember { mutableStateOf<Uri?>(null) }
    var stravaConnectReturn by remember { mutableStateOf<String?>(null) }
    // Links and files waiting to be dealt with, and the add-paddle card (Intake.kt).
    var intake by rememberSaveable { mutableStateOf(Intake()) }
    var added by remember { mutableIntStateOf(0) }
    val addPaddle = rememberAddPaddle(api, onCard = { intake = intake.show(it) }, onAdded = { added++ },
        onSignedOut = { uri, name -> intake = intake.uploadSignedOut(uri, name); signedIn = false })
    fun run(step: Pair<Intake, Intake.Do>) {
        intake = step.first
        when (val d = step.second) {
            Intake.Do.Nothing -> {}
            Intake.Do.SignIn -> signingIn = true
            is Intake.Do.Browser -> openInBrowser(context, d.url)
            is Intake.Do.StravaReturn -> { stravaReturn = Uri.parse(d.uri); signingIn = true }
            is Intake.Do.GoogleReturn -> { googleReturn = Uri.parse(d.uri); signingIn = true }
            // Anyone can open this address: only a connect this app started changes anything.
            is Intake.Do.StravaConnectReturn -> if (PrefsConnectVerifierStore(context).pending) { stravaConnectReturn = d.uri; inAccount = true; settingUpTracker = false }
            is Intake.Do.Upload -> addPaddle.add(Uri.parse(d.uri))
        }
    }
    val arrived by incoming.collectAsState()
    LaunchedEffect(arrived) {
        val it = arrived ?: return@LaunchedEffect
        incoming.value = null
        if (it is Incoming.OpenPaddle || it is Incoming.AddFile) { inAccount = false; inTrackers = false; settingUpTracker = false }
        val name = (it as? Incoming.AddFile)?.let { f -> withContext(Dispatchers.IO) { displayName(context, Uri.parse(f.uri)) } }
        run(intake.arrived(it, signedIn, name, googlePending = googleVerifiers.pending))
    }
    fun forgetReauth() { reauth = reauth.cleared(); reauthEmail = null }
    fun leaveSignIn() { signingIn = false; forgotFor = null; resetNotice = null; intake = intake.signInCancelled(); if (reauth.signingInAgain) inAccount = false; forgetReauth() }

    // Terms that changed are asked for on every start until accepted, not only at sign-in:
    // closing the app on the Terms screen mustn't skip them, and the app rarely signs in again.
    LaunchedEffect(signedIn) { if (signedIn) runCatching { api.terms() }.onSuccess { needsTerms = !it.accepted } }
    fun signedOut() { signedIn = false; inAccount = false; inTrackers = false; settingUpTracker = false; clearExport(context); clearStravaConnect(context); googleVerifiers.clear(); forgetReauth() }
    val screen = screenFor(signingIn = signingIn, signedIn = signedIn, needsTerms = needsTerms, settingUpTracker = settingUpTracker, inTrackers = inTrackers, inAccount = inAccount)
    val onList = screen == Screen.Paddles || screen == Screen.Samples
    Scaffold(bottomBar = {
        AddPaddleCard(intake.card.takeIf { onList }, onOpen = { intake = intake.openFromCard(it) }, onSignIn = { signingIn = true },
            onClose = { intake = intake.cardClosed() })
    }) { inner ->
        val m = Modifier.padding(inner)
        when (screen) {
            Screen.SignIn -> {
                // Signed in, from the sign-in screen or a password reset.
                val signedInWith: (com.paddlesnitch.app.api.SignIn) -> Unit = {
                    if (reauth.signingInAgain) { reauth = reauth.signedIn(it.id); reauthEmail = null; inAccount = reauth.resume != null }
                    forgotFor = null; resetNotice = null; googleVerifiers.clear() // signed in some other way: a late Google return means nothing
                    signedIn = true; signingIn = false; needsTerms = it.needsTerms == true; run(intake.signedIn())
                }
                val forgot = forgotFor
                if (forgot != null) {
                    BackHandler { forgotFor = null }
                    ForgotPasswordScreen(api, forgot, onSignedIn = signedInWith,
                        onPasswordSet = { email -> forgotFor = null; reauthEmail = email; resetNotice = "Your password is set. Please sign in." },
                        onBack = { forgotFor = null }, modifier = m)
                    return@Scaffold
                }
                BackHandler { leaveSignIn() }
                SignInScreen(api, strava, stravaReturn, onReturnHandled = { stravaReturn = null },
                    google = google, googleReturn = googleReturn, onGoogleReturnHandled = { googleReturn = null },
                    onSignedIn = signedInWith, onCancel = { leaveSignIn() }, modifier = m,
                    prefillEmail = reauthEmail, notice = reauth.notice ?: resetNotice, onForgot = { forgotFor = it },
                    startStrava = reauth.signingInAgain && reauth.strava)
            }
            Screen.Terms -> TermsScreen(api, onAccepted = { needsTerms = false }, onSignOut = { scope.launch { api.signOut(); signedOut() } },
                onSignedOut = ::signedOut, modifier = m)
            Screen.Tracker -> {
                BackHandler { settingUpTracker = false }
                TrackerSetupScreen(api, onClose = { settingUpTracker = false }, onSignedOut = ::signedOut, modifier = m)
            }
            Screen.Trackers -> {
                BackHandler { inTrackers = false }
                TrackersScreen(api, onBack = { inTrackers = false }, onSetUp = { settingUpTracker = true }, onSignedOut = ::signedOut, modifier = m,
                    onOpenPaddle = { id -> inTrackers = false; inAccount = false; intake = intake.openFromCard(id) })
            }
            Screen.Account -> {
                BackHandler { inAccount = false }
                AccountScreen(api, onBack = { inAccount = false }, onTracker = { settingUpTracker = true }, onTrackers = { inTrackers = true }, onSignedOut = ::signedOut,
                    onDeleted = ::signedOut, onSignOut = { scope.launch { api.signOut(); signedOut() } }, modifier = m,
                    resume = reauth.resume, onResumed = { reauth = reauth.resumed() },
                    stravaReturn = stravaConnectReturn, onStravaReturnHandled = { stravaConnectReturn = null },
                    onSignInAgain = { userId, email, viaStrava, then ->
                        scope.launch {
                            // signedOut() forgets any sign-in-again, so it goes first.
                            api.signOut(); signedOut()
                            reauth = reauth.start(userId, viaStrava, then); reauthEmail = email; inAccount = true; signingIn = true
                        }
                    })
            }
            Screen.Paddles -> MyPaddles(api, intake.openPaddle, onOpened = { intake = intake.paddleOpened() }, added, addPaddle.pick,
                adding = intake.card is AddCard.Adding, onSignedOut = ::signedOut, onAccount = { inAccount = true }, modifier = m)
            Screen.Samples -> PaddlesHost(sample, sample = true, load = { id -> readSample(context, sampleFile(id)) }, modifier = m,
                // One motion answer ships, the fixture for the river sample's recording: only that sample offers it.
                loadMotion = { readMotionSample(context) }, offersMotion = { it.source.deviceSessionId == SAMPLE_MOTION_RECORDING }, action = {
                Button(onClick = { signingIn = true }) { Text("Sign in") }
            })
        }
    }
}

enum class Screen { SignIn, Samples, Terms, Tracker, Trackers, Account, Paddles }

/** Which screen shows. Terms that need accepting come before everything a signed-in person can reach. */
fun screenFor(signingIn: Boolean, signedIn: Boolean, needsTerms: Boolean, settingUpTracker: Boolean, inAccount: Boolean, inTrackers: Boolean = false) = when {
    signingIn -> Screen.SignIn
    !signedIn -> Screen.Samples
    needsTerms -> Screen.Terms
    settingUpTracker -> Screen.Tracker
    inTrackers -> Screen.Trackers
    inAccount -> Screen.Account
    else -> Screen.Paddles
}

@Composable
private fun MyPaddles(
    api: Api, openPaddle: String?, onOpened: () -> Unit, added: Int, pick: () -> Unit, adding: Boolean,
    onSignedOut: () -> Unit, onAccount: () -> Unit, modifier: Modifier,
    /** Recording on the phone: debug builds only until recordings upload (C3). */
    canRecord: Boolean = BuildConfig.DEBUG,
) {
    var list by remember { mutableStateOf<PaddleList?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt, added) {
        error = null
        runCatching { api.paddles() }
            .onSuccess { list = it }
            .onFailure { if (it is SignedOut) onSignedOut() else error = it.message }
    }
    val account: @Composable () -> Unit = { TextButton(onClick = onAccount, colors = textColors()) { Text("Account") } }
    var recording by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }
    // Release builds never reach Record, so they never ask for location (lead, #761).
    if (recording && canRecord) {
        androidx.activity.compose.BackHandler { recording = false }
        Column(modifier.fillMaxSize()) {
            TextButton(onClick = { recording = false }, colors = textColors(), modifier = Modifier.padding(horizontal = 4.dp).heightIn(min = 48.dp)) { Text("← Paddles", fontSize = 16.sp) }
            com.paddlesnitch.app.record.Record()
        }
        return
    }
    val current = list
    when {
        current != null -> PaddlesHost(current, sample = false, load = { api.paddle(it) }, writeSummary = { api.writeSummary(it) }, modifier = modifier,
            openPaddle = openPaddle, onOpened = onOpened,
            loadMotion = { s -> api.recordingMotion(s.source.deviceSessionId!!, s.source.deviceId!!) },
            notice = if (canRecord) ({
                val state by com.paddlesnitch.app.record.RecordingService.state.collectAsState()
                com.paddlesnitch.app.record.RecordEntry(state, onOpen = { recording = true })
            }) else null, action = {
            Row {
                TextButton(onClick = pick, enabled = !adding, colors = textColors()) { Text("Add paddle") }
                account()
            }
        })
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

/** The recording behind the measured motion fixture (paddles.get.json's tracker paddle). */
internal const val SAMPLE_MOTION_RECORDING = "S0012"

/** The river sample's boat motion: the contract's golden answer, shipped as an asset. */
private suspend fun readMotionSample(context: android.content.Context): RecordingMotion = withContext(Dispatchers.IO) {
    context.assets.open("api/account.devices-session.json").bufferedReader().use { ApiJson.decodeFromString(RecordingMotion.serializer(), it.readText()) }
}

/**
 * A paddlesnitch.com page the app has no screen for. The browser is named, since
 * an unnamed link to paddlesnitch.com/paddles/… would come straight back here.
 */
private fun openInBrowser(context: Context, url: String) {
    val browser = chooseBrowser(
        customTabs = CustomTabsClient.getPackageName(context, null),
        default = context.packageManager.resolveActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")), 0)?.activityInfo?.packageName,
        self = context.packageName,
    ) ?: return
    runCatching { CustomTabsIntent.Builder().build().apply { intent.setPackage(browser) }.launchUrl(context, Uri.parse(url)) }
}

/** The browser to name: one with Custom Tabs, else the default; never this app or the system chooser ("android"). */
internal fun chooseBrowser(customTabs: String?, default: String?, self: String): String? =
    listOfNotNull(customTabs, default).firstOrNull { it != self && it != "android" }
