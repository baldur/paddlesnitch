package com.paddlesnitch.app.ui

import androidx.compose.material3.MaterialTheme
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

@Composable
fun PaddlesnitchTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = plexTypography(), content = content)
}
