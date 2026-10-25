package com.paddlesnitch.app.paddles

import com.paddlesnitch.app.api.ApiFailure
import java.util.zip.GZIPInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

// A request to the server can be at most ~4.6 MB, as the website's trace-upload.ts:
// a big text trace is gzipped first, and one that still can't fit is refused before sending.
class PrepareUploadTest {
    private fun gpx(size: Int) = ByteArray(size) { "<trkpt lat=\"51.4\"/>"[it % 19].code.toByte() }

    @Test fun aSmallFileGoesAsItIs() {
        val bytes = gpx(999_999)
        val (name, out) = prepareUpload("Morning.gpx", bytes)
        assertEquals("Morning.gpx", name)
        assertArrayEquals(bytes, out)
    }

    @Test fun aBigTextTraceIsGzipped() {
        val bytes = gpx(9_000_000) // over the limit as it is
        val (name, out) = prepareUpload("Morning.GPX", bytes)
        assertEquals("Morning.GPX.gz", name)
        assertTrue(out.size < 4_400_000)
        assertArrayEquals(bytes, GZIPInputStream(out.inputStream()).readBytes())
    }

    @Test fun aFitIsNeverGzippedAndTooBigIsRefused() {
        val e = assertThrows(ApiFailure::class.java) { prepareUpload("Long.fit", ByteArray(4_400_001)) }
        assertEquals(TOO_BIG, e.message)
        assertEquals(4_400_000, prepareUpload("Edge.fit", ByteArray(4_400_000)).second.size)
    }
}
