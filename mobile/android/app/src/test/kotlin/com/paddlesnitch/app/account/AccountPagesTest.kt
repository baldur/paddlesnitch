package com.paddlesnitch.app.account

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

// Every page the Account screen opens exists on the website (a renamed route
// would otherwise only show up as a 404 in the app).
class AccountPagesTest {
    private val app = File("../../../apps/web/src/app")

    @Test fun everyLinkedPageExists() {
        aboutPages.forEach {
            val dir = File(app, it.path.substringBefore('#').trimStart('/'))
            assertTrue("${it.label}: no page at ${it.path}", File(dir, "page.tsx").exists())
        }
    }
}
