package com.paddlesnitch.app

import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.ui.graphics.toArgb
import androidx.activity.ComponentActivity
import org.robolectric.Robolectric
import com.paddlesnitch.app.account.openTab
import com.paddlesnitch.app.ui.PsColor
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows

// #889: every Custom Tab has the app's dark bar, as iOS tints Safari, not the browser's default.
@RunWith(RobolectricTestRunner::class)
class CustomTabColoursTest {
    private fun assertDarkBar(intent: Intent) {
        listOf(CustomTabsIntent.COLOR_SCHEME_DARK, CustomTabsIntent.COLOR_SCHEME_LIGHT).forEach { scheme ->
            val params = CustomTabsIntent.getColorSchemeParams(intent, scheme)
            assertEquals("toolbar ($scheme)", PsColor.bg.toArgb(), params.toolbarColor)
            assertEquals("navigation bar ($scheme)", PsColor.bg.toArgb(), params.navigationBarColor)
        }
        assertEquals(CustomTabsIntent.COLOR_SCHEME_DARK, intent.getIntExtra(CustomTabsIntent.EXTRA_COLOR_SCHEME, -1))
    }

    @Test fun theNamedBrowsersTabHasTheAppsBar() {
        assertDarkBar(customTab("com.example.browser", ephemeral = false).intent)
        assertDarkBar(customTab("com.example.browser", ephemeral = true).intent)
    }

    @Test fun openTabHasTheAppsBar() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        openTab(activity, "https://paddlesnitch.com/terms")
        assertDarkBar(Shadows.shadowOf(activity).nextStartedActivity)
    }

    // One builder for every tab, so a new one can't come back with the browser's bar.
    @Test fun everyTabIsBuiltByTheSharedBuilder() {
        val found = File("src/main").walk().filter { it.isFile && it.extension == "kt" }.flatMap { f ->
            f.readLines().mapIndexedNotNull { i, l -> if ("CustomTabsIntent.Builder(" in l) "${f.name}:${i + 1}" else null }
        }.toList()
        assertEquals(1, found.size)
        assert(found.single().startsWith("App.kt:")) { "$found" }
    }
}
