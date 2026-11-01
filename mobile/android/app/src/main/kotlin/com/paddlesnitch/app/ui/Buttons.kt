package com.paddlesnitch.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonElevation
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape

// M3 colours text and outlined buttons with the theme's `primary`, which is the
// filled-button blue (#0369a1, about 3:1 on our ground). Words in blue use
// primaryText instead (about 9:1), as the website's text-primary-text does.

/** A text button's colours: readable blue words. */
@Composable
fun textColors(): ButtonColors = ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText)

/** An outlined button's colours: readable blue words in the outline. */
@Composable
fun outlinedColors(): ButtonColors = ButtonDefaults.outlinedButtonColors(contentColor = PsColor.primaryText)

/**
 * Every button's corners: the control radius from the shared tokens (6 px, the website's
 * rounded-control), never M3's pill (#793). M3's buttons take their shape from a fixed
 * full-corner token, not the theme's Shapes, so the app uses these three instead of
 * material3's (ButtonsTest checks no screen imports those).
 */
val ControlShape: Shape = RoundedCornerShape(PsRadius.control)

@Composable
fun Button(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, shape: Shape = ControlShape,
    colors: ButtonColors = ButtonDefaults.buttonColors(), elevation: ButtonElevation? = ButtonDefaults.buttonElevation(),
    border: BorderStroke? = null, contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null, content: @Composable RowScope.() -> Unit,
) = androidx.compose.material3.Button(onClick, modifier, enabled, shape, colors, elevation, border, contentPadding, interactionSource, content)

@Composable
fun OutlinedButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, shape: Shape = ControlShape,
    colors: ButtonColors = ButtonDefaults.outlinedButtonColors(), elevation: ButtonElevation? = null,
    border: BorderStroke? = ButtonDefaults.outlinedButtonBorder(enabled), contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null, content: @Composable RowScope.() -> Unit,
) = androidx.compose.material3.OutlinedButton(onClick, modifier, enabled, shape, colors, elevation, border, contentPadding, interactionSource, content)

@Composable
fun TextButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, shape: Shape = ControlShape,
    colors: ButtonColors = ButtonDefaults.textButtonColors(), elevation: ButtonElevation? = null,
    border: BorderStroke? = null, contentPadding: PaddingValues = ButtonDefaults.TextButtonContentPadding,
    interactionSource: MutableInteractionSource? = null, content: @Composable RowScope.() -> Unit,
) = androidx.compose.material3.TextButton(onClick, modifier, enabled, shape, colors, elevation, border, contentPadding, interactionSource, content)
