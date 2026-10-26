package com.paddlesnitch.app.ui

import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.CheckboxColors
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SwitchColors
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable

// M3 draws a focused field and a ticked box with the theme's `primary`, the filled-button
// blue (#0369a1, about 3:1 on our ground, borderline for these marks and too dim for a
// label). They use primaryText instead (about 9:1); the theme's primary stays for filled buttons.

/** A text field's colours: the focused label, caret and outline in readable blue. */
@Composable
fun fieldColors(): TextFieldColors = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = PsColor.primaryText,
    focusedLabelColor = PsColor.primaryText,
    cursorColor = PsColor.primaryText,
    selectionColors = TextSelectionColors(handleColor = PsColor.primaryText, backgroundColor = PsColor.primaryText.copy(alpha = 0.4f)),
)

/** A checkbox's colours: ticked in readable blue with a dark tick. */
@Composable
fun checkboxColors(): CheckboxColors = CheckboxDefaults.colors(checkedColor = PsColor.primaryText, checkmarkColor = PsColor.bg)

/** A switch's colours: on in readable blue with a dark thumb. */
@Composable
fun switchColors(): SwitchColors = SwitchDefaults.colors(
    checkedTrackColor = PsColor.primaryText,
    checkedThumbColor = PsColor.bg,
    checkedBorderColor = PsColor.primaryText,
)
