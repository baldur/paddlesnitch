package com.paddlesnitch.app.tracker

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.companion.AssociationInfo
import android.companion.AssociationRequest
import android.companion.BluetoothLeDeviceFilter
import android.companion.CompanionDeviceManager
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.concurrent.Executor

/**
 * Finding the tracker the Android way: CompanionDeviceManager shows the
 * system's own "pair with PT-17C?" sheet (no scanning screen of ours, and no
 * location permission), and the app remembers the tracker for "Sync now".
 */
object TrackerCompanion {
    /** Connecting needs BLUETOOTH_CONNECT on Android 12+; Android 10–11 need nothing at run time for this. */
    val permissions: Array<String> = if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_CONNECT) else emptyArray()

    fun hasPermissions(context: Context) = permissions.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    private fun adapter(context: Context) = context.getSystemService(BluetoothManager::class.java)?.adapter

    enum class Radio { Missing, Off, On }
    fun radio(context: Context) = adapter(context).let { a -> if (a == null) Radio.Missing else if (a.isEnabled) Radio.On else Radio.Off }

    /** The paddlesnitch service id is in every tracker's advertisement; the name (PT-xxx) is in its scan response. */
    private fun request(): AssociationRequest = AssociationRequest.Builder()
        .addDeviceFilter(BluetoothLeDeviceFilter.Builder()
            .setScanFilter(ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(Gatt.SERVICE)).build())
            .build())
        .setSingleDevice(false)
        .build()

    /** Opens the system's chooser; [onChooser] gets the sheet to launch, [onFailure] why there's none. */
    fun associate(context: Context, onChooser: (IntentSender) -> Unit, onFailure: (String?) -> Unit) {
        val cdm = context.getSystemService(CompanionDeviceManager::class.java) ?: return onFailure(null)
        val callback = object : CompanionDeviceManager.Callback() {
            override fun onAssociationPending(intentSender: IntentSender) = onChooser(intentSender)
            @Deprecated("Android 12 and older")
            override fun onDeviceFound(intentSender: IntentSender) = onChooser(intentSender)
            override fun onAssociationCreated(associationInfo: AssociationInfo) {}
            override fun onFailure(error: CharSequence?) { Log.w(TAG, "associate failed: $error"); onFailure(error?.toString()) }
        }
        if (Build.VERSION.SDK_INT >= 33) cdm.associate(request(), Executor { context.mainExecutor.execute(it) }, callback)
        else @Suppress("DEPRECATION") cdm.associate(request(), callback, null)
    }

    /** The tracker the person chose in the system sheet. */
    fun chosen(context: Context, data: Intent?): BluetoothDevice? {
        data ?: return null
        @Suppress("DEPRECATION")
        when (val d = data.getParcelableExtra<android.os.Parcelable>(CompanionDeviceManager.EXTRA_DEVICE)) {
            is ScanResult -> return d.device
            is BluetoothDevice -> return d
        }
        if (Build.VERSION.SDK_INT >= 33) {
            val info = data.getParcelableExtra(CompanionDeviceManager.EXTRA_ASSOCIATION, AssociationInfo::class.java)
            info?.deviceMacAddress?.toString()?.uppercase()?.let { return byAddress(context, it) }
        }
        return null
    }

    fun byAddress(context: Context, address: String): BluetoothDevice? = runCatching { adapter(context)?.getRemoteDevice(address) }.getOrNull()

    private fun prefs(context: Context) = context.getSharedPreferences("tracker", Context.MODE_PRIVATE)

    /** The tracker this phone set up last, so "Sync now" needs no chooser. */
    fun remembered(context: Context): Pair<String, String>? {
        val p = prefs(context)
        val address = p.getString("address", null) ?: return null
        return address to (p.getString("name", null) ?: "your tracker")
    }

    fun remember(context: Context, address: String, name: String) =
        prefs(context).edit().putString("address", address).putString("name", name).apply()

    fun forget(context: Context) = prefs(context).edit().clear().apply()
}
