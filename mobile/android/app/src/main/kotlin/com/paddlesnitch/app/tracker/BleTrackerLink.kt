package com.paddlesnitch.app.tracker

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.content.Context
import android.os.Build
import android.util.Log
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull

const val TAG = "PsTracker"

/**
 * [TrackerLink] over Android's GATT client: one operation at a time (Android
 * drops a second one while the first is out), each with its own time limit,
 * a 517-byte MTU so a DATA page is a single read, and the phone's cached copy
 * of the tracker's items refreshed when it doesn't match the firmware's layout
 * (a phone paired before an update kept the old list, 2026-10-05).
 */
@SuppressLint("MissingPermission")   // the screen asks for BLUETOOTH_CONNECT before connecting
class BleTrackerLink private constructor(private val device: BluetoothDevice) : TrackerLink {
    override val name: String = runCatching { device.name }.getOrNull() ?: "your tracker"

    private var gatt: BluetoothGatt? = null
    private val ops = Mutex()
    private val items = mutableMapOf<String, BluetoothGattCharacteristic>()
    private val connected = CompletableDeferred<Unit>()
    @Volatile private var discovered = CompletableDeferred<Int>()
    @Volatile private var mtu = CompletableDeferred<Int>()
    @Volatile private var waiter: CompletableDeferred<Pair<Int, ByteArray>>? = null
    /** An operation given up on that may still answer: let it, before the next. */
    @Volatile private var stale: CompletableDeferred<Pair<Int, ByteArray>>? = null
    @Volatile private var gone = false

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            Log.i(TAG, "connection state $newState (status $status)")
            if (newState == BluetoothProfile.STATE_CONNECTED) connected.complete(Unit)
            else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                gone = true
                val e = TrackerError.Gone()
                connected.completeExceptionally(e); discovered.completeExceptionally(e); mtu.completeExceptionally(e)
                waiter?.completeExceptionally(e)
                g.close()
            }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) { discovered.complete(status) }
        override fun onMtuChanged(g: BluetoothGatt, value: Int, status: Int) { mtu.complete(value) }
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
            finish(status, value)
        }
        @Deprecated("Android 12 and older")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            // Android 13+ calls both overloads; only the old one exists before.
            @Suppress("DEPRECATION")
            if (Build.VERSION.SDK_INT < 33) finish(status, c.value ?: ByteArray(0))
        }
        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) { finish(status, ByteArray(0)) }
    }

    private fun finish(status: Int, value: ByteArray) {
        val w = waiter ?: stale
        w?.complete(status to value)
    }

    override suspend fun startPairing() {
        if (device.bondState == BluetoothDevice.BOND_NONE) Log.i(TAG, "createBond: ${device.createBond()}")
    }

    override suspend fun read(uuid: String) = op(uuid, "read") { g, c -> g.readCharacteristic(c) }

    override suspend fun write(uuid: String, value: ByteArray) {
        op(uuid, "write") { g, c ->
            if (Build.VERSION.SDK_INT >= 33) g.writeCharacteristic(c, value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
            else @Suppress("DEPRECATION") run {
                c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                c.value = value
                g.writeCharacteristic(c)
            }
        }
    }

    private suspend fun op(uuid: String, what: String, start: (BluetoothGatt, BluetoothGattCharacteristic) -> Boolean): ByteArray = ops.withLock {
        val g = gatt?.takeIf { !gone } ?: throw TrackerError.Gone()
        val c = items[uuid] ?: throw TrackerError.NotThere(uuid)
        stale?.let { withTimeoutOrNull(2_000) { runCatching { it.await() } }; stale = null }
        val w = CompletableDeferred<Pair<Int, ByteArray>>()
        waiter = w
        try {
            // Android says no while it's still finishing something (bonding, a late answer).
            var started = false
            for (i in 0 until 10) {
                started = start(g, c)
                if (started || gone) break
                delay(150)
            }
            if (!started) throw if (gone) TrackerError.Gone() else TrackerError.NoAnswer()
            val (status, value) = try {
                withTimeout(OP_TIMEOUT_MS) { w.await() }
            } catch (e: CancellationException) {
                stale = w
                Log.w(TAG, "$what ${uuid.take(8)}: no answer")
                if (currentCoroutineContext().isActive) throw TrackerError.NoAnswer() else throw e
            }
            when (status) {
                BluetoothGatt.GATT_SUCCESS -> value
                BluetoothGatt.GATT_INSUFFICIENT_AUTHENTICATION, BluetoothGatt.GATT_INSUFFICIENT_ENCRYPTION, GATT_INSUFFICIENT_AUTHORIZATION ->
                    { Log.i(TAG, "$what ${uuid.take(8)}: NotPaired yet ($status)"); throw TrackerError.NotPaired(status) }
                else -> { Log.w(TAG, "$what ${uuid.take(8)}: status $status"); throw TrackerError.Refused(status) }
            }
        } finally {
            if (waiter === w) waiter = null
        }
    }

    override fun close() {
        gone = true
        runCatching { gatt?.disconnect() }
        runCatching { gatt?.close() }
        gatt = null
    }

    private suspend fun discover(g: BluetoothGatt) {
        discovered = CompletableDeferred()
        if (!g.discoverServices()) throw TrackerError.NoAnswer()
        val status = withTimeout(15_000) { discovered.await() }
        items.clear()
        g.getService(UUID.fromString(Gatt.SERVICE))?.characteristics?.forEach { items[it.uuid.toString()] = it }
        Log.i(TAG, "discovered (status $status): ${items.size} of ${Gatt.ITEMS.size} items")
    }

    private suspend fun open(context: Context) {
        val g = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE) ?: throw TrackerError.Gone()
        gatt = g
        withTimeout(20_000) { connected.await() }
        if (g.requestMtu(517)) withTimeoutOrNull(5_000) { runCatching { mtu.await() } }?.getOrNull()?.let { Log.i(TAG, "mtu $it") }
        discover(g)
        // The phone's copy of the list doesn't match the firmware's layout:
        // drop Android's cache and look again (hidden API, best effort).
        if (!items.keys.containsAll(Gatt.ITEMS)) {
            val refreshed = runCatching { g.javaClass.getMethod("refresh").invoke(g) as Boolean }.getOrDefault(false)
            Log.i(TAG, "layout ${Gatt.LAYOUT} not matched; cache refresh $refreshed")
            delay(500)
            discover(g)
        }
    }

    companion object {
        private const val OP_TIMEOUT_MS = 10_000L
        private const val GATT_INSUFFICIENT_AUTHORIZATION = 8

        /** Connect, with one more try: Android's first connection often fails (status 133). */
        suspend fun connect(context: Context, device: BluetoothDevice): BleTrackerLink {
            var last: Throwable? = null
            repeat(2) { attempt ->
                val link = BleTrackerLink(device)
                try {
                    link.open(context)
                    return link
                } catch (e: Throwable) {
                    link.close()
                    if (e is CancellationException && !currentCoroutineContext().isActive) throw e
                    Log.w(TAG, "connect attempt ${attempt + 1}: $e")
                    last = if (e is CancellationException) TrackerError.NoAnswer() else e
                    delay(600)
                }
            }
            throw last ?: TrackerError.Gone()
        }
    }
}
