package com.paddlesnitch.app.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The design system's faces: Plex Sans for reading, Plex Mono for numbers, never the phone's own mono.
class TypeTest {
    @Test fun everyTextStyleIsPlexSans() = plexTypography().run {
        listOf(displayLarge, headlineMedium, titleMedium, bodyLarge, bodySmall, labelSmall).forEach { assertEquals(PlexSans, it.fontFamily) }
    }

    @Test fun numbersUsePlexMonoNotThePhonesMono() {
        val uses = File("src/main/kotlin").walk().filter { it.extension == "kt" && "FontFamily.Monospace" in it.readText() }.map { it.name }.toList()
        assertEquals(emptyList<String>(), uses)
    }

    @Test fun thePlexLicenceShipsWithTheFonts() =
        assertTrue(File("src/main/assets/licences/ibm-plex-OFL.txt").readText().contains("SIL Open Font License"))
}
