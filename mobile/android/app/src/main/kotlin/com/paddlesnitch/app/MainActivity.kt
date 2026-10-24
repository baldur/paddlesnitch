package com.paddlesnitch.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.PaddleList
import com.paddlesnitch.app.paddles.PaddlesScreen
import com.paddlesnitch.app.ui.PaddlesnitchTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The app is always dark, so the status bar's icons are always light.
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        // Until sign-in (C2) lands: the contract's golden answer, shown as samples.
        val sample = assets.open("api/paddles.list.json").bufferedReader().use { ApiJson.decodeFromString(PaddleList.serializer(), it.readText()) }
        setContent {
            PaddlesnitchTheme {
                Scaffold { inner -> PaddlesScreen(sample, sample = true, modifier = androidx.compose.ui.Modifier.padding(inner)) }
            }
        }
    }
}
