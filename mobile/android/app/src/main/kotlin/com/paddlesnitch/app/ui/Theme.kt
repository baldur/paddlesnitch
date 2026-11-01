package com.paddlesnitch.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

// The platform's fixed dark theme from the shared tokens. No dynamic colour:
// the design system is the same on the web, iPhone and Android.
private val scheme = darkColorScheme(
    primary = PsColor.primary,
    onPrimary = PsColor.fg,
    background = PsColor.bg,
    onBackground = PsColor.fg,
    surface = PsColor.surface,
    onSurface = PsColor.fg,
    surfaceVariant = PsColor.surface2,
    onSurfaceVariant = PsColor.muted,
    outline = PsColor.borderStrong,
    outlineVariant = PsColor.border,
    error = PsColor.red,
)

/**
 * Text fields (and M3's other small controls) read extraSmall: the tokens' control radius,
 * as the website's inputs (#793). Buttons ignore Shapes; they get ControlShape in Buttons.kt.
 */
val PsShapes = Shapes(extraSmall = ControlShape)

@Composable
fun PaddlesnitchTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, shapes = PsShapes, typography = plexTypography(), content = content)
}
