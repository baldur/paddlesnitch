package com.paddlesnitch.app.tracker

/**
 * One open Bluetooth connection to a tracker: read and write its items by
 * UUID. The Android implementation is [BleTrackerLink]; tests use a fake.
 */
interface TrackerLink {
    val name: String
    suspend fun read(uuid: String): ByteArray
    suspend fun write(uuid: String, value: ByteArray)
    /** Ask the phone to pair (bond); reading a paired-only item does it too. */
    suspend fun startPairing() {}
    fun close()
}

/** Why talking to the tracker failed, so the screen can say it in words. */
sealed class TrackerError(message: String) : Exception(message) {
    /** The item isn't in the phone's copy of the tracker's list (old firmware, or a stale cache). */
    class NotThere(uuid: String) : TrackerError("no item $uuid")
    /** The tracker refused because the connection isn't paired yet. */
    class NotPaired(status: Int) : TrackerError("not paired ($status)")
    class NoAnswer : TrackerError("no answer")
    class Gone : TrackerError("disconnected")
    class Refused(status: Int) : TrackerError("refused ($status)")
    class Unexpected(what: String) : TrackerError(what)
    /** The tracker is recording; it won't hand over files until it stops. */
    class Recording : TrackerError("recording")
}
