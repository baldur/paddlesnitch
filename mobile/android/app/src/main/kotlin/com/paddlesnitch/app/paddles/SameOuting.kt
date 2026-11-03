package com.paddlesnitch.app.paddles

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.paddlesnitch.app.ui.PsColor
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// One outing recorded twice (mobile/contract/README.md § Same outing): each other
// recording links to Compare on the website, which isn't native yet.

const val COMPARE_FAILED = "Couldn’t open Compare. Please try again."

/** What a screen reader reads for a row or link; the arrow isn't read. */
fun compareLabel(sourceType: String, phone: Boolean?) = "Compare with the recording from ${recordedBy(sourceType, phone)}"

/**
 * Opens Compare for [a] and [b] through [open] (web-code, then the browser). One at a time:
 * each code works once, so a second tap while one is asked does nothing. A failure says
 * [COMPARE_FAILED] and leaves the page as it was.
 */
@Stable
class Compare(
    private val scope: CoroutineScope,
    private val snackbar: SnackbarHostState,
    private val open: suspend (a: String, b: String) -> Unit,
) {
    /** The pair being opened, whose row shows a spinner. */
    var busy by mutableStateOf<Pair<String, String>?>(null)
        private set

    fun tap(a: String, b: String) {
        if (busy != null) return
        busy = a to b
        scope.launch {
            val failed = try { open(a, b); false }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { true }
            finally { busy = null }
            // showSnackbar waits until the snackbar goes: the row is free again before it shows.
            if (failed) snackbar.showSnackbar(COMPARE_FAILED)
        }
    }
}

/** A row inside a Paddles card, under its own: who else recorded it, and Compare → when [compare] is given. */
@Composable
internal fun SameOutingRow(a: String, b: String, sourceType: String, phone: Boolean?, compare: Compare?) {
    HorizontalDivider(color = PsColor.border)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .then(if (compare == null) Modifier else Modifier
                .clickable(role = Role.Button) { compare.tap(a, b) }
                .semantics { contentDescription = compareLabel(sourceType, phone) })
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(alsoRecordedBy(sourceType, phone), color = PsColor.muted, fontSize = 14.sp, modifier = Modifier.weight(1f))
        if (compare != null) {
            Spacer(Modifier.size(8.dp))
            if (compare.busy == (a to b)) Spinner() else Text("Compare →", color = PsColor.primaryText, fontSize = 14.sp)
        }
    }
}

/** A link on the paddle page: "Also recorded by <who> →", opening Compare with this paddle as [a]. */
@Composable
internal fun SameOutingLink(a: String, b: String, sourceType: String, phone: Boolean?, compare: Compare) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .clickable(role = Role.Button) { compare.tap(a, b) }
            .semantics { contentDescription = compareLabel(sourceType, phone) },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("${alsoRecordedBy(sourceType, phone)} →", color = PsColor.primaryText, fontSize = 14.sp)
        if (compare.busy == (a to b)) Spinner()
    }
}

@Composable
private fun Spinner() = CircularProgressIndicator(Modifier.size(16.dp), color = PsColor.primaryText, strokeWidth = 2.dp)
