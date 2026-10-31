package com.paddlesnitch.app.record

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import com.paddlesnitch.app.MainActivity
import com.paddlesnitch.app.R
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Runs a recording (PhoneRecorder) as a foreground service of type location,
 * with a partial wake lock, so it carries on with the screen off
 * (docs/features/android-app.md, Recording). Start it while the app is on
 * screen: Android lets a location service start only then.
 */
class RecordingService : Service() {
    private var recorder: PhoneRecorder? = null
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopRecording(); return START_NOT_STICKY }
            // A start, or the system bringing a killed recording back (null
            // intent): either way a new pair of files, as the tracker does.
            else -> if (recorder == null && !startRecording()) return START_NOT_STICKY
        }
        return START_STICKY
    }

    private fun startRecording(): Boolean = try {
        startForeground(NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "paddlesnitch:recording").apply { acquire() }
        val r = PhoneRecorder(this, recordingsDir(this))
        val files = r.start()
        recorder = r
        _state.value = State.Recording(files, r.live, android.os.SystemClock.elapsedRealtime())
        true
    } catch (e: Exception) {
        // No location permission, or started from the background: nothing to record with.
        Log.w(TAG, "couldn't start recording", e)
        _state.value = State.Failed
        releaseAndStop()
        false
    }

    private fun stopRecording() {
        val files = recorder?.stop()
        recorder = null
        _state.value = files?.let { State.Stopped(it) } ?: State.Idle
        releaseAndStop()
    }

    private fun releaseAndStop() {
        wake?.takeIf { it.isHeld }?.release()
        wake = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (recorder != null) stopRecording()
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Recording", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, RecordingService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_recording)
            .setContentTitle("Recording a paddle")
            .setContentText("Open the app to see it, or stop here.")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    sealed interface State {
        data object Idle : State
        /** [startedAt] is SystemClock.elapsedRealtime() at the start, for the elapsed time on screen. */
        data class Recording(val files: RecordingFiles, val live: StateFlow<RecorderCore.Live?>, val startedAt: Long) : State
        data class Stopped(val files: RecordingFiles) : State
        data object Failed : State
    }

    companion object {
        private const val TAG = "RecordingService"
        private const val CHANNEL = "recording"
        private const val NOTIFICATION = 1
        private const val ACTION_STOP = "com.paddlesnitch.app.record.STOP"

        private val _state = MutableStateFlow<State>(State.Idle)
        val state: StateFlow<State> = _state

        /** Where recordings are kept until they're uploaded (app-private). */
        fun recordingsDir(context: Context) = File(context.filesDir, "recordings")

        fun start(context: Context) { context.startForegroundService(Intent(context, RecordingService::class.java)) }
        /** Location wasn't allowed. */
        fun failed() { _state.value = State.Failed }
        fun stop(context: Context) { context.startService(Intent(context, RecordingService::class.java).setAction(ACTION_STOP)) }
    }
}
