package com.paddlesnitch.app.tracker

import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.paddlesnitch.app.account.FakeAccountApi
import com.paddlesnitch.app.api.Recording
import com.paddlesnitch.app.api.TrackerList
import java.io.File
import com.paddlesnitch.app.paddles.fmtDayTime
import com.paddlesnitch.app.api.RecordingList
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.TrackerSummary
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import com.paddlesnitch.app.ui.PsColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// Your trackers, from the contract's account.devices fixture: the cards say what the server worked out.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class TrackersScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val did = mutableListOf<String>()
    private val NOW = java.time.Instant.parse("2026-10-25T09:00:00Z").toEpochMilli() // the fixture's morning

    private fun show(api: FakeAccountApi, fontScale: Float = 1f) = compose.setContent {
        CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
            PaddlesnitchTheme {
                Surface(color = PsColor.bg) {
                    TrackersScreen(api, onBack = { did += "back" }, onSetUp = { did += "set up" }, onSignedOut = { did += "signed out" },
                        onOpenPaddle = { did += "paddle $it" }, now = { NOW })
                }
            }
        }
    }
    private fun waitFor(text: String) = compose.waitUntil(5_000) { compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty() }
    private fun recording(id: String, device: String, paddle: String? = null, motion: Boolean = false) = Recording(
        sessionId = id, deviceId = device, filename = "track_$id.csv", uploadedAt = "2026-10-25T08:15:00.000Z", startedAt = "2026-10-25T07:02:11.000Z",
        distanceMetres = 8240.5, points = 3569, motion = if (motion) Recording.Motion("2026-10-25T08:16:10.000Z", 1, 1) else null, paddleId = paddle)

    @Test fun eachCardSaysWhatTheServerWorkedOut() {
        show(FakeAccountApi())
        waitFor("12 recordings · 84.21 km · 9 with boat motion · latest 24 Oct 2026")
        compose.onNodeWithText("· up to date", substring = true).assertExists()
        compose.onNodeWithText("update pending (0.18.2)", substring = true).assertExists()
        compose.onNodeWithText("seen 1h ago", substring = true).assertExists()
        compose.onNodeWithText("crashed 4d ago (uplink)", substring = true).assertExists() // the recent crash, from the summary
        compose.onNodeWithText("seen 4d ago · quiet", substring = true).assertExists() // in words, not colour alone
        compose.onNodeWithText("· beta", substring = true).assertExists()
        compose.onNodeWithText("removed").assertExists()
        compose.onNodeWithText("Devices").assertExists() // the place is Devices, as on the website; a tracker is the thing
        compose.onRoot().captureRoboImage()
    }

    @Test fun atTheLargestText() {
        show(FakeAccountApi(), fontScale = 2f)
        waitFor("Tracker C0FFEE01")
        compose.onRoot().captureRoboImage()
    }

    private fun withPhone() = com.paddlesnitch.app.api.ApiJson.decodeFromString(TrackerList.serializer(),
        java.io.File("../../contract/fixtures/api/account.devices.with-phone.json").readText())

    // C3: phones are listed and removed on the website, never as a tracker card here.
    @Test fun phonesAreLeftOutOfTrackers() {
        show(FakeAccountApi(trackerList = withPhone()))
        waitFor("Tracker C0FFEE01")
        compose.onNodeWithText("Android phone").assertDoesNotExist()
        compose.onNodeWithText("P3F2A9C41B7E0D865", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Tracker BADC0DE9").assertExists()
    }

    @Test fun anAccountWithOnlyAPhoneHasNoTrackersYet() {
        val l = withPhone()
        show(FakeAccountApi(trackerList = l.copy(summaries = l.summaries.filter { it.kind == TrackerSummary.Kind.Phone })))
        waitFor("No trackers yet")
    }

    @Test fun onlyTrackersAndSummariesWithNoKindAreTrackers() {
        val l = withPhone()
        val unknown = l.summaries.first().copy(deviceId = "W1", kind = TrackerSummary.Kind.Unknown)
        val old = l.summaries.first().copy(deviceId = "OLD1", kind = null)
        assertEquals(listOf("C0FFEE01", "C0FFEE02", "BADC0DE9", "OLD1"),
            trackersOnly(l.copy(summaries = l.summaries + unknown + old)).summaries.map { it.deviceId })
        assertEquals(listOf("C0FFEE01", "C0FFEE02"), trackersOnly(l).devices.map { it.deviceId })
    }

    @Test fun noTrackersYet() {
        show(FakeAccountApi(trackerList = TrackerList(emptyList(), "0.18.2", emptyList())))
        waitFor("No trackers yet")
        compose.onNodeWithText("Set up or sync a tracker").performScrollTo().performClick()
        assertEquals(listOf("set up"), did)
    }

    @Test fun aFailedLoadSaysSoRatherThanNoTrackers() {
        val api = FakeAccountApi(failTrackers = true)
        show(api)
        waitFor("Couldn’t load your trackers. Please try again.")
        compose.onNodeWithText("No trackers yet").assertDoesNotExist()
        api.failTrackers = false
        compose.onNodeWithText("Try again").performClick()
        waitFor("Tracker C0FFEE01")
    }

    @Test fun aTrackerShowsItsOwnRecordingsAndAPaddleOpensInPaddles() {
        show(FakeAccountApi(recordingList = listOf(recording("rec-river", "C0FFEE01", paddle = "pdl-river", motion = true),
            recording("rec-desk", "C0FFEE01"), recording("rec-other", "C0FFEE02", paddle = "pdl-other"))))
        waitFor("Tracker C0FFEE01")
        compose.onNodeWithTag("tracker-C0FFEE01").performClick()
        waitFor("Recordings")
        compose.onNodeWithText("Devices").assertExists() // back to Devices
        compose.onNodeWithText("paddle · with boat motion").assertExists()
        compose.onNodeWithText("not a paddle · track_rec-desk.csv").assertExists()
        compose.onNodeWithTag("recording-rec-other").assertDoesNotExist() // another tracker's
        compose.onNodeWithTag("recording-rec-desk").performClick() // not a paddle: nothing to open
        compose.onNodeWithTag("recording-rec-river").performClick()
        assertEquals(listOf("paddle pdl-river"), did)
    }

    @Test fun removingATrackerAsksFirstThenRemovesIt() {
        val api = FakeAccountApi()
        show(api)
        waitFor("Tracker C0FFEE02")
        compose.onNodeWithTag("tracker-C0FFEE02").performScrollTo().performClick()
        compose.onNodeWithText("Remove tracker").performScrollTo().performClick()
        waitFor("Remove this tracker? It stops uploading until you add it again. Its recordings stay yours.")
        assertTrue(api.calls.none { it.startsWith("remove") })
        compose.onNodeWithText("Remove").performScrollTo().performClick()
        compose.waitUntil(5_000) { "remove C0FFEE02" in api.calls }
        waitFor("Your paddlesnitch trackers") // back on the list, loaded again
        compose.waitUntil(5_000) { api.calls.count { it == "trackers" } == 2 }
    }

    @Test fun aRemovedTrackerOffersNoRemove() {
        show(FakeAccountApi())
        waitFor("Tracker BADC0DE9")
        compose.onNodeWithTag("tracker-BADC0DE9").performScrollTo().performClick()
        waitFor("This tracker is no longer on your account")
        compose.onNodeWithText("Remove tracker").assertDoesNotExist()
    }

    @Test fun aRefusedRemoveSaysSoAndStays() {
        val api = FakeAccountApi(refuse = "x")
        show(api)
        waitFor("Tracker C0FFEE01")
        compose.onNodeWithTag("tracker-C0FFEE01").performClick()
        compose.onNodeWithText("Remove tracker").performScrollTo().performClick()
        compose.onNodeWithText("Remove").performScrollTo().performClick()
        waitFor("Couldn’t remove the tracker. Please try again.")
        compose.onNodeWithText("Recordings").assertExists()
    }

    private fun summary(recordings: Long, distance: Long = 0, motion: Long = 0, latest: String? = null) =
        TrackerSummary("C0FFEE09", "Tracker C0FFEE09", true, recordings, motion, distance, latest, TrackerSummary.FirmwareState.Unknown, false)

    @Test fun theRecordingsLineInEachCase() {
        assertEquals("no recordings yet", recordingsLine(summary(0, latest = "2026-10-24T16:05:00Z")))
        assertEquals("1 recording", recordingsLine(summary(1)))
        assertEquals("1 recording · 640 m · 1 with boat motion · latest 24 Oct 2026", recordingsLine(summary(1, 640, 1, "2026-10-24T16:05:00Z")))
    }

    @Test fun anUnknownVersionIsNeverShownAsUpToDate() {
        show(FakeAccountApi(trackerList = TrackerList(emptyList(), null, listOf(summary(1)))))
        waitFor("firmware unknown · seen never")
        compose.onNodeWithText("up to date", substring = true).assertDoesNotExist()
        compose.onNodeWithText("update pending", substring = true).assertDoesNotExist()
    }

    @Test fun anEndedSessionGoesBackToSigningIn() {
        show(FakeAccountApi(signedOut = true))
        compose.waitUntil(5_000) { "signed out" in did }
    }

    @Test fun recordingsThatWontLoadStillShowTheTrackers() {
        val api = FakeAccountApi().apply { failRecordings = true }
        show(api)
        waitFor("Tracker C0FFEE01")
        compose.onNodeWithText("Couldn’t load your trackers. Please try again.").assertDoesNotExist()
        compose.onNodeWithTag("tracker-C0FFEE01").performClick()
        waitFor("Couldn’t load the recordings. Please try again.")
        api.failRecordings = false
        compose.onNodeWithText("Try again").performScrollTo().performClick()
        waitFor("No recordings yet")
    }

    @Test fun theContractsRecordingsAPaddleAndOneWithNoFix() {
        val fixture = ApiJson.decodeFromString(RecordingList.serializer(), File("../../contract/fixtures/api/account.devices-sessions.json").readText()).sessions
        show(FakeAccountApi(recordingList = fixture))
        waitFor("Tracker C0FFEE01")
        compose.onNodeWithTag("tracker-C0FFEE01").performClick()
        waitFor("not a paddle · track_20261024_1800.csv")
        compose.onNodeWithText(fmtDayTime("2026-10-24T19:00:00.000Z")).assertExists() // uploadedAt, no distance
        compose.onNodeWithTag("recording-rec-river").performClick() // the fixture's paddle opens
        assertEquals(listOf("paddle pdl_8Kq2Zr"), did)
    }

    @Test fun removeCanBeCalledOffAndSaysWhenItsDone() {
        val api = FakeAccountApi()
        show(api)
        waitFor("Tracker C0FFEE01")
        compose.onNodeWithTag("tracker-C0FFEE01").performClick()
        compose.onNodeWithText("Remove tracker").performScrollTo().performClick()
        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        compose.onNodeWithText("Remove tracker").assertExists()
        compose.onNodeWithText("Remove tracker").performScrollTo().performClick()
        compose.onNodeWithText("Remove").performScrollTo().performClick()
        waitFor("Tracker removed.")
    }
}
