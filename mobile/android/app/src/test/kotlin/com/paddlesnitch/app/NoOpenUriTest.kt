package com.paddlesnitch.app

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Web pages open in a Custom Tab (openTab or openInBrowser), never through LocalUriHandler, which
// hands the link to the browser app and leaves this one (#885).
class NoOpenUriTest {
    private val handler = Regex("""\bLocalUriHandler\b|\.openUri\(""")

    @Test fun noScreenOpensALinkThroughTheUriHandler() {
        val found = File("src/main").walk().filter { it.isFile && it.extension == "kt" }.flatMap { f ->
            f.readLines().mapIndexedNotNull { i, l -> if (handler.containsMatchIn(l)) "${f.name}:${i + 1}" else null }
        }.toList()
        assertEquals(emptyList<String>(), found)
    }

    @Test fun aNewUriHandlerLinkIsCaught() {
        listOf("val uri = LocalUriHandler.current", "import androidx.compose.ui.platform.LocalUriHandler",
            """uri.openUri("https://paddlesnitch.com/terms")""", """LocalUriHandler.current.openUri(url)""")
            .forEach { assertTrue(it, handler.containsMatchIn(it)) }
        assertFalse(handler.containsMatchIn("""openTab(context, url)"""))
        assertFalse(handler.containsMatchIn("""openInBrowser(context, url)"""))
    }
}
