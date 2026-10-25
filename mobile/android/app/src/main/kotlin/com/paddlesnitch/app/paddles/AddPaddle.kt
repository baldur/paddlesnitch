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

/**
 * "Add a paddle from a file": the system file picker (Drive, Downloads, a
 * watch app's export…), then the website's upload. Returns what opens the picker.
 */
@Composable
fun rememberAddPaddle(api: Api, onBusy: (Boolean) -> Unit, onDone: (Result<Analysed>) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            onBusy(true)
            onDone(runCatching {
                val (name, bytes) = withContext(Dispatchers.IO) { read(context, uri) }
                api.upload(name, bytes)
            })
            onBusy(false)
        }
    }
    // Watch and phone apps label these files inconsistently, so any file can be picked; the server says if it can't read one.
    return { pick.launch(arrayOf("*/*")) }
}

private fun read(context: Context, uri: Uri): Pair<String, ByteArray> {
    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null
    } ?: uri.lastPathSegment ?: "paddle"
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Couldn’t open that file.")
    return name to bytes
}

/** What to say after an upload. */
fun addedMessage(result: Result<Analysed>): String = result.fold(
    { if (it.duplicate == true) "That paddle is already in your paddles." else "Paddle added." },
    { it.message ?: "Couldn’t add that paddle. Please try again." },
)
