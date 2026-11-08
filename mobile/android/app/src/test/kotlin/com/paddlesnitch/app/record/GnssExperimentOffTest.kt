package com.paddlesnitch.app.record

import android.Manifest
import android.content.Context
import android.location.GnssStatus
import android.location.LocationManager
import androidx.test.core.app.ApplicationProvider
import com.paddlesnitch.app.BuildConfig
import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.util.ReflectionHelpers

// The privacy page doesn't describe the location detail yet: an ordinary build must not gather it.
@RunWith(RobolectricTestRunner::class)
class GnssExperimentOffTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val dir: File = Files.createTempDirectory("rec").toFile()
    private val shadow = shadowOf(context.getSystemService(LocationManager::class.java))
    @After fun tearDown() { dir.deleteRecursively() }

    @Test fun theSwitchIsOffUnlessTheBuildAsks() = assertFalse(BuildConfig.GNSS_EXPERIMENT)

    @Test fun aDefaultRecorderWritesNothingNewAndListensToNothingNew() {
        shadowOf(context as android.app.Application).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        shadow.setProviderEnabled(LocationManager.FUSED_PROVIDER, true)
        val r = PhoneRecorder(context, dir)
        val f = r.start()
        assertEquals(1, shadow.getLocationRequests(LocationManager.GPS_PROVIDER).size)
        assertEquals(emptyList<Any>(), shadow.getLocationRequests(LocationManager.FUSED_PROVIDER))
        assertEquals(0, ReflectionHelpers.getField<java.util.List<*>>(shadow, "gnssStatusTransports").size)
        assertEquals(0, ReflectionHelpers.getField<java.util.List<*>>(shadow, "gnssMeasurementTransports").size)
        r.onThread { shadow.simulateGnssStatus(GnssStatus.Builder().build()) }
        r.stop()
        assertFalse(f.gnss.exists())
        assertFalse(File(dir, "gnss-full-tracking").exists())
    }
}
