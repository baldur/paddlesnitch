package com.paddlesnitch.app.paddles

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.SignedOut
import com.paddlesnitch.app.ui.PsColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** What the add-paddle card says (the same states and words as the iPhone app). */
sealed interface AddCard {
    data class Adding(val name: String) : AddCard
    data class Added(val id: String, val duplicate: Boolean) : AddCard
    data class Failed(val message: String) : AddCard
    /** A file opened while signed out: added once signed in. */
    data class SignInToAdd(val name: String) : AddCard
}

/** Opens the system file picker; adds a file another app handed over. */
class AddPaddle(val pick: () -> Unit, val add: (Uri) -> Unit)

/**
 * "Add paddle": the system file picker (Drive, Downloads, a watch app's
 * export…) or a file opened with or shared to the app, then the website's
 * upload. Each step goes to [onCard].
 */
@Composable
fun rememberAddPaddle(api: Api, onCard: (AddCard) -> Unit, onAdded: () -> Unit, onSignedOut: () -> Unit): AddPaddle {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val add: (Uri) -> Unit = { uri ->
        scope.launch {
            val result = runCatching {
                val name = withContext(Dispatchers.IO) { displayName(context, uri) }
                onCard(AddCard.Adding(name))
                val (sent, bytes) = withContext(Dispatchers.IO) { prepareUpload(name, readBytes(context, uri)) }
                api.upload(sent, bytes)
            }
            result.onSuccess { onCard(AddCard.Added(it.id, it.duplicate == true)); onAdded() }
                .onFailure { if (it is SignedOut) onSignedOut() else onCard(AddCard.Failed(it.message ?: "Couldn’t add that paddle. Please try again.")) }
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) add(uri) }
    // Watch and phone apps label these files inconsistently, so any file can be picked; the server says if it can't read one.
    return AddPaddle(pick = { pick.launch(arrayOf("*/*")) }, add = add)
}

/** The card pinned under the list (so it shows on an empty list too). Screen readers hear each step. */
@Composable
fun AddPaddleCard(card: AddCard, onOpen: (String) -> Unit, onSignIn: () -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(16.dp).card().padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val text = Modifier.weight(1f).padding(vertical = 12.dp).semantics { liveRegion = LiveRegionMode.Polite }
        when (card) {
            is AddCard.Adding -> {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Text("Adding ${card.name}…", modifier = text)
            }
            is AddCard.Added -> {
                Text(if (card.duplicate) "You’ve already added this paddle." else "Paddle added.", modifier = text)
                TextButton(onClick = { onOpen(card.id) }) { Text("Open paddle") }
            }
            is AddCard.Failed -> Text(card.message, color = PsColor.red, modifier = text)
            is AddCard.SignInToAdd -> {
                Text("Sign in to add ${card.name}.", modifier = text)
                TextButton(onClick = onSignIn) { Text("Sign in") }
            }
        }
        if (card !is AddCard.Adding) TextButton(onClick = onClose, modifier = Modifier.semantics { contentDescription = "Close" }) { Text("✕", modifier = Modifier.clearAndSetSemantics {}) }
    }
}

/** The file's name as the other app gives it. */
fun displayName(context: Context, uri: Uri): String =
    runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
    }.getOrNull() ?: uri.lastPathSegment ?: "paddle"

private fun readBytes(context: Context, uri: Uri): ByteArray =
    runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() ?: error("Couldn’t open that file. Please share it again.")

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
