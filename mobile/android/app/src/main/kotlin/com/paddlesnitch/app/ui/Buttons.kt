package com.paddlesnitch.app.ui

import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.runtime.Composable

// M3 colours text and outlined buttons with the theme's `primary`, which is the
// filled-button blue (#0369a1, about 3:1 on our ground). Words in blue use
// primaryText instead (about 9:1), as the website's text-primary-text does.

/** A text button's colours: readable blue words. */
@Composable
fun textColors(): ButtonColors = ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText)

/** An outlined button's colours: readable blue words in the outline. */
@Composable
fun outlinedColors(): ButtonColors = ButtonDefaults.outlinedButtonColors(contentColor = PsColor.primaryText)
