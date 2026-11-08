package com.paddlesnitch.app.record

import android.Manifest
import android.content.Context
import android.location.GnssMeasurementsEvent
import android.location.GnssStatus
import android.location.Location
import android.location.LocationManager
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.nio.file.Files
import java.time.Instant
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

// The location-detail file (mobile/contract/README.md § The location-detail file), from the
// recorder: every row kind, empty cells, the gates, and that none of it touches the recording.
@RunWith(RobolectricTestRunner::class)
class PhoneRecorderGnssTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val locations = context.getSystemService(LocationManager::class.java)
    private val shadow get() = shadowOf(locations)
    private val dir: File = Files.createTempDirectory("rec").toFile()
    private var clockNs = 0L
    private var placement: Placement? = null
    private val made = mutableListOf<PhoneRecorder>()

    private fun recorder() = PhoneRecorder(context, dir, now = { Instant.parse("2026-01-15T10:00:00Z") }, clock = { clockNs }, placement = { placement }, gnssExperiment = true).also { made += it }
    private val r by lazy { recorder() }

    @Before fun setUp() {
        shadowOf(context as android.app.Application).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    @After fun tearDown() { made.forEach { runCatching { it.stop() } }; dir.deleteRecursively() }

    private fun fused() = shadow.setProviderEnabled(LocationManager.FUSED_PROVIDER, true)
    private fun rows(f: RecordingFiles) = f.gnss.readLines().filterNot { it.startsWith("#") }.drop(1).map { it.split(',') }
    private fun row(rows: List<List<String>>, kind: String, column: String) = rows.first { it[0] == kind }[GnssLog.COLUMNS.indexOf(column)]
    private fun header(f: RecordingFiles) = f.gnss.readLines().takeWhile { it.startsWith("#") }

    private fun fullFix(provider: String = LocationManager.GPS_PROVIDER) = Location(provider).apply {
        latitude = 51.5; longitude = -0.12; altitude = 52.64
        time = 1768471200000L; elapsedRealtimeNanos = 86400000_000_000L
        accuracy = 3.84f; verticalAccuracyMeters = 5.12f; speed = 2.714f; speedAccuracyMetersPerSecond = 0.324f
        bearing = 255.72f; bearingAccuracyDegrees = 11.43f
    }

    private fun bareFix(provider: String = LocationManager.GPS_PROVIDER) = Location(provider).apply {
        latitude = 51.5; longitude = -0.12; time = 1768471200000L; elapsedRealtimeNanos = 11_000_000_000L
    }

    private fun send(l: Location) { r.onThread { shadow.simulateLocation(l) }; r.onThread {} }   // the second lets what the first posted run
    private fun sky(rtS: Long, vararg sats: Triple<Boolean, Float, Float?>) {
        clockNs = rtS * 1_000_000_000L
        val b = GnssStatus.Builder()
        sats.forEachIndexed { i, (used, cn0, hz) ->
            b.addSatellite(GnssStatus.CONSTELLATION_GPS, i + 1, cn0, 30f, 90f, true, true, used, hz != null, hz ?: 0f, false, 0f)
        }
        r.onThread { shadow.simulateGnssStatus(b.build()) }
        r.onThread {}   // what the callback posted has run
    }

    @Test fun aGpsRowHasEveryValueAndroidGave() {
        val f = r.start()
        send(fullFix())
        assertEquals(listOf("gps", "1768471200000", "86400000", "51.5000000", "-0.1200000", "52.6", "3.8", "5.1", "2.71", "0.32", "255.7", "11.4", "", "", "", "", ""), rows(f).single())
    }

    @Test fun whatAndroidDidntGiveIsAnEmptyCell() {
        val f = r.start()
        send(bareFix())
        assertEquals(listOf("gps", "1768471200000", "11000", "51.5000000", "-0.1200000", "", "", "", "", "", "", "", "", "", "", "", ""), rows(f).single())
    }

    // The row comes from the fix, not the tick. (Android, and Robolectric, hold a listener to its 1 s interval.)
    @Test fun everyFixDeliveredGetsARow() {
        val f = r.start()
        repeat(3) { i -> send(bareFix().apply { elapsedRealtimeNanos = 11_000_000_000L + i * 1_000_000_000L }) }
        assertEquals(listOf("11000", "12000", "13000"), rows(f).map { it[2] })
    }

    @Test fun aTickWritesNoRow() {
        val f = r.start()
        send(bareFix())
        r.onThread { clockNs = 11_000_000_000L; r.tickNow(); clockNs = 12_000_000_000L; r.tickNow() }
        assertEquals(1, rows(f).size)
    }

    @Test fun gpsStillGoesToTheCoreAsBefore() {
        val f = r.start()
        send(bareFix())
        r.onThread { clockNs = 11_000_000_000L; r.tickNow() }
        assertEquals("51.5000000", f.track.readLines()[1].split(',')[5])
    }

    @Test fun aFusedRowComesFromItsOwnListenerAndNeverReachesTheCore() {
        fused()
        val f = r.start()
        send(fullFix(LocationManager.FUSED_PROVIDER))
        r.onThread { clockNs = 11_000_000_000L; r.tickNow() }
        assertEquals("fused", rows(f).single()[0])
        assertEquals("51.5000000", rows(f).single()[3])
        assertEquals("the track has no fix", "", f.track.readLines()[1].split(',')[5])
    }

    // The plain requestLocationUpdates asks for BALANCED: seen in dumpsys on an emulator.
    @Test fun fusedIsAskedForAtHighAccuracyEverySecond() {
        fused()
        r.start()
        val q = shadow.getLocationRequests(LocationManager.FUSED_PROVIDER).single()
        assertEquals(android.location.LocationRequest.QUALITY_HIGH_ACCURACY, q.quality)
        assertEquals(1000L, q.intervalMillis)
    }

    @Test fun aPhoneWithoutTheFusedProviderHasNoFusedRowsAndStillRecords() {
        val had = locations.hasProvider(LocationManager.FUSED_PROVIDER)
        if (had) shadow.removeProvider(LocationManager.FUSED_PROVIDER)
        val f = r.start()
        send(bareFix())
        assertEquals(listOf("gps"), rows(f).map { it[0] })
        assertEquals(emptyList<Any>(), shadow.getLocationRequests(LocationManager.FUSED_PROVIDER))
    }

    @Test fun aSkyRowSummarisesTheSatellitesUsed() {
        val f = r.start()
        val l1 = 1575.42e6f
        sky(5, Triple(true, 40f, l1), Triple(true, 38f, l1), Triple(true, 30f, l1), Triple(true, 20f, l1), Triple(true, 12f, 1176.45e6f), Triple(false, 45f, l1))
        val s = rows(f).single()
        assertEquals("sky", s[0])
        assertEquals("", s[1])
        assertEquals("5000", s[2])
        assertEquals(listOf("", "", "", "", "", "", "", "", ""), s.subList(3, 12))
        assertEquals(listOf("5", "6", "28.0", "32.0", "1"), s.subList(12, 17))
    }

    @Test fun skyRowsComeAtMostOnceASecond() {
        val f = r.start()
        val sat = Triple<Boolean, Float, Float?>(true, 30f, 1575.42e6f)
        sky(5, sat); sky(5, sat); sky(6, sat); sky(7, sat)
        assertEquals(listOf("5000", "6000", "7000"), rows(f).map { it[2] })
    }

    @Test fun theFullTrackingHeaderAlternatesFromOnAndSurvivesANewRecorder() {
        fun header() = recorder().let { val f = it.start(); it.stop(); header(f)[1] }
        assertEquals(listOf("# full_tracking=1", "# full_tracking=0", "# full_tracking=1", "# full_tracking=0"), List(4) { header() })
    }

    @Test fun aSecondAccountsFolderHasItsOwnTurn() {
        val other = File(dir, "other").apply { mkdirs() }
        assertTrue(nextFullTracking(dir))
        assertTrue(nextFullTracking(other))
        assertFalse(nextFullTracking(dir))
    }

    @Test fun onlyAnOnRecordingHoldsFullTrackingAndStopLetsGo() {
        // The registration itself: after stop the thread has gone, so a leaked callback could never show as an event.
        fun held() = org.robolectric.util.ReflectionHelpers.getField<java.util.List<*>>(shadow, "gnssMeasurementTransports").size
        val on = recorder().also { it.start() }
        assertEquals(1, held())
        shadow.simulateGnssMeasurementsEvent(GnssMeasurementsEvent.Builder().build())
        on.onThread {}
        assertEquals(1, on.measurementEvents)
        on.stop()
        assertEquals(0, held())
        val off = recorder().also { it.start() }
        assertEquals(0, held())
        shadow.simulateGnssMeasurementsEvent(GnssMeasurementsEvent.Builder().build())
        off.onThread {}
        assertEquals(1, on.measurementEvents)
        assertEquals(0, off.measurementEvents)
    }

    @Test fun theRequestAsksForFullTracking() = assertTrue(PhoneRecorder.fullTrackingRequest().isFullTracking)

    @Test fun stopLetsGoOfEveryListenerAndClosesTheFile() {
        fused()
        val f = r.start()
        send(bareFix())
        r.stop()
        assertEquals(emptyList<Any>(), shadow.getLocationRequests(LocationManager.FUSED_PROVIDER))
        assertEquals(emptyList<Any>(), shadow.getLocationRequests(LocationManager.GPS_PROVIDER))
        val before = f.gnss.readText()
        shadow.simulateLocation(bareFix())
        shadow.simulateLocation(bareFix(LocationManager.FUSED_PROVIDER))
        shadow.simulateGnssStatus(GnssStatus.Builder().build())
        assertEquals(before, f.gnss.readText())
    }

    @Test @Config(sdk = [30]) fun beforeAndroid12ThereIsNoFullTrackingOrFused() {
        val f = r.start()
        send(bareFix())
        r.stop()
        assertEquals(listOf("# placement=not_set", "# full_tracking=0", "# sdk=30"), header(f))
        assertFalse("the turn isn't used up", File(dir, "gnss-full-tracking").exists())
        assertEquals(listOf("gps"), rows(f).map { it[0] })
    }

    @Test fun theHeaderSaysWhereThePhoneWas() {
        Placement.entries.forEach { p ->
            placement = p
            val rec = recorder()
            val f = rec.start()
            rec.stop()
            assertEquals("# placement=${p.wire}", header(f)[0])
            f.gnss.delete(); f.track.delete(); f.motion.delete(); f.log.delete()
        }
        assertEquals(listOf("deck", "pocket", "dry_bag", "body"), Placement.entries.map { it.wire })
    }

    @Test fun aFileThatCantBeOpenedDoesntTouchTheRecording() {
        File(dir, "track_20260115_100000_gnss.csv").mkdirs()
        fused()
        val f = r.start()
        send(bareFix())
        r.onThread { clockNs = 11_000_000_000L; r.tickNow() }
        r.stop()
        assertEquals("51.5000000", f.track.readLines()[1].split(',')[5])
        assertEquals(emptyList<Any>(), shadow.getLocationRequests(LocationManager.FUSED_PROVIDER))
    }

    @Test fun aRecordingThatsInterruptedLeavesAWholeFile() {
        val f = r.start()
        send(fullFix())
        sky(5, Triple(true, 30f, 1575.42e6f))
        // Never stopped: read as a killed app would leave it.
        val lines = f.gnss.readText().also { assertTrue(it.endsWith("\n")) }.trimEnd('\n').split('\n')
        assertEquals(6, lines.size)
        lines.drop(3).forEach { assertEquals(it, GnssLog.COLUMNS.size, it.split(',').size) }
    }

    // A real file, read against the contract's own column list and header lines.
    @Test fun theFileMatchesTheContract() {
        fused()
        placement = Placement.DRY_BAG
        val f = r.start()
        send(fullFix()); send(fullFix(LocationManager.FUSED_PROVIDER)); sky(5, Triple(true, 30f, 1575.42e6f))
        r.stop()

        val readme = File("../../contract/README.md").readText()
        val example = readme.substringAfter("The location-detail file").substringAfter("```\n").substringBefore("```").trim().lines()
        val contractHeaders = example.filter { it.startsWith("#") }.map { it.substringBefore('=') }
        val contractColumns = example.first { it.startsWith("kind,") }
        val contractRows = example.dropWhile { !it.startsWith("kind,") }.drop(1).map { it.split(',') }

        val lines = f.gnss.readLines()
        assertEquals(contractHeaders, lines.filter { it.startsWith("#") }.map { it.substringBefore('=') })
        assertEquals(contractColumns, lines[3])
        assertEquals(contractColumns, GnssLog.COLUMNS.joinToString(","))
        val made = lines.drop(4).map { it.split(',') }
        assertEquals(contractRows.map { it[0] }, made.map { it[0] })
        made.zip(contractRows).forEach { (ours, theirs) ->
            assertEquals(theirs.size, ours.size)
            // A cell empty in the contract's row is empty in ours, and the reverse, but for what the example leaves out.
            ours.indices.forEach { i -> if (ours[i].isEmpty()) assertTrue("${ours[0]} col $i", theirs[i].isEmpty()) }
            ours.indices.filter { i -> i in 3..4 && ours[i].isNotEmpty() }.forEach { i -> assertEquals(7, ours[i].substringAfter('.').length) }
        }
        assertEquals("dry_bag", lines[0].substringAfter('='))
        assertEquals("1", row(made, "sky", "sats_used"))
    }

    /* ---- nothing in the experiment may stop or damage the recording ---- */

    private fun trackLat(f: RecordingFiles) = f.track.readLines()[1].split(',')[5]
    private fun tick() = r.onThread { clockNs = 11_000_000_000L; r.tickNow() }
    private fun transports(name: String) = org.robolectric.util.ReflectionHelpers.getField<java.util.List<*>>(shadow, name).size
    private fun sat() = Triple<Boolean, Float, Float?>(true, 30f, 1575.42e6f)

    @After fun noFaults() { FaultyLocations.fail = emptySet(); FaultyLocations.refuseFullTracking = false }

    @Test @Config(shadows = [FaultyLocations::class]) fun whenGnssStatusFailsTheRecordingAndTheOtherSourcesGoOn() {
        FaultyLocations.fail = setOf("sky"); fused()
        val f = r.start()
        send(bareFix()); sky(5, sat()); tick()
        assertEquals("51.5000000", trackLat(f))
        assertEquals(1, shadow.getLocationRequests(LocationManager.FUSED_PROVIDER).size)
        assertEquals(1, transports("gnssMeasurementTransports"))
        assertEquals("the fault fired: no sky rows", listOf("gps"), rows(f).map { it[0] })
    }

    @Test @Config(shadows = [FaultyLocations::class]) fun whenFusedFailsTheRecordingAndTheOtherSourcesGoOn() {
        FaultyLocations.fail = setOf("fused"); fused()
        val f = r.start()
        send(bareFix()); sky(5, sat()); tick()
        assertEquals("51.5000000", trackLat(f))
        assertEquals(listOf("gps", "sky"), rows(f).map { it[0] })
        assertEquals("the fault fired", emptyList<Any>(), shadow.getLocationRequests(LocationManager.FUSED_PROVIDER))
        assertEquals(1, transports("gnssMeasurementTransports"))
    }

    @Test @Config(shadows = [FaultyLocations::class]) fun whenFullTrackingThrowsTheHeaderSaysSoAndTheRestGoOn() {
        FaultyLocations.fail = setOf("measurements"); fused()
        val f = r.start()
        send(bareFix()); sky(5, sat()); tick()
        assertEquals("# full_tracking=0", header(f)[1])
        assertEquals("51.5000000", trackLat(f))
        assertEquals(listOf("gps", "sky"), rows(f).map { it[0] })
        assertEquals(1, shadow.getLocationRequests(LocationManager.FUSED_PROVIDER).size)
    }

    @Test @Config(shadows = [FaultyLocations::class]) fun whenAndroidRefusesFullTrackingTheHeaderSaysZero() {
        FaultyLocations.refuseFullTracking = true
        val f = r.start()
        assertEquals("# full_tracking=0", header(f)[1])
        assertEquals(0, transports("gnssMeasurementTransports"))
    }

    @Test @Config(shadows = [FaultyLocations::class]) fun aFailedReleaseDoesntStopTheOthersOrTheRecordingFinishing() {
        fused()
        val f = r.start()
        send(bareFix())
        FaultyLocations.fail = setOf("sky-stop")
        assertEquals(f, r.stop())
        assertEquals(emptyList<Any>(), shadow.getLocationRequests(LocationManager.FUSED_PROVIDER))
        assertEquals(0, transports("gnssMeasurementTransports"))
        assertTrue(f.log.exists())
    }

    @Test fun aFixAfterTheLogHasClosedDoesntTouchTheRecording() {
        val f = r.start()
        send(bareFix())
        val before = f.gnss.readText()
        r.onThread { r.gnssLogForTest()!!.close(); r.gnssLogForTest()!!.fix("gps", bareFix()) }   // the log's own guard, not only the recorder's
        send(bareFix().apply { elapsedRealtimeNanos = 12_000_000_000L })
        sky(5, sat())
        r.onThread { clockNs = 12_000_000_000L; r.tickNow() }
        assertEquals(before, f.gnss.readText())
        assertEquals("51.5000000", trackLat(f))
        assertEquals(f, r.stop())
    }

    /* ---- the real wiring and the file's edges ---- */

    @Test fun theSavedChoiceReachesTheHeaderWithNothingInjected() {
        Placement.save(context, Placement.POCKET)
        val rec = PhoneRecorder(context, dir, gnssExperiment = true).also { made += it }
        val f = rec.start()
        rec.stop()
        assertEquals("# placement=pocket", header(f)[0])
    }

    @Test fun aGermanPhoneStillWritesPoints() {
        val was = java.util.Locale.getDefault()
        java.util.Locale.setDefault(java.util.Locale.GERMANY)
        try {
            val f = r.start()
            send(fullFix())
            assertEquals("51.5000000", rows(f).single()[3])
            assertEquals("2.71", rows(f).single()[8])
        } finally { java.util.Locale.setDefault(was) }
    }

    @Test fun aValueThatIsntANumberIsAnEmptyCell() {
        val f = r.start()
        send(bareFix().apply { accuracy = Float.NaN; speed = Float.POSITIVE_INFINITY })
        assertEquals("", row(rows(f), "gps", "h_acc_m"))
        assertEquals("", row(rows(f), "gps", "speed_ms"))
        assertEquals(GnssLog.COLUMNS.size, rows(f).single().size)
    }
}

/** LocationManager with a chosen source failing: Android can refuse or throw on any of them. */
@org.robolectric.annotation.Implements(LocationManager::class)
class FaultyLocations : org.robolectric.shadows.ShadowLocationManager() {
    companion object { var fail = emptySet<String>(); var refuseFullTracking = false }

    @org.robolectric.annotation.Implementation
    public override fun registerGnssStatusCallback(callback: GnssStatus.Callback, handler: android.os.Handler?): Boolean {
        if ("sky" in fail) throw IllegalStateException("no gnss status")
        return super.registerGnssStatusCallback(callback, handler)
    }

    @org.robolectric.annotation.Implementation
    public override fun unregisterGnssStatusCallback(callback: GnssStatus.Callback) {
        if ("sky-stop" in fail) throw IllegalStateException("couldn't let go")
        super.unregisterGnssStatusCallback(callback)
    }

    @org.robolectric.annotation.Implementation
    public override fun requestLocationUpdates(provider: String, request: android.location.LocationRequest, executor: java.util.concurrent.Executor, listener: android.location.LocationListener) {
        if ("fused" in fail && provider == LocationManager.FUSED_PROVIDER) throw IllegalStateException("no fused")
        super.requestLocationUpdates(provider, request, executor, listener)
    }

    @org.robolectric.annotation.Implementation(minSdk = 31, methodName = "registerGnssMeasurementsCallback")
    public override fun registerGnssMeasurementsCallbackFromS(
        @org.robolectric.annotation.ClassName("android.location.GnssMeasurementRequest") request: Any,
        executor: java.util.concurrent.Executor,
        @org.robolectric.annotation.ClassName("android.location.GnssMeasurementsEvent\$Callback") callback: Any,
    ): Boolean {
        if ("measurements" in fail) throw IllegalStateException("no measurements")
        if (refuseFullTracking) return false
        return super.registerGnssMeasurementsCallbackFromS(request, executor, callback)
    }
}
