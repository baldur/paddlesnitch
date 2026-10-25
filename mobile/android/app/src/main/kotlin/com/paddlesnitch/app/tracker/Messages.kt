package com.paddlesnitch.app.tracker

/** What tracker setup tells the person, in plain words (the website's wording where it has some). */
object Messages {
    const val TURN_ON = "On the tracker, go to Settings > Network (tap to move, hold to choose), tap once more to reach the Bluetooth page, then hold until it says BLUETOOTH ON."
    const val PAIR_HOW = "Your phone and the tracker will both show a 6-digit number. If they match, tap Pair on the phone, then hold the tracker’s button within 25 seconds."
    const val NOT_FOUND = "No tracker found. Make sure it’s switched on and close by, and that Bluetooth is on: $TURN_ON"
    const val PAIR_FAILED = "Couldn’t pair. Check the numbers matched, tap Pair on the phone and hold the tracker’s button within 25 seconds, then try again."
    const val BLUETOOTH_OFF = "Bluetooth is off on this phone. Turn it on to set up your tracker."
    const val NO_BLUETOOTH = "This phone has no Bluetooth, so it can’t talk to a tracker."
    const val PERMISSION = "The app needs permission to connect to nearby devices to talk to your tracker. It doesn’t use it to find your location."
    const val PERMISSION_SETTINGS = "Permission to connect to nearby devices was turned off. Open the app’s settings, tap Permissions, and allow Nearby devices."
    const val CANT_READ = "Couldn’t read this tracker. It may need an update: leave it on WiFi for a few minutes, then try again."
    const val LOST = "Lost the connection to the tracker. Keep it close by and try again."
    const val RECORDING = "The tracker is recording. Stop it first (hold the button, then hold again to confirm), then sync."
    const val SLOW = "The tracker took too long to answer. Keep it close by and try again."
    const val LINK_AGAIN = "Couldn’t finish adding the tracker. Press Add to my account again."
    const val WIFI_SILENT = "Couldn’t hear back from the tracker. Check its screen, then try again."

    fun stale(trackerName: String) =
        "This phone has an out-of-date copy of the tracker’s details. In the phone’s Bluetooth settings, forget $trackerName, then set it up again here."

    /** Something failed while talking to the tracker. */
    fun trouble(e: Throwable, trackerName: String) = when (e) {
        is TrackerError.NotThere -> stale(trackerName)
        is TrackerError.Recording -> RECORDING
        is TrackerError.Gone -> LOST
        is TrackerError.NoAnswer -> SLOW
        is TrackerError.NotPaired -> PAIR_FAILED
        else -> "Couldn’t reach the tracker. Keep it close by and try again."
    }

    fun wifi(s: WifiState) = when (s) {
        WifiState.Joined -> "The tracker joined your WiFi. It will upload over it from now on."
        WifiState.WrongPassword -> "Couldn’t join: the tracker found the network, so the password is probably wrong. Check it and try again."
        WifiState.NotFound -> "Couldn’t find that network. Names are case-sensitive, and the tracker only uses 2.4 GHz WiFi."
        else -> "Couldn’t join that network. Check the name and password, then try again."
    }

    /** Why the WiFi details can't be sent as typed, or null if they can. */
    fun wifiInput(ssid: String, pass: String) = when {
        ssid.isBlank() -> "Type the network’s name."
        ssid.encodeToByteArray().size > Gatt.SSID_MAX_BYTES -> "That network name is too long for the tracker (32 characters at most)."
        pass.encodeToByteArray().size > Gatt.PASS_MAX_BYTES -> "That password is too long for the tracker (64 characters at most)."
        else -> null
    }

    fun linkError(status: Int, code: String?) = when {
        code == "owned_elsewhere" -> "This tracker is on another account. Its owner needs to remove it first."
        code == "bad_proof" -> "This tracker needs a software update before it can be added. Leave it on WiFi for a while, then try again."
        code == "not_enrolled" -> "This tracker hasn’t been registered with paddlesnitch yet, so it can’t be added."
        status == 401 -> "Please sign in again."
        status == 429 -> "Too many tries. Please wait a while, then try again."
        else -> "Couldn’t add the tracker. Please try again."
    }

    fun synced(r: SyncResult): String {
        val n = r.sent
        val sent = if (n == 0) "Nothing new to send." else "$n recording${if (n == 1) "" else "s"} sent. ${if (n == 1) "It" else "They"}’ll appear in Paddles in a minute or so."
        val unusable = r.failed.count { it.second == FailReason.Unusable }
        val other = r.failed.size - unusable
        val notes = listOfNotNull(
            if (unusable > 0) "$unusable couldn’t be used (no GPS in ${if (unusable == 1) "it" else "them"})." else null,
            if (other > 0) "$other didn’t finish; sync again to retry." else null,
        ).joinToString(" ")
        return listOf(if (r.sent > 0 || r.failed.isEmpty()) sent else "", notes).filter { it.isNotEmpty() }.joinToString(" ")
    }

    fun waiting(a: TrackerAbout) = when (a.waiting) {
        null -> "Still counting"
        0 -> "None waiting"
        1 -> "1 waiting to upload"
        else -> "${a.waiting} waiting to upload"
    }

    fun owner(o: Ownership) = when (o) {
        Ownership.Yours -> "On your account"
        Ownership.Elsewhere -> "Added to another account"
        Ownership.Unlinked -> "Not added to an account yet"
    }
}
