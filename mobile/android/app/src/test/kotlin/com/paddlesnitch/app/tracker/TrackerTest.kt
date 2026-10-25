package com.paddlesnitch.app.tracker

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

// Setup and sync against a fake tracker and a fake paddlesnitch.com. Delays
// and time limits run on the test's virtual clock, at their real values.
class TrackerTest {
    private val big = { rows: Int -> (0 until rows).joinToString("\n") { "$it,0.0${it % 10},0.02,1.00,${it % 50}.5,1.2,0.3" } }

    private fun linkedPair(files: MutableMap<String, String>): Triple<FakeTracker, FakeAccount, Tracker> {
        val fake = FakeTracker(files = files, token = "tok", refusals = 0)
        val account = FakeAccount(mutableSetOf(fake.id), sha256Hex("tok"))
        return Triple(fake, account, Tracker(fake))
    }

    @Test fun pairsWhenAndroidRefusesTheFirstReadsAndOneNeverAnswers() = runTest {
        val fake = FakeTracker(refusals = 2, hangs = 1)
        val t = Tracker(fake)
        assertTrue(t.waitUntilPaired())
        assertEquals(1, fake.pairingAsked)
        assertTrue(fake.paired)
    }

    @Test fun givesUpOnPairingAfterAboutThirtySeconds() = runTest {
        val t = Tracker(FakeTracker(neverPairs = true))
        val start = testScheduler.currentTime
        assertFalse(t.waitUntilPaired())
        assertEquals(7 * 1500L, testScheduler.currentTime - start)   // refusals answer at once: only the gaps count
        val hanging = Tracker(FakeTracker(hangs = 99))
        val s2 = testScheduler.currentTime
        assertFalse(hanging.waitUntilPaired())
        assertEquals(8 * 3000L + 7 * 1500L, testScheduler.currentTime - s2)
    }

    @Test fun aboutIsReadableBeforePairing() = runTest {
        val a = Tracker(FakeTracker(neverPairs = true, files = mutableMapOf("track_a.csv" to "x"))).about()!!
        assertEquals("435AC17C", a.id)
        assertEquals(1, a.waiting)
        assertFalse(a.linked)
    }

    @Test fun linkingRegistersOnlyTheHashThenTheTrackerKeepsItsOwnToken() = runTest {
        val fake = FakeTracker()
        val account = FakeAccount()
        val t = Tracker(fake)
        t.waitUntilPaired()
        assertEquals(LinkOutcome.Linked, t.linkTo(account, t.about()!!))
        val (id, hash, sig, model, fw) = account.linkCalls.single()
        assertEquals("435AC17C", id); assertEquals("c2lnbmF0dXJl", sig); assertEquals("lilygo-tbeam-s3-supreme", model); assertEquals("0.19.3", fw)
        assertEquals(sha256Hex(fake.token!!), hash)
        // The token itself never left the tracker.
        assertFalse(account.linkCalls.flatten().any { it == fake.token })
        assertFalse(fake.writes.any { fake.token!! in it.second })
        assertTrue(t.about()!!.linked)
        assertEquals(Ownership.Yours, ownership(t.about()!!, account.mine))
    }

    @Test fun aRefusedLinkSaysWhyAndTheTrackerKeepsItsOldState() = runTest {
        val fake = FakeTracker(token = "old")
        val account = FakeAccount().apply { linkError = 409 to "owned_elsewhere" }
        val t = Tracker(fake)
        t.waitUntilPaired()
        val r = t.linkTo(account, t.about()!!)
        assertEquals(LinkOutcome.Refused("This tracker is on another account. Its owner needs to remove it first."), r)
        assertEquals("old", fake.token)
        assertFalse(fake.writes.any { "commit" in it.second })
    }

    @Test fun wifiReportsWhatTheTrackerFound() = runTest {
        val fake = FakeTracker(wifi = { _, pass -> if (pass == "right") WifiState.Joined else WifiState.WrongPassword })
        val t = Tracker(fake)
        t.waitUntilPaired()
        assertEquals(WifiState.WrongPassword, t.tryWifi("Boathouse", "wrong"))
        assertNull(fake.savedNetwork)
        assertEquals(WifiState.Joined, t.tryWifi("Boathouse", "right"))
        assertEquals("Boathouse", fake.savedNetwork)
    }

    @Test fun wifiThatNeverDecidesSaysSoAfterTheWait() = runTest {
        val t = Tracker(FakeTracker(wifiReadsToDecide = 1000))
        t.waitUntilPaired()
        val start = testScheduler.currentTime
        assertNull(t.tryWifi("Boathouse", "x"))
        assertEquals(30 * 1500L, testScheduler.currentTime - start)
    }

    @Test fun syncSendsEveryRecordingByteExactTrackFirstAndMarksEachWithItsReceipt() = runTest {
        val files = mutableMapOf("track_a.csv" to "timestamp,lat,lon\n" + big(2000), "track_a_i10.csv" to "ms,ax_g\n" + big(9000))
        val original = files.toMap()
        val (fake, account, t) = linkedPair(files)
        t.waitUntilPaired()
        val order = mutableListOf<String>()
        val r = t.sync(account, t.about()!!) { if (it.part == 1) order += it.name }
        assertEquals(SyncResult(2, emptyList()), r)
        assertEquals(listOf("track_a.csv", "track_a_i10.csv"), order)
        assertEquals(original["track_a.csv"], account.assembled["track_a.csv"])
        // The motion file goes up under the name the server knows it by, in several pieces.
        assertEquals(original["track_a_i10.csv"], account.assembled["track_a_imu.csv"])
        assertTrue(account.uploads.count { it.first == "track_a_imu.csv" } > 1)
        assertEquals(listOf("track_a.csv", "track_a_i10.csv"), fake.marked)
    }

    @Test fun aLostPageIsReadAgainNotSplicedIn() = runTest {
        val file = "timestamp,lat,lon\n" + big(3000)
        val (fake, account, t) = linkedPair(mutableMapOf("track_p.csv" to file))
        fake.skipPageAt = 1000
        t.waitUntilPaired()
        assertEquals(1, t.sync(account, t.about()!!).sent)
        assertEquals(file, account.assembled["track_p.csv"])
        assertTrue(fake.writes.any { it.first == Gatt.DATA && "seek" in it.second })
    }

    @Test fun alreadyUploadedStillGetsTheRecordingMarked() = runTest {
        val (fake, account, t) = linkedPair(mutableMapOf("track_b.csv" to "x\n1"))
        account.assembled["track_b.csv"] = "x\n1"
        t.waitUntilPaired()
        assertEquals(1, t.sync(account, t.about()!!).sent)
        assertEquals(listOf("track_b.csv"), fake.marked)
    }

    @Test fun aReceiptTheTrackerDoesNotAcceptLeavesTheRecordingWaiting() = runTest {
        val (fake, account, t) = linkedPair(mutableMapOf("track_c.csv" to "x\n1"))
        account.tokenHash = sha256Hex("someone-else")
        t.waitUntilPaired()
        val r = t.sync(account, t.about()!!)
        assertEquals(SyncResult(0, listOf("track_c.csv" to FailReason.Receipt)), r)
        assertTrue(fake.marked.isEmpty())
        assertTrue("track_c.csv" in fake.files)
    }

    @Test fun oneUnusableRecordingDoesNotStopTheNext() = runTest {
        val (fake, account, t) = linkedPair(mutableMapOf("track_d.csv" to "x\n1", "track_e.csv" to "y\n2"))
        account.reject = mapOf("track_d.csv" to Reply(422, "no_points"))
        t.waitUntilPaired()
        val r = t.sync(account, t.about()!!)
        assertEquals(SyncResult(1, listOf("track_d.csv" to FailReason.Unusable)), r)
        assertEquals(listOf("track_e.csv"), fake.marked)
        assertEquals("1 recording sent. It’ll appear in Paddles in a minute or so. 1 couldn’t be used (no GPS in it).", Messages.synced(r))
    }

    @Test fun aSyncThatBrokeOffCarriesOnFromWhereItStopped() = runTest {
        val file = "timestamp,lat,lon\n" + big(20000)
        val (fake, account, t) = linkedPair(mutableMapOf("track_f.csv" to file))
        account.failAt = 4
        t.waitUntilPaired()
        val first = t.sync(account, t.about()!!)
        assertEquals(SyncResult(0, listOf("track_f.csv" to FailReason.Failed)), first)
        assertEquals(setOf(1, 2, 3), account.staged["track_f.csv"]!!.keys)
        val sentParts = mutableListOf<Int>()
        var parts = 0
        assertEquals(SyncResult(1, emptyList()), t.sync(account, t.about()!!) { sentParts += it.part; parts = it.parts })
        assertEquals((4..parts).toList(), sentParts)
        assertEquals(file, account.assembled["track_f.csv"])
        assertEquals(listOf("track_f.csv"), fake.marked)
    }

    @Test fun whenEveryPieceArrivedButTheAnswerWasLostOnlyTheLastGoesAgain() = runTest {
        val file = "timestamp,lat,lon\n" + big(20000)
        val (_, account, t) = linkedPair(mutableMapOf("track_g.csv" to file))
        val raw = file.encodeToByteArray()
        val parts = (raw.size + FakeTracker.PIECE - 1) / FakeTracker.PIECE
        account.staged["track_g.csv"] = (1..parts).associateWith { raw.copyOfRange((it - 1) * FakeTracker.PIECE, minOf(raw.size, it * FakeTracker.PIECE)) }.toMutableMap()
        t.waitUntilPaired()
        val sent = mutableListOf<Int>()
        assertEquals(1, t.sync(account, t.about()!!) { sent += it.part }.sent)
        assertEquals(listOf(parts), sent)
        assertEquals(file, account.assembled["track_g.csv"])
    }

    @Test fun aRecordingTrackerStopsTheSyncWithAClearReason() = runTest {
        val (fake, account, t) = linkedPair(mutableMapOf("track_h.csv" to "x"))
        fake.recording = true
        t.waitUntilPaired()
        val e = runCatching { t.sync(account, t.about()!!) }.exceptionOrNull()
        assertTrue(e is TrackerError.Recording)
        assertEquals(Messages.RECORDING, Messages.trouble(e!!, t.name))
    }

    @Test fun nothingWaitingSaysSo() = runTest {
        val (_, account, t) = linkedPair(mutableMapOf())
        t.waitUntilPaired()
        val r = t.sync(account, t.about()!!)
        assertEquals("Nothing new to send.", Messages.synced(r))
    }

    @Test fun anItemMissingFromThePhonesCopyAsksToForgetAndPairAgain() = runTest {
        val fake = FakeTracker(missing = setOf(Gatt.WIFI))
        val t = Tracker(fake)
        t.waitUntilPaired()
        val e = assertThrows(TrackerError.NotThere::class.java) { kotlinx.coroutines.runBlocking { t.tryWifi("a", "b") } }
        assertTrue(Messages.trouble(e, "PT-17C").contains("forget PT-17C"))
    }

    @Test fun theWholeSetupFromANewTrackerToAPaddleInPaddles() = runTest {
        val fake = FakeTracker(refusals = 1, files = mutableMapOf("track_20261025_070000.csv" to "timestamp,lat,lon\n" + big(500)))
        val account = FakeAccount()
        val t = Tracker(fake)
        val about = t.about()!!
        assertEquals(Ownership.Unlinked, ownership(about, account.myTrackerIds()))
        assertTrue(t.waitUntilPaired())
        assertEquals(LinkOutcome.Linked, t.linkTo(account, about))
        assertEquals(WifiState.Joined, t.tryWifi("Home", "pw"))
        val r = t.sync(account, t.about()!!)
        assertEquals(SyncResult(1, emptyList()), r)
        assertTrue(account.assembled.containsKey("track_20261025_070000.csv"))
        assertEquals(0, t.about()!!.waiting)
    }

    @Test fun wifiDetailsTheTrackerCannotTakeAreCaughtBeforeSending() {
        assertEquals("Type the network’s name.", Messages.wifiInput(" ", "x"))
        assertNotNull(Messages.wifiInput("x".repeat(33), ""))
        assertNotNull(Messages.wifiInput("ñ".repeat(17), ""))   // 34 bytes: the tracker counts bytes
        assertNotNull(Messages.wifiInput("Home", "p".repeat(65)))
        assertNull(Messages.wifiInput("Home", "p".repeat(64)))
    }
}
