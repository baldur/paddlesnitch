package com.paddlesnitch.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    /** A link back into the app (Strava sign-in), until App has dealt with it. */
    private val returned = MutableStateFlow<Uri?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The app is always dark, so the status bar's icons are always light.
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        // Only a fresh start: after a rotation the link's code is already spent.
        if (savedInstanceState == null) returned.value = intent?.data
        setContent { PaddlesnitchTheme { App(returned) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        returned.value = intent.data
    }
}
