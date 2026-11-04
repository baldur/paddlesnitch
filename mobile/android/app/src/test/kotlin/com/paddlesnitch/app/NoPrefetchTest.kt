package com.paddlesnitch.app

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// A web-code link signs the website in for an hour and works once (#856): a browser told to
// prefetch it would spend the code before the person sees the page. Nothing in the app prefetches.
class NoPrefetchTest {
    @Test fun nothingWarmsOrPrefetchesALink() {
        val files = File("src/main").walkTopDown().filter { it.isFile && it.extension in setOf("kt", "xml") }.toList()
        assertTrue("found the app's sources: ${files.size}", files.count { it.name == "App.kt" } == 1 && files.size > 50)
        val hits = files.asSequence()
            .flatMap { f -> f.readLines().mapIndexedNotNull { i, l -> if (Regex("""mayLaunchUrl|\.warmup\(|prefetch\(""").containsMatchIn(l)) "${f.name}:${i + 1}" else null } }
            .toList()
        assertEquals(emptyList<String>(), hits)
    }
}
