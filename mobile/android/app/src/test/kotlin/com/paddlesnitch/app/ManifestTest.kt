package com.paddlesnitch.app

import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// The manifest's filters send links and files to MainActivity (IncomingTest checks what happens next).
@RunWith(RobolectricTestRunner::class)
class ManifestTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    private fun handled(intent: Intent) =
        context.packageManager.queryIntentActivities(intent.setPackage(context.packageName), 0).any { it.activityInfo.name == MainActivity::class.java.name }

    @Test fun gpsFilesOpenOrShareToTheApp() {
        listOf("application/gpx+xml", "application/vnd.garmin.tcx+xml", "application/vnd.ant.fit", "text/csv", "application/zip", "application/octet-stream").forEach {
            assertTrue("open with $it", handled(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://files/1"), it)))
            assertTrue("share $it", handled(Intent(Intent.ACTION_SEND).setType(it)))
        }
    }

    @Test fun onlyPaddlesLinksOpenTheApp() {
        assertTrue(handled(Intent(Intent.ACTION_VIEW, Uri.parse("https://paddlesnitch.com/paddles/abc")).addCategory(Intent.CATEGORY_BROWSABLE)))
        assertEquals(false, handled(Intent(Intent.ACTION_VIEW, Uri.parse("https://paddlesnitch.com/att/abc")).addCategory(Intent.CATEGORY_BROWSABLE)))
        assertEquals(false, handled(Intent(Intent.ACTION_SEND).setType("image/jpeg")))
    }
}
