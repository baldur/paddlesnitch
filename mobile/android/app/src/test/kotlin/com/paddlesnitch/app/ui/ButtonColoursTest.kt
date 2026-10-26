package com.paddlesnitch.app.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

// M3 colours text and outlined buttons with the filled-button blue (#0369a1, about 3:1 on
// our ground), so every one passes readable colours (textColors(), outlinedColors(), or its own).
class ButtonColoursTest {
    @Test fun everyTextAndOutlinedButtonHasReadableColours() {
        val missing = File("src/main/kotlin").walk().filter { it.extension == "kt" }.flatMap { file ->
            val src = file.readText()
            Regex("""\b(TextButton|OutlinedButton)\(""").findAll(src).mapNotNull { m ->
                // The call's own arguments: up to the matching close bracket.
                var depth = 0
                var end = m.range.last
                while (end < src.length) {
                    when (src[end]) { '(' -> depth++; ')' -> if (--depth == 0) break }
                    end++
                }
                val args = src.substring(m.range.last + 1, end)
                if ("colors" in args) null else "${file.name}:${src.substring(0, m.range.first).count { it == '\n' } + 1}"
            }
        }.toList()
        assertEquals("text or outlined buttons without readable colours", emptyList<String>(), missing)
    }
}
