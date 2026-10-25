package com.paddlesnitch.app.paddles

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import com.paddlesnitch.app.api.Analysed
import com.paddlesnitch.app.api.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Opens the system file picker; adds a file another app handed over. */
class AddPaddle(val pick: () -> Unit, val add: (Uri) -> Unit)

/**
 * "Add a paddle from a file": the system file picker (Drive, Downloads, a
 * watch app's export…) or a file opened with or shared to the app, then the
 * website's upload.
 */
@Composable
fun rememberAddPaddle(api: Api, onBusy: (Boolean) -> Unit, onDone: (Result<Analysed>) -> Unit): AddPaddle {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val add: (Uri) -> Unit = { uri ->
        scope.launch {
            onBusy(true)
            onDone(runCatching {
                val (name, bytes) = withContext(Dispatchers.IO) { read(context, uri) }
                api.upload(name, bytes)
            })
            onBusy(false)
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) add(uri) }
    // Watch and phone apps label these files inconsistently, so any file can be picked; the server says if it can't read one.
    return AddPaddle(pick = { pick.launch(arrayOf("*/*")) }, add = add)
}

private fun read(context: Context, uri: Uri): Pair<String, ByteArray> {
    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null
    } ?: uri.lastPathSegment ?: "paddle"
    val bytes = runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() ?: error("Couldn’t open that file. Please share it again.")
    return name to bytes
}

/** What to say after an upload. */
fun addedMessage(result: Result<Analysed>): String = result.fold(
    { if (it.duplicate == true) "That paddle is already in your paddles." else "Paddle added." },
    { it.message ?: "Couldn’t add that paddle. Please try again." },
)
