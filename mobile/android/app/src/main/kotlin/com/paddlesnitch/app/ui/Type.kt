package com.paddlesnitch.app.ui

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import com.paddlesnitch.app.R

// The design system's faces (mobile/contract/tokens/tokens.json `font`): IBM Plex Sans for
// reading, IBM Plex Mono for numbers. Bundled as on iPhone (the same files, OFL licence in
// assets/licences/ibm-plex-OFL.txt).

@OptIn(ExperimentalTextApi::class)
private fun sans(weight: FontWeight) =
    Font(R.font.ibm_plex_sans, weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)))

/** Plex Sans, one variable font at each weight the app uses. */
val PlexSans = FontFamily(sans(FontWeight.Normal), sans(FontWeight.Medium), sans(FontWeight.SemiBold), sans(FontWeight.Bold))

/** Plex Mono, for numbers and short labels over data (the website's `.tabular` and Eyebrow). */
val PlexMono = FontFamily(
    Font(R.font.ibm_plex_mono_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_mono_medium, FontWeight.Medium),
    Font(R.font.ibm_plex_mono_semibold, FontWeight.SemiBold),
    Font(R.font.ibm_plex_mono_bold, FontWeight.Bold),
)

/** M3's type scale, set in Plex Sans. */
internal fun plexTypography(): Typography = Typography().run {
    fun TextStyle.plex() = copy(fontFamily = PlexSans)
    copy(
        displayLarge = displayLarge.plex(), displayMedium = displayMedium.plex(), displaySmall = displaySmall.plex(),
        headlineLarge = headlineLarge.plex(), headlineMedium = headlineMedium.plex(), headlineSmall = headlineSmall.plex(),
        titleLarge = titleLarge.plex(), titleMedium = titleMedium.plex(), titleSmall = titleSmall.plex(),
        bodyLarge = bodyLarge.plex(), bodyMedium = bodyMedium.plex(), bodySmall = bodySmall.plex(),
        labelLarge = labelLarge.plex(), labelMedium = labelMedium.plex(), labelSmall = labelSmall.plex(),
    )
}
