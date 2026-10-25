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
import com.paddlesnitch.app.api.ApiFailure
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
                val (name, bytes) = withContext(Dispatchers.IO) { read(context, uri).let { (n, b) -> prepareUpload(n, b) } }
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

/** What one upload may weigh (a request to the server is at most ~4.6 MB), as the website's trace-upload.ts. */
const val MAX_UPLOAD_BYTES = 4_400_000
private const val COMPRESS_FROM_BYTES = 1_000_000
const val TOO_BIG = "That file is too big to upload. Export the activity as FIT, which is much smaller, or as a Garmin .zip."

/** The file to send: a GPX, TCX or CSV of 1 MB or more gzipped (the server unpacks .gz); too big to send even then fails. */
fun prepareUpload(name: String, bytes: ByteArray): Pair<String, ByteArray> {
    val compressible = name.substringAfterLast('.', "").lowercase() in setOf("gpx", "tcx", "csv")
    val out = if (compressible && bytes.size >= COMPRESS_FROM_BYTES) {
        "$name.gz" to java.io.ByteArrayOutputStream().also { o -> java.util.zip.GZIPOutputStream(o).use { it.write(bytes) } }.toByteArray()
    } else name to bytes
    if (out.second.size > MAX_UPLOAD_BYTES) throw ApiFailure(TOO_BIG, 413)
    return out
}

/** What to say after an upload. */
fun addedMessage(result: Result<Analysed>): String = result.fold(
    { if (it.duplicate == true) "That paddle is already in your paddles." else "Paddle added." },
    { it.message ?: "Couldn’t add that paddle. Please try again." },
)
