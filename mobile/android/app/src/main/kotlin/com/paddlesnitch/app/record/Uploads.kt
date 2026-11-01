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

    /** Deleting the account: no upload may run on, or remake its folder. */
    fun cancel(context: Context, accountId: String) {
        runCatching { WorkManager.getInstance(context).cancelUniqueWork("phone-upload-$accountId") }
    }

    internal const val ACCOUNT = "account"
    private const val PREFS = "phone"
    private const val INSTALL_ID = "installId"
}

/**
 * The signed-in tokens, but only while [account] is the one signed in: checked on every
 * request, not once, so a sign-in as someone else mid-upload can never send this account's
 * recordings with their token. Otherwise there's no token (Api then says SignedOut), and
 * nothing here clears or saves another account's.
 */
class PinnedTokenStore(private val inner: com.paddlesnitch.app.auth.TokenStore, private val account: String) : com.paddlesnitch.app.auth.TokenStore {
    private val mine get() = inner.userId == account
    override val idToken: String? get() = if (mine) inner.idToken else null
    override val refreshToken: String? get() = if (mine) inner.refreshToken else null
    override var userId: String?
        get() = inner.userId
        set(_) {}   // never moves the account under an upload
    override fun save(idToken: String, refreshToken: String?) { if (mine) inner.save(idToken, refreshToken) }
    override fun clear() { if (mine) inner.clear() }
}

/** One upload run for one account. Only ever as the account that's signed in now. */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val account = inputData.getString(Uploads.ACCOUNT) ?: return Result.success()
        return uploadAs(account, KeystoreTokenStore(applicationContext), Uploads.dir(applicationContext, account),
            server = { tokens -> ApiPhoneAccount(Api(BuildConfig.API_BASE_URL, tokens, BuildConfig.VERSION_NAME)) },
            installId = { Uploads.installId(applicationContext) })
    }
}

/** The track a recording is writing now, if one runs: never uploaded until it stops. */
internal fun runningTrack(): File? = (RecordingService.state.value as? RecordingService.State.Recording)?.files?.track

/**
 * One upload run for [account], as UploadWorker does it: nothing unless [account] is the one
 * signed in, and then only with its own tokens ([PinnedTokenStore]) for every request.
 */
internal suspend fun uploadAs(
    account: String, tokens: com.paddlesnitch.app.auth.TokenStore, dir: File,
    server: (com.paddlesnitch.app.auth.TokenStore) -> PhoneAccount, installId: () -> String,
    running: () -> File? = ::runningTrack,
): androidx.work.ListenableWorker.Result {
    // Signed out, or someone else signed in: their recordings wait for their own sign-in.
    if (tokens.userId != account) return androidx.work.ListenableWorker.Result.success()
    val uploader = PhoneUploader(dir, server(PinnedTokenStore(tokens, account)), installId, recording = running, changed = Uploads::bump)
    return try {
        if (uploader.run()) androidx.work.ListenableWorker.Result.success() else androidx.work.ListenableWorker.Result.retry()
    } catch (e: SignedOut) {
        androidx.work.ListenableWorker.Result.success()   // the next sign-in schedules it again
    } finally {
        Uploads.bump(false)
    }
}
