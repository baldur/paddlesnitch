package com.paddlesnitch.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * A calm notice, not an error, in a bordered box (the website's role="status" box).
 * Put it inside a live region that is already in the layout, so TalkBack reads it.
 */
@Composable
fun Notice(text: String, modifier: Modifier = Modifier) =
    Text(text, color = PsColor.fg, modifier = modifier.fillMaxWidth()
        .background(PsColor.surface, RoundedCornerShape(PsRadius.control)).border(1.dp, PsColor.borderStrong, RoundedCornerShape(PsRadius.control)).padding(12.dp))
