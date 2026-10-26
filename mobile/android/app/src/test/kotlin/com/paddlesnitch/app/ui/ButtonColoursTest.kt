package com.paddlesnitch.app.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

// M3 colours text and outlined buttons, focused fields, checkboxes and switches with the
// filled-button blue (#0369a1, about 3:1 on our ground), so every one passes readable colours
// (textColors(), outlinedColors(), fieldColors(), checkboxColors(), switchColors(), or its own).
class ButtonColoursTest {
    /** Each call of these that passes no `colors`, as "File.kt:line". */
    private fun withoutColours(vararg names: String) = File("src/main/kotlin").walk().filter { it.extension == "kt" }.flatMap { file ->
            val src = file.readText()
            Regex("""\b(${names.joinToString("|")})\(""").findAll(src).filter { m ->
                // A call, not a declaration ("fun Checkbox(") or another name ending the same way.
                !src.substring(maxOf(0, m.range.first - 4), m.range.first).endsWith("fun ") &&
                    (m.range.first == 0 || !src[m.range.first - 1].isLetterOrDigit())
            }.mapNotNull { m ->
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

    @Test fun everyTextAndOutlinedButtonHasReadableColours() =
        assertEquals("text or outlined buttons without readable colours", emptyList<String>(), withoutColours("TextButton", "OutlinedButton"))

    @Test fun everyFieldCheckboxAndSwitchHasReadableColours() =
        assertEquals("fields, checkboxes or switches without readable colours", emptyList<String>(), withoutColours("OutlinedTextField", "TextField", "Checkbox", "Switch"))
}
