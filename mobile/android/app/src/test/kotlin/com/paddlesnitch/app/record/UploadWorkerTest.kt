package com.paddlesnitch.app.record

import android.app.Application
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.WorkManagerTestInitHelper
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.Phone
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.auth.MemoryTokenStore
import com.paddlesnitch.app.ui.PaddlesnitchTheme
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// What UploadWorker does around PhoneUploader (tester, C3): only the signed-in account, only
// with its tokens, never the recording still running; and Paddles' Upload now.
@RunWith(RobolectricTestRunner::class)
class UploadWorkerTest {
    @get:Rule val compose = createComposeRule()
    private val app = ApplicationProvider.getApplicationContext<Application>()
    private val dir = File(app.filesDir, "recordings/a").apply { mkdirs() }
    private val phone = ApiJson.decodeFromString(Phone.serializer(), File("../../contract/fixtures/api/account.phone.json").readText())
    @After fun tearDown() { dir.deleteRecursively(); RecordingService.set(RecordingService.State.Idle) }

    private val sent = mutableListOf<String>()
    private val tokensSeen = mutableListOf<String?>()
    private fun server(t: com.paddlesnitch.app.auth.TokenStore) = object : PhoneAccount {
        override suspend fun addPhone(installId: String): Phone { tokensSeen += t.idToken; if (t.idToken == null) throw SignedOut(); return phone }
        override suspend fun upload(deviceId: String, filename: String, bytes: ByteArray, part: Int?, parts: Int?, sha256: String?): UploadReply {
            tokensSeen += t.idToken; sent += filename; return UploadReply(201)
        }
        override suspend fun held(deviceId: String, filename: String) = emptyList<Int>()
    }
    private fun recording(base: String) { File(dir, "$base.csv").writeText("timestamp\n1\n"); File(dir, "${base}_i10.csv").writeText("t\n1\n") }
    private fun run(tokens: MemoryTokenStore) = runBlocking { uploadAs("a", tokens, dir, ::server, { "install-id-0123456789" }) }
    private fun signedInAs(who: String) = MemoryTokenStore().apply { save("id-$who", "r-$who"); userId = who }

    @Test fun someoneElseSignedInUploadsNothingAndKeepsEverything() {
        recording("track_20261101_070211")
        assertEquals(ListenableWorker.Result.success(), run(signedInAs("b")))
        assertEquals(emptyList<String>(), sent)
        assertTrue(File(dir, "track_20261101_070211.csv").exists())
    }

    @Test fun theSignedInAccountUploadsWithItsOwnToken() {
        recording("track_20261101_070211")
        assertEquals(ListenableWorker.Result.success(), run(signedInAs("a")))
        assertEquals(listOf("track_20261101_070211.csv", "track_20261101_070211_imu.csv"), sent)
        assertEquals(setOf("id-a"), tokensSeen.toSet())
    }

    @Test fun theRecordingRunningNowIsLeftAlone() {
        recording("track_20261101_070211"); recording("track_20261101_090000")
        RecordingService.set(RecordingService.State.Recording(RecordingFiles(File(dir, "track_20261101_090000.csv"), File(dir, "track_20261101_090000_i10.csv")),
            MutableStateFlow(null), 0L))
        run(signedInAs("a"))
        assertEquals(listOf("track_20261101_070211.csv", "track_20261101_070211_imu.csv"), sent)
        assertTrue(File(dir, "track_20261101_090000.csv").exists())
    }

    @Test fun signedOutMidRunStopsAndWaitsForTheNextSignIn() {
        recording("track_20261101_070211")
        val tokens = signedInAs("a")
        val r = runBlocking {
            uploadAs("a", tokens, dir, { t -> tokens.clear(); tokens.save("id-b", "r-b"); tokens.userId = "b"; server(t) }, { "install-id-0123456789" })
        }
        assertEquals(ListenableWorker.Result.success(), r)
        assertEquals("B's token is never used", listOf<String?>(null), tokensSeen)
        assertTrue(File(dir, "track_20261101_070211.csv").exists())
    }

    @Test fun aDeletedAccountSignsOutOnlyThatAccount() {
        recording("track_20261101_070211")
        val tokens = signedInAs("a")
        var told = 0
        val deleted = { _: com.paddlesnitch.app.auth.TokenStore -> object : PhoneAccount {
            override suspend fun addPhone(installId: String): Phone = throw com.paddlesnitch.app.api.ApiFailure("Gone", 410)
            override suspend fun upload(deviceId: String, filename: String, bytes: ByteArray, part: Int?, parts: Int?, sha256: String?) = UploadReply(201)
            override suspend fun held(deviceId: String, filename: String) = emptyList<Int>()
        } }
        assertEquals(ListenableWorker.Result.success(), runBlocking { uploadAs("a", tokens, dir, deleted, { "install-id-0123456789" }, accountDeleted = { told++ }) })
        assertEquals(null, tokens.refreshToken)
        assertEquals(1, told)
        assertFalse(dir.exists())
    }

    @Test fun aDeletedAccountStopsItsOwnRecordingOnly() {
        val mine = Uploads.dir(app, "a").apply { mkdirs() }
        RecordingService.set(RecordingService.State.Recording(RecordingFiles(File(mine, "t.csv"), File(mine, "t_i10.csv")), MutableStateFlow(null), 0L))
        Uploads.accountDeleted(app, "b")
        assertEquals(null, org.robolectric.Shadows.shadowOf(app).nextStartedService)
        Uploads.accountDeleted(app, "a")
        assertEquals(RecordingService.ACTION_STOP, org.robolectric.Shadows.shadowOf(app).nextStartedService?.action)
        assertEquals("a", Uploads.deleted.value)
    }

    @Test fun aServerErrorAsksForARetry() {
        recording("track_20261101_070211")
        val failing = { _: com.paddlesnitch.app.auth.TokenStore -> object : PhoneAccount {
            override suspend fun addPhone(installId: String) = phone
            override suspend fun upload(deviceId: String, filename: String, bytes: ByteArray, part: Int?, parts: Int?, sha256: String?) = UploadReply(503)
            override suspend fun held(deviceId: String, filename: String) = emptyList<Int>()
        } }
        assertEquals(ListenableWorker.Result.retry(), runBlocking { uploadAs("a", signedInAs("a"), dir, failing, { "install-id-0123456789" }) })
    }

    @Test fun uploadNowLetsARemovedPhoneBeAddedAgain() {
        WorkManagerTestInitHelper.initializeTestWorkManager(app)
        recording("track_20261101_070211")
        File(dir, "phone-off").writeText("")
        val accountDir = Uploads.dir(app, "a")
        assertEquals(dir.canonicalFile, accountDir.canonicalFile)
        compose.setContent { PaddlesnitchTheme { UploadLines("a", onReport = {}) } }
        compose.onNodeWithText(PHONE_REMOVED).assertExists()
        compose.onNodeWithText("Upload now").performClick()
        assertFalse(File(accountDir, "phone-off").exists())
    }

    @Test fun locationOffComesFirstAndRefusedOnlyOnceAsked() {
        assertEquals(LocationReady.Off, locationReady(granted = false, asked = false, enabled = false))
        assertEquals(LocationReady.Off, locationReady(granted = true, asked = true, enabled = false))
        assertEquals(LocationReady.Ready, locationReady(granted = false, asked = false, enabled = true))   // Start asks
        assertEquals(LocationReady.Refused, locationReady(granted = false, asked = true, enabled = true))
        assertEquals(LocationReady.Ready, locationReady(granted = true, asked = true, enabled = true))
    }
}
