package com.paddlesnitch.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.IntentCompat
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    /** What a link or another app asked for (Incoming.kt), until App has dealt with it. */
    private val incoming = MutableStateFlow<Incoming?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The app is always dark, so the status bar's icons are always light.
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        // Only a fresh start: after a rotation it's already dealt with (and a Strava code is spent).
        if (savedInstanceState == null) incoming.value = read(intent)
        setContent { PaddlesnitchTheme { App(incoming) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent) // keeps a shared file's read permission with the activity
        incoming.value = read(intent)
    }

    private fun read(intent: Intent?): Incoming? = intent?.let {
        incoming(it.action, it.dataString, IntentCompat.getParcelableExtra(it, Intent.EXTRA_STREAM, Uri::class.java)?.toString())
    }
}
