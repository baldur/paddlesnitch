package com.paddlesnitch.app.record

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.paddlesnitch.app.BuildConfig
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.Phone
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.auth.KeystoreTokenStore
import java.io.File
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive

/** The upload calls on the real server, as the signed-in owner. */
class ApiPhoneAccount(private val api: Api) : PhoneAccount {
    override suspend fun addPhone(installId: String): Phone = api.addPhone(installId)

    override suspend fun upload(deviceId: String, filename: String, bytes: ByteArray, part: Int?, parts: Int?, sha256: String?): UploadReply {
        val query = buildMap {
            put("filename", filename)
            if (part != null && parts != null && sha256 != null) { put("part", "$part"); put("parts", "$parts"); put("sha256", sha256) }
        }
        val a = api.rest("/api/account/devices/$deviceId/sessions", query, bytes, type = "text/csv")
        val o = runCatching { ApiJson.parseToJsonElement(a.body) as? JsonObject }.getOrNull()
        return UploadReply(a.code, (o?.get("error") as? JsonPrimitive)?.takeIf { it.isString }?.content,
            runCatching { o?.get("missing")?.jsonArray?.mapNotNull { it.jsonPrimitive.intOrNull } }.getOrNull().orEmpty())
    }

    override suspend fun held(deviceId: String, filename: String): List<Int> {
        val a = api.rest("/api/account/devices/$deviceId/sessions", mapOf("filename" to filename))
        if (!a.ok) return emptyList()
        return runCatching { ApiJson.decodeFromString(com.paddlesnitch.app.api.HeldParts.serializer(), a.body).parts.map { it.toInt() } }.getOrDefault(emptyList())
    }
}

/**
 * Phone recordings on their way to the server (C3): the upload runs as WorkManager work, on any
 * network, retried with backoff, and carries on after the app closes. Paddles watches [changed]
 * for its lines and [sent] to load the new paddle.
 */
object Uploads {
    private val _changed = MutableStateFlow(0)
    /** Bumps whenever a recording's files or lines change. */
    val changed: StateFlow<Int> = _changed
    private val _sent = MutableStateFlow(0)
    /** Bumps when a track reaches the server, so Paddles loads the list again. */
    val sent: StateFlow<Int> = _sent

    internal fun bump(sentTrack: Boolean) { _changed.update { it + 1 }; if (sentTrack) _sent.update { it + 1 } }

    /** This account's folder of recordings. */
    fun dir(context: Context, accountId: String): File = RecordingFiles.accountDir(RecordingService.recordingsDir(context), accountId)

    /** Uploads what's waiting for [accountId], now or when there's a network. */
    fun schedule(context: Context, accountId: String) {
        val work = OneTimeWorkRequestBuilder<UploadWorker>()
            .setInputData(workDataOf(ACCOUNT to accountId))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        // One run at a time per account; a new ask while one runs goes after it, so a file stopped now isn't missed.
        WorkManager.getInstance(context).enqueueUniqueWork("phone-upload-$accountId", ExistingWorkPolicy.APPEND_OR_REPLACE, work)
        _changed.update { it + 1 }
    }

    /** Start or Upload now: a removed phone may be added again, then what's waiting goes. */
    fun allowAddingAndSchedule(context: Context, accountId: String) {
        PhoneUploader.allowAdding(dir(context, accountId))
        schedule(context, accountId)
    }

    /** After every sign-in: ask the server for this phone again (it's the same phone for the same account and install). */
    fun signedIn(context: Context, accountId: String) {
        PhoneUploader.signedIn(dir(context, accountId))
        schedule(context, accountId)
    }

    /**
     * This install's id: random, made once and kept with the app's own settings (never a
     * hardware or advertising id). Left out of backups and transfers (data_extraction_rules),
     * so a new phone is a new install.
     */
    fun installId(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(INSTALL_ID, null)?.let { return it }
        val id = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(24).also { SecureRandom().nextBytes(it) })
        prefs.edit().putString(INSTALL_ID, id).commit()
        return id
    }

    internal const val ACCOUNT = "account"
    private const val PREFS = "phone"
    private const val INSTALL_ID = "installId"
}

/** One upload run for one account. Only ever as the account that's signed in now. */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val account = inputData.getString(Uploads.ACCOUNT) ?: return Result.success()
        val tokens = KeystoreTokenStore(applicationContext)
        // Signed out, or someone else signed in: their recordings wait for their own sign-in.
        if (tokens.userId != account) return Result.success()
        val api = Api(BuildConfig.API_BASE_URL, tokens, BuildConfig.VERSION_NAME)
        val uploader = PhoneUploader(
            Uploads.dir(applicationContext, account), ApiPhoneAccount(api),
            installId = { Uploads.installId(applicationContext) },
            recording = { (RecordingService.state.value as? RecordingService.State.Recording)?.files?.track },
            changed = Uploads::bump,
        )
        return try {
            if (uploader.run()) Result.success() else Result.retry()
        } catch (e: SignedOut) {
            Result.success()   // the next sign-in schedules it again
        } finally {
            Uploads.bump(false)
        }
    }
}
