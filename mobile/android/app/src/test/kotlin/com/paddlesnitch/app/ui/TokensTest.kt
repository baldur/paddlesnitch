package com.paddlesnitch.app.ui

import androidx.compose.ui.graphics.Color
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

// The generated colours are exactly the shared tokens: every name, every value.
class TokensTest {
    private val tokens = JSONObject(File("../../contract/tokens/tokens.json").readText())

    @Test
    fun everyColourTokenIsGeneratedWithItsValue() {
        val json = tokens.getJSONObject("color")
        val expected = json.keys().asSequence().associateWith { Color(("FF" + json.getString(it).removePrefix("#")).toLong(16)) }
        assertEquals(expected, PsColor.all)
    }

    @Test
    fun radiiAreGenerated() {
        assertEquals(tokens.getJSONObject("radius").getInt("control").toFloat(), PsRadius.control.value)
    }
}
