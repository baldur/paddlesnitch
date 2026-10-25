package com.paddlesnitch.app.paddles

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material3.ButtonDefaults
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import com.paddlesnitch.app.api.shown
import java.io.Serializable
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
sealed interface AddCard : Serializable {
    /** [name] is null when the other app gave no file name. */
    data class Adding(val name: String?) : AddCard
    data class Added(val id: String, val duplicate: Boolean) : AddCard
    data class Failed(val message: String) : AddCard
    /** A file opened while signed out: added once signed in. */
    data class SignInToAdd(val name: String?) : AddCard
}

/** The card's message (the same words as the iPhone app's). */
fun AddCard.text(): String = when (this) {
    is AddCard.Adding -> if (name != null) "Adding $name…" else "Adding your paddle…"
    is AddCard.Added -> if (duplicate) "You’ve already added this paddle." else "Paddle added."
    is AddCard.Failed -> message
    is AddCard.SignInToAdd -> if (name != null) "Sign in to add $name." else "Sign in to add this paddle."
}

/** Opens the system file picker; adds a file another app handed over. */
class AddPaddle(val pick: () -> Unit, val add: (Uri) -> Unit)

/**
 * "Add paddle": the system file picker (Drive, Downloads, a watch app's
 * export…) or a file opened with or shared to the app, then the website's
 * upload. Each step goes to [onCard]; if the session has ended, [onSignedOut]
 * gets the file back so it can be added after signing in.
 */
@Composable
fun rememberAddPaddle(api: Api, onCard: (AddCard) -> Unit, onAdded: () -> Unit, onSignedOut: (uri: String, name: String?) -> Unit): AddPaddle {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val add: (Uri) -> Unit = { uri ->
        scope.launch {
            var name: String? = null
            val result = runCatching {
                name = withContext(Dispatchers.IO) { displayName(context, uri) }
                onCard(AddCard.Adding(name))
                val (sent, bytes) = withContext(Dispatchers.IO) { prepareUpload(name ?: "paddle", readBytes(context, uri)) }
                api.upload(sent, bytes)
            }
            result.onSuccess { onCard(AddCard.Added(it.id, it.duplicate == true)); onAdded() }
                .onFailure { if (it is SignedOut) onSignedOut(uri.toString(), name) else onCard(AddCard.Failed(it.shown("Couldn’t add that paddle. Please try again."))) }
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) add(uri) }
    // Watch and phone apps label these files inconsistently, so any file can be picked; the server says if it can't read one.
    return AddPaddle(pick = { pick.launch(arrayOf("*/*")) }, add = add)
}

/**
 * The card pinned under the list (so it shows on an empty list too). It always
 * has a place in the layout, empty when there's no card: TalkBack reads a
 * change inside a live region it already knows, not one that just appeared.
 * Large text puts the buttons under the message.
 */
@Composable
fun AddPaddleCard(card: AddCard?, onOpen: (String) -> Unit, onSignIn: () -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().navigationBarsPadding().semantics { liveRegion = LiveRegionMode.Polite }) {
        if (card == null) return@Box
        val link = ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText)
        val message: @Composable (Modifier) -> Unit = { m ->
            Row(m, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (card is AddCard.Adding) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Text(card.text(), color = if (card is AddCard.Failed) PsColor.red else PsColor.fg, maxLines = 4, overflow = TextOverflow.Ellipsis)
            }
        }
        val actions: @Composable () -> Unit = {
            when (card) {
                is AddCard.Added -> TextButton(onClick = { onOpen(card.id) }, colors = link) { Text("Open paddle") }
                is AddCard.SignInToAdd -> TextButton(onClick = onSignIn, colors = link) { Text("Sign in") }
                else -> {}
            }
            if (card !is AddCard.Adding) TextButton(onClick = onClose, colors = link, modifier = Modifier.semantics { contentDescription = "Close" }) {
                Text("✕", modifier = Modifier.clearAndSetSemantics {})
            }
        }
        val box = Modifier.fillMaxWidth().padding(16.dp).card().padding(start = 12.dp)
        if (LocalDensity.current.fontScale > 1.3f) Column(box.padding(top = 12.dp)) {
            message(Modifier.padding(end = 12.dp))
            Row(Modifier.align(Alignment.End)) { actions() }
        } else Row(box, verticalAlignment = Alignment.CenterVertically) {
            message(Modifier.weight(1f).padding(vertical = 12.dp))
            actions()
        }
    }
}

/** The file's name as the other app gives it. */
fun displayName(context: Context, uri: Uri): String? =
    runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
    }.getOrNull()?.takeIf { it.isNotBlank() } // never a content id: the card says "your paddle" instead

private fun readBytes(context: Context, uri: Uri): ByteArray =
    runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() ?: error("Couldn’t open that file. Please try again.")

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
