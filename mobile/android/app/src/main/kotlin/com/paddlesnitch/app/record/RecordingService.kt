package com.paddlesnitch.app.record

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import com.paddlesnitch.app.MainActivity
import com.paddlesnitch.app.R
import com.paddlesnitch.app.auth.KeystoreTokenStore
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Runs a recording (PhoneRecorder) as a foreground service of type location,
 * with a partial wake lock, so it carries on with the screen off
 * (docs/features/android-app.md, Recording). Start it while the app is on
 * screen: Android lets a location service start only then. Declared in the
 * debug manifest only, until recordings upload.
 */
class RecordingService : Service() {
    private var recorder: PhoneRecorder? = null
    private var startedAt = 0L
    private var wake: PowerManager.WakeLock? = null
    private val main = Handler(Looper.getMainLooper())

    /** Makes the recorder for an account's folder; tests swap in their own. */
    internal var makeRecorder: (Context, File) -> PhoneRecorder = { c, dir -> PhoneRecorder(c, dir) }

    /** Who's signed in now; tests swap in their own. */
    internal var signedInAccount: (Context) -> String? = { KeystoreTokenStore(it).userId }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopRecording(); return START_NOT_STICKY }
            // A start, or the system bringing a killed recording back (null
            // intent): either way a new pair of files, as the tracker does.
            else -> if (recorder == null && !startRecording(restarted = intent == null)) return START_NOT_STICKY
        }
        return START_STICKY
    }

    /**
     * The account a recording goes to: whoever was signed in when it started. A restart
     * after a kill reads it back from the service's own note, never from whoever is
     * signed in by then (someone else may be).
     */
    private fun accountFor(restarted: Boolean): String {
        val note = getSharedPreferences(PREFS, MODE_PRIVATE)
        val account = if (restarted) note.getString(ACCOUNT, null) else signedInAccount(this)
        checkNotNull(account) { "no account for the recording" }
        note.edit().putString(ACCOUNT, account).apply()
        return account
    }

    private fun forgetAccount() = getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(ACCOUNT).apply()

    private fun startRecording(restarted: Boolean): Boolean = try {
        startForeground(NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        // A backstop: a recording that's never stopped mustn't hold the phone awake for ever.
        wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "paddlesnitch:recording").apply { acquire(MAX_RECORDING_MS) }
        val r = makeRecorder(this, RecordingFiles.accountDir(recordingsDir(this), accountFor(restarted)))
        val files = r.start()   // on failure it has already undone itself
        recorder = r
        startedAt = SystemClock.elapsedRealtime()
        _state.value = State.Recording(files, r.live, startedAt)
        true
    } catch (e: Exception) {
        Log.w(TAG, "couldn't start recording", e)
        _state.value = State.Failed(locationRefused = e is SecurityException)
        forgetAccount()
        releaseAndStop()
        false
    }

    /** Ends the recording off the main thread (finishing writes what's held), then lets go. */
    private fun stopRecording() {
        val r = recorder ?: run { if (_state.value is State.Recording) _state.value = State.Idle; releaseAndStop(); return }
        recorder = null
        forgetAccount()
        val elapsed = SystemClock.elapsedRealtime() - startedAt
        Thread({
            val files = runCatching { r.stop() }.onFailure { Log.w(TAG, "couldn't finish the recording", it) }.getOrNull()
            main.post {
                _state.value = files?.let { State.Stopped(it, elapsed) } ?: State.Idle
                releaseAndStop()
            }
        }, "recorder-stop").start()
    }

    private fun releaseAndStop() {
        wake?.takeIf { it.isHeld }?.release()
        wake = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        recorder?.let { r -> recorder = null; runCatching { r.stop() } }
        wake?.takeIf { it.isHeld }?.release()
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Recording", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, RecordingService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val stopAction = Notification.Action.Builder(null, "Stop recording", stop)
            // On the lock screen, stopping needs an unlock: a wet drybag mustn't end a paddle.
            .apply { if (Build.VERSION.SDK_INT >= 31) setAuthenticationRequired(true) }
            .build()
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_recording)
            .setContentTitle("Recording a paddle")
            .setContentText("Tap to open paddlesnitch.")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(stopAction)
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    sealed interface State {
        data object Idle : State
        /** Asked to start; waiting for permission or the service. */
        data object Starting : State
        /** [startedAt] is SystemClock.elapsedRealtime() at the start, for the elapsed time on screen. */
        data class Recording(val files: RecordingFiles, val live: StateFlow<RecorderCore.Live?>, val startedAt: Long) : State
        data class Stopped(val files: RecordingFiles, val elapsedMs: Long) : State
        /** [locationRefused]: the person said no to location (Settings can change that). */
        data class Failed(val locationRefused: Boolean) : State
    }

    companion object {
        private const val TAG = "RecordingService"
        private const val CHANNEL = "recording"
        private const val NOTIFICATION = 1
        internal const val ACTION_STOP = "com.paddlesnitch.app.record.STOP"
        private const val PREFS = "recording"
        private const val ACCOUNT = "account"
        private const val MAX_RECORDING_MS = 12 * 60 * 60 * 1000L

        private val _state = MutableStateFlow<State>(State.Idle)
        val state: StateFlow<State> = _state

        /** Where recordings are kept until they're uploaded (app-private), a folder per account inside. */
        fun recordingsDir(context: Context) = File(context.filesDir, "recordings")

        fun start(context: Context) { context.startForegroundService(Intent(context, RecordingService::class.java)) }
        fun stop(context: Context) { context.startService(Intent(context, RecordingService::class.java).setAction(ACTION_STOP)) }
        internal fun set(state: State) { _state.value = state }

        /** Signed out or deleted: a finished recording's message isn't the next person's. */
        fun forgetFinished() { if (_state.value !is State.Recording) _state.value = State.Idle }
    }
}
