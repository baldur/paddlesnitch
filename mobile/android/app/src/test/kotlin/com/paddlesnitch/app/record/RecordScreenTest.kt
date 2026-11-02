package com.paddlesnitch.app.record

import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.After
import org.junit.Rule
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.junit.Test
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class RecordScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val files = RecordingFiles(File.createTempFile("track_20261031_091407", ".csv"), File.createTempFile("i10", ".csv"))
    private val notReady = RecorderCore.Live(Float.NaN, Float.NaN, Float.NaN, Float.NaN, Float.NaN, Float.NaN)
    // 1 h 5 min 3 s in.
    private val recording = RecordingService.State.Recording(files, MutableStateFlow(notReady), startedAt = 1_000L)
    private val now = { 1_000L + 3_903_000L }

    private fun show(state: RecordingService.State, fontScale: Float = 1f, onStart: () -> Unit = {}, onStop: () -> Unit = {},
                     onSettings: () -> Unit = {}, notificationsOn: Boolean = true, location: LocationReady = LocationReady.Ready,
                     onLocationSettings: () -> Unit = {}) = compose.setContent {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
            PaddlesnitchTheme { Surface(color = PsColor.bg) {
                RecordScreen(state, onStart, onStop, location = location, onSettings = onSettings, onLocationSettings = onLocationSettings,
                    notificationsOn = notificationsOn, now = now)
            } }
        }
    }

    /** TalkBack's named action on Hold to stop (README § Recording screen). */
    private fun stopRecordingAction() = compose.onNodeWithContentDescription("Hold to stop").fetchSemanticsNode()
        .config[SemanticsActions.CustomActions].single { it.label == "Stop recording" }

    private fun golden(name: String) = compose.onRoot().captureRoboImage("src/test/screenshots/com.paddlesnitch.app.record.RecordScreenTest.$name.png")

    @Test fun beforeRecording() {
        var started = 0
        show(RecordingService.State.Idle, onStart = { started++ })
        golden("idle")
        compose.onNodeWithText("Start recording").performClick()
        assertEquals(1, started)
    }

    @Test fun whileRecordingItShowsTheTimeAndADashForStrokeRate() {
        show(recording)
        compose.onNodeWithContentDescription("Elapsed, 1:05:03").assertExists()
        compose.onNodeWithContentDescription("Stroke rate, not measured yet").assertExists()
        golden("recording")
    }

    @Test fun aTapDoesntStopItItSaysToKeepHolding() {
        var stops = 0
        show(recording, onStop = { stops++ })
        compose.onNodeWithContentDescription("Hold to stop").performClick()
        assertEquals(0, stops)
        compose.onNodeWithText(KEEP_HOLDING).assertExists()
    }

    @Test fun aShortHoldDoesntStopIt() {
        var stops = 0
        show(recording, onStop = { stops++ })
        compose.onNodeWithContentDescription("Hold to stop").performTouchInput { down(center); advanceEventTime(800); up() }
        compose.mainClock.advanceTimeBy(1000)
        assertEquals(0, stops)
    }

    @Test fun holdingForOneAndAHalfSecondsStopsIt() {
        var stops = 0
        show(recording, onStop = { stops++ })
        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription("Hold to stop").performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(HOLD_TO_STOP_MS + 100L)
        compose.onNodeWithContentDescription("Hold to stop").performTouchInput { up() }
        compose.mainClock.advanceTimeBy(100)
        assertEquals(1, stops)
    }

    @Test fun talkBackStopsItWithANamedStopRecordingAction() {
        var stops = 0
        show(recording, onStop = { stops++ })
        stopRecordingAction().action()
        assertEquals(1, stops)
    }

    @Test fun whileRecordingTheHeadingSaysRecording() {
        show(recording)
        compose.onNodeWithText("Recording").assertExists()
    }

    @Test fun aFailedWriteShowsInPlaceOfTheHeading() {
        val broken = RecordingFiles(File.createTempFile("track_20261031_091407", ".csv"), File.createTempFile("i10", ".csv"))
        broken.close()
        broken.write(RecorderCore.TRACK, "1,2,3\n".toByteArray())   // after close: the write fails, as on a full phone
        show(RecordingService.State.Recording(broken, MutableStateFlow(notReady), startedAt = 1_000L))
        compose.onNodeWithText(WRITE_FAILED).assertExists()
        compose.onNodeWithText("Recording").assertDoesNotExist()
        golden("recording.write-failed")
    }

    @Test fun withoutMotionSensorsItRecordsAndSaysThereIsNoStrokeRate() {
        show(recording.copy(motion = false))
        compose.onNodeWithText(NO_MOTION_SENSORS).assertExists()
        compose.onNodeWithContentDescription("Hold to stop").assertExists()
        golden("recording.no-motion")
    }

    @Test fun withMotionSensorsTheresNoSuchLine() {
        show(recording)
        compose.onNodeWithText(NO_MOTION_SENSORS).assertDoesNotExist()
    }

    @Test fun withNotificationsOffItSaysStopHere() {
        show(recording, notificationsOn = false)
        compose.onNodeWithText(NOTIFICATIONS_OFF).assertExists()
    }

    @Test fun atLargeText() {
        show(recording, fontScale = 2f)
        golden("recording.large-text")
    }

    @Test fun whileStartingTheButtonWaits() {
        var started = 0
        show(RecordingService.State.Starting, onStart = { started++ })
        compose.onNodeWithText("Start recording…").assertIsNotEnabled()
    }

    @Test fun refusingLocationAtStartSaysSoInPlaceOfStart() {
        var settings = 0
        show(RecordingService.State.Failed(locationRefused = true), onSettings = { settings++ })
        compose.onNodeWithText(RECORD_LOCATION_REFUSED).assertExists()
        compose.onNodeWithText("Start recording").assertDoesNotExist()
        golden("location-refused")
        compose.onNodeWithText("Open Settings").performClick()
        assertEquals(1, settings)
    }

    @Test fun beforeStartWithLocationRefusedItSaysSoInPlaceOfStart() {
        show(RecordingService.State.Idle, location = LocationReady.Refused)
        compose.onNodeWithText(RECORD_LOCATION_REFUSED).assertExists()
        compose.onNodeWithText("Open Settings").assertExists()
        compose.onNodeWithText("Start recording").assertDoesNotExist()
    }

    @Test fun withLocationOffItSaysSoAndOpensLocationSettings() {
        var opened = 0
        show(RecordingService.State.Idle, location = LocationReady.Off, onLocationSettings = { opened++ })
        compose.onNodeWithText(LOCATION_OFF).assertExists()
        compose.onNodeWithText("Start recording").assertDoesNotExist()
        golden("location-off")
        compose.onNodeWithText("Open location settings").performClick()
        assertEquals(1, opened)
    }

    @Test fun aFailedWriteAtLargeText() {
        val broken = RecordingFiles(File.createTempFile("track_20261031_091407", ".csv"), File.createTempFile("i10", ".csv"))
        broken.close()
        broken.write(RecorderCore.TRACK, "1,2,3\n".toByteArray())
        show(RecordingService.State.Recording(broken, MutableStateFlow(notReady), startedAt = 1_000L), fontScale = 2f)
        golden("recording.write-failed.large-text")
    }

    @Test fun anotherFailureDoesntBlameLocation() {
        show(RecordingService.State.Failed(locationRefused = false))
        golden("start-failed")
        compose.onNodeWithText(RECORD_FAILED).assertExists()
        compose.onNodeWithText("Open Settings").assertDoesNotExist()
    }

    @Test fun paddlesSaysARecordingIsRunning() {
        var opened = 0
        compose.setContent { PaddlesnitchTheme { RecordEntry(recording, onOpen = { opened++ }, now = now) } }
        compose.onNodeWithText("Recording · 1:05:03").performClick()
        assertEquals(1, opened)
    }

    @Test fun paddlesOffersToRecord() {
        compose.setContent { PaddlesnitchTheme { RecordEntry(RecordingService.State.Idle, onOpen = {}) } }
        compose.onNodeWithText("Record a paddle").assertExists()
    }

    // C3: recording ships in release, so the app declares its own location and the
    // location service in the main manifest, and no overlay removes them from release.
    @Test fun recordingIsDeclaredForEveryBuild() {
        val main = File("src/main/AndroidManifest.xml").readText()
        listOf("ACCESS_FINE_LOCATION", "FOREGROUND_SERVICE_LOCATION", "RecordingService", "foregroundServiceType=\"location\"").forEach {
            assertEquals("$it in the main manifest", true, main.contains(it))
        }
        assertEquals("no release overlay", false, File("src/release/AndroidManifest.xml").exists())
        assertEquals("nothing for recording in the debug manifest", false, File("src/debug/AndroidManifest.xml").readText().contains("LOCATION"))
    }

    private fun lost(s: Float) = notReady.copy(fix = false, sinceFixS = s)
    private val fixed = notReady.copy(fix = true, sinceFixS = 0f)

    // The table lead and copy-style set for both apps (#761, Phone recording).
    @Test fun theGpsLineIsTheCoresStateInTheAgreedWords() {
        assertEquals(GpsLine("Waiting for GPS", "Waiting for GPS"), gpsLine(null))
        assertEquals(GpsLine("Waiting for GPS", "Waiting for GPS"), gpsLine(notReady))
        assertEquals(GpsLine("GPS fix", "GPS fix"), gpsLine(fixed))
        assertEquals(GpsLine("GPS lost", "GPS lost"), gpsLine(lost(0.4f)))
        assertEquals(GpsLine("GPS lost 1 s ago", "GPS lost 1 second ago"), gpsLine(lost(1.9f)))
        assertEquals(GpsLine("GPS lost 40 s ago", "GPS lost 40 seconds ago"), gpsLine(lost(40.7f)))
        assertEquals(GpsLine("GPS lost 1 min ago", "GPS lost 1 minute ago"), gpsLine(lost(60f)))
        assertEquals(GpsLine("GPS lost 2 min ago", "GPS lost 2 minutes ago"), gpsLine(lost(179f)))
        assertEquals(GpsLine("GPS lost 75 min ago", "GPS lost 75 minutes ago"), gpsLine(lost(4_530f)))
    }

    @Test fun onlyLosingAndRegainingTheFixAreAnnounced() {
        assertEquals(null, gpsAnnouncement(null, notReady))            // waiting: nothing
        assertEquals(null, gpsAnnouncement(notReady, fixed))           // a first fix isn't "back"
        assertEquals("GPS lost", gpsAnnouncement(fixed, lost(0.2f)))
        assertEquals(null, gpsAnnouncement(lost(0.2f), lost(1.2f)))     // the count never talks
        assertEquals(null, gpsAnnouncement(lost(59f), lost(60f)))
        assertEquals("GPS back", gpsAnnouncement(lost(12f), fixed))
        assertEquals(null, gpsAnnouncement(fixed, fixed))
    }

    @Test fun theGpsLineIsNotALiveRegion() {
        RecordingService.set(recording)
        show(RecordingService.State.Recording(files, MutableStateFlow(lost(40f)), startedAt = 1_000L))
        val node = compose.onNodeWithContentDescription("GPS lost 40 seconds ago").fetchSemanticsNode()
        assertEquals(false, node.config.contains(androidx.compose.ui.semantics.SemanticsProperties.LiveRegion))
        compose.onNodeWithText("GPS lost 40 s ago", useUnmergedTree = true).assertDoesNotExist()   // cleared: one label, the spoken one
    }

    @Test fun recordingWithoutAFixSaysWaitingForGps() {
        show(recording)
        compose.onNodeWithContentDescription("Waiting for GPS").assertExists()
    }

    // Lead, 2026-11-01: waiting for the first fix is muted; only a lost fix is red.
    @Test fun onlyALostFixIsRed() {
        assertEquals(false, gpsLost(null))
        assertEquals(false, gpsLost(notReady))
        assertEquals(false, gpsLost(fixed))
        assertEquals(true, gpsLost(lost(0.4f)))
    }

    @Test fun theStrokeRateIsTheCoresOrADash() {
        assertEquals("—", liveStrokeRate(null))
        assertEquals("—", liveStrokeRate(notReady))
        assertEquals("58", liveStrokeRate(notReady.copy(spm = 57.6f)))
    }

    // ---- The motion line (mobile/contract/README.md, "Motion line"), drawn from the core's fixtures.
    private val flat by lazy { fixtureTraces("trace_phone_flat") }
    private val paddle by lazy { fixtureTraces("trace_phone_paddle") }
    private val starting get() = flat.first { it.status == RecorderCore.TraceStatus.STARTING }
    private val still get() = flat.last { it.status == RecorderCore.TraceStatus.STILL }
    private val noSamples get() = flat.last { it.status == RecorderCore.TraceStatus.NO_SAMPLES }
    private val moving get() = paddle.last { it.status == RecorderCore.TraceStatus.MOTION }
    private fun traced(t: RecorderCore.Trace?) = notReady.copy(trace = t)
    private fun recordingWith(t: RecorderCore.Trace) = RecordingService.State.Recording(files, MutableStateFlow(traced(t)), startedAt = 1_000L)
    private fun traceNode() = compose.onNodeWithTag(MOTION_TRACE_TAG, useUnmergedTree = true)

    @Test fun theFixturesHaveEveryStatus() {
        assertEquals(0, starting.n); assertEquals(0, noSamples.n)
        assertTrue(still.n > 1); assertTrue(moving.n > 1)
    }

    @Test fun theMotionLineIsTheCoresStatusInTheAgreedWords() {
        assertEquals("Starting motion sensor" to false, motionLine(starting))
        assertEquals("Motion sensor working" to false, motionLine(moving))
        assertEquals("Motion sensor working, phone still" to false, motionLine(still))
        assertEquals("Couldn’t read the motion sensor. Stroke rate pauses until it’s back." to true, motionLine(noSamples))
    }

    @Test fun onlyTheSensorStoppingAndComingBackAreAnnounced() {
        assertEquals(null, motionAnnouncement(null, traced(starting)))
        assertEquals(null, motionAnnouncement(traced(starting), traced(still)))
        assertEquals(null, motionAnnouncement(traced(still), traced(moving)))
        assertEquals(null, motionAnnouncement(traced(moving), traced(still)))   // put down for a rest
        assertEquals(MOTION_NO_SAMPLES, motionAnnouncement(traced(still), traced(noSamples)))
        assertEquals(MOTION_NO_SAMPLES, motionAnnouncement(traced(starting), traced(noSamples)))   // never started
        assertEquals(null, motionAnnouncement(traced(noSamples), traced(noSamples)))
        assertEquals(MOTION_BACK, motionAnnouncement(traced(noSamples), traced(moving)))
        assertEquals(null, motionAnnouncement(traced(noSamples), null))            // stopped recording: nothing
        assertEquals(null, motionAnnouncement(notReady, notReady))                 // no motion sensors: no trace
    }

    @Test fun gpsAndMotionChangingOnOneTickAreOneAnnouncement() {
        assertEquals("GPS lost. $MOTION_NO_SAMPLES", announcement(fixed.copy(trace = still), lost(0.2f).copy(trace = noSamples)))
        assertEquals("GPS back", announcement(lost(12f).copy(trace = still), fixed.copy(trace = still)))
        assertEquals(MOTION_BACK, announcement(traced(noSamples), traced(moving)))
        assertEquals(null, announcement(traced(still), traced(moving)))
    }

    // On the screen itself: the sensor stopping and coming back are each announced once, nothing else.
    @Test fun theScreenAnnouncesTheSensorStoppingAndComingBack() {
        val am = compose.activity.getSystemService(android.view.accessibility.AccessibilityManager::class.java)
        org.robolectric.Shadows.shadowOf(am).setEnabled(true)
        val live = MutableStateFlow(traced(still))
        show(RecordingService.State.Recording(files, live, startedAt = 1_000L))
        listOf(moving, noSamples, noSamples, moving, still).forEach { live.value = traced(it); compose.waitForIdle() }
        val said = org.robolectric.Shadows.shadowOf(am).sentAccessibilityEvents
            .filter { it.eventType == android.view.accessibility.AccessibilityEvent.TYPE_ANNOUNCEMENT }.map { it.text.joinToString("") }
        assertEquals(listOf(MOTION_NO_SAMPLES, MOTION_BACK), said)
    }

    @Test fun eachSampleIsDrawnWhereTheCoreSaysNewestAtTheRight() {
        val t = RecorderCore.Trace(RecorderCore.TraceStatus.MOTION, 1, 20f, intArrayOf(10_000, 5_000, 0), floatArrayOf(20f, 0f, -20f))
        assertEquals(listOf(Offset(1f, 1f), Offset(500f, 24f), Offset(999f, 47f)), tracePoints(t, 1000f, 48f, 1f))
        assertEquals(emptyList<Offset>(), tracePoints(noSamples, 1000f, 48f, 1f))
    }

    @Test fun motionStarting() { show(recordingWith(starting)); compose.onNodeWithText(MOTION_STARTING).assertExists(); golden("recording.motion-starting") }
    @Test fun motionWorking() { show(recordingWith(moving)); compose.onNodeWithText(MOTION_WORKING).assertExists(); golden("recording.motion-working") }
    @Test fun motionStill() { show(recordingWith(still)); compose.onNodeWithText(MOTION_STILL).assertExists(); golden("recording.motion-still") }
    @Test fun motionNoSamples() { show(recordingWith(noSamples)); compose.onNodeWithText(MOTION_NO_SAMPLES).assertExists(); golden("recording.motion-no-samples") }
    @Test fun motionAtLargeText() { show(recordingWith(moving), fontScale = 2f); golden("recording.motion.large-text") }
    @Test @Config(qualifiers = "w320dp-h568dp") fun motionOnASmallPhoneAtLargeText() {
        show(recordingWith(noSamples), fontScale = 2f)
        // Below the fold here: the empty box keeps its place and the line wraps, nothing clips.
        compose.onNodeWithText(MOTION_NO_SAMPLES).performScrollTo()
        val box = traceNode().fetchSemanticsNode().boundsInRoot
        assertTrue("the box is on screen: $box", box.top >= 0f)
        golden("recording.motion.small-phone")
    }

    // The box keeps its space in every status, also at large text, so nothing under it jumps.
    @Test fun theTraceIsAlways48dpTall() {
        val live = MutableStateFlow(traced(starting))
        show(RecordingService.State.Recording(files, live, startedAt = 1_000L), fontScale = 2f)
        listOf(starting, still, moving, noSamples).forEach {
            live.value = traced(it)
            compose.waitForIdle()
            val b = traceNode().fetchSemanticsNode().boundsInRoot
            assertEquals("${it.status}", with(compose.density) { 48.dp.toPx() }, b.height, 0.5f)
        }
    }

    @Test fun theOrderIsTimeStrokeRateTraceStatusThenGps() {
        show(recordingWith(moving))
        val tops = listOf(
            compose.onNodeWithContentDescription("Elapsed", substring = true),
            compose.onNodeWithContentDescription("Stroke rate", substring = true),
            traceNode(),
            compose.onNodeWithText(MOTION_WORKING),
            compose.onNodeWithContentDescription("Waiting for GPS"),
        ).map { it.fetchSemanticsNode().boundsInRoot.top }
        assertEquals(tops.sorted(), tops)
        assertEquals(tops.distinct(), tops)
    }

    @Test fun screenReadersGetTheStatusLineNotTheTrace() {
        show(recordingWith(moving))
        val trace = traceNode().fetchSemanticsNode().config
        assertFalse(trace.contains(SemanticsProperties.ContentDescription))
        assertFalse(trace.contains(SemanticsProperties.Text))
        assertTrue(trace.isClearingSemantics)
        val status = compose.onNodeWithText(MOTION_WORKING).fetchSemanticsNode().config
        assertFalse(status.contains(SemanticsProperties.LiveRegion))   // not a live region: announced on change only
    }

    @Test fun withoutMotionSensorsThereIsNoTraceOrMotionLine() {
        show(recording.copy(motion = false))
        traceNode().assertDoesNotExist()
        listOf(MOTION_STARTING, MOTION_NO_SAMPLES).forEach { compose.onNodeWithText(it).assertDoesNotExist() }
    }

    // A refused token refresh signs out by itself (#702), mid-paddle as easily as not.
    private var signedIn by mutableStateOf(true)

    private fun showApp() = compose.setContent {
        PaddlesnitchTheme {
            Surface(color = PsColor.bg) {
                WithRecording(signedIn = signedIn, record = { Record(accountId = { "u-77" }) }) { entry, bar ->
                    Column {
                        bar?.invoke()
                        Text(if (signedIn) "Your paddles" else "Sample paddles")
                        entry?.invoke()
                    }
                }
            }
        }
    }

    @After fun idle() = RecordingService.set(RecordingService.State.Idle)

    @Test fun aForcedSignOutMidRecordingKeepsTheScreenAndStop() {
        RecordingService.set(recording)
        showApp()
        compose.onNodeWithText("Recording ·", substring = true).performClick()
        compose.onNodeWithContentDescription("Hold to stop").assertExists()
        signedIn = false
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Hold to stop").assertExists()
        stopRecordingAction().action()
        val app = compose.activity.application
        assertEquals(RecordingService.ACTION_STOP, org.robolectric.Shadows.shadowOf(app).nextStartedService?.action)
    }

    @Test fun signedOutMidRecordingTheSamplesStillLeadBackToIt() {
        RecordingService.set(recording)
        showApp()
        signedIn = false
        compose.onNodeWithText("Sample paddles").assertExists()
        compose.onNodeWithText("Recording ·", substring = true).performClick()
        compose.onNodeWithContentDescription("Hold to stop").assertExists()
    }

    @Test fun signedOutWithNothingRecordingThereIsNoRecord() {
        signedIn = false
        showApp()
        compose.onNodeWithText("Record a paddle").assertDoesNotExist()
    }

    @Test fun hideHidesTheScreenAndTheLineAtTheTopLeadsBackToTheRecording() {
        RecordingService.set(recording)
        showApp()
        compose.onNodeWithText("Recording ·", substring = true).performClick()
        compose.onNodeWithText("Recording carries on.").assertExists()
        compose.onNodeWithText("Hide").performClick()
        compose.onNodeWithText("Your paddles").assertExists()
        assertEquals("still recording", recording, RecordingService.state.value)
        compose.onNodeWithText("Recording ·", substring = true).performClick()
        compose.onNodeWithContentDescription("Hold to stop").assertExists()
    }

    @Test fun whileRecordingTheLineIsAtTheTopNotInPaddles() {
        RecordingService.set(recording)
        showApp()
        compose.onNodeWithText("Record a paddle").assertDoesNotExist()
        assertEquals(1, compose.onAllNodes(androidx.compose.ui.test.hasText("Recording ·", substring = true)).fetchSemanticsNodes().size)
    }

    @Test fun withNothingRecordingThereIsNoLineAtTheTopAndCloseGoesBack() {
        showApp()
        compose.onNodeWithText("Recording ·", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Record a paddle").performClick()
        compose.onNodeWithText("Hide").assertDoesNotExist()
        compose.onNodeWithText("Close").performClick()
        compose.onNodeWithText("Your paddles").assertExists()
    }

    @Test fun stoppingGoesBackToPaddles() {
        RecordingService.set(recording)
        showApp()
        compose.onNodeWithText("Recording ·", substring = true).performClick()
        RecordingService.set(RecordingService.State.Stopped(files, elapsedMs = 3_903_000L))
        compose.waitForIdle()
        compose.onNodeWithText("Your paddles").assertExists()
        compose.onNodeWithText("Record a paddle").assertExists()
    }
}
