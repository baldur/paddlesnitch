package com.paddlesnitch.app.paddles

import com.paddlesnitch.app.api.ApiFailure
import java.io.File
import java.util.zip.GZIPInputStream
import kotlin.random.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

// A request to the server can be at most ~4.6 MB, as the website's trace-upload.ts:
// a big text trace is gzipped first, and one that still can't fit is refused before sending.
class PrepareUploadTest {
    private fun text(size: Int) = ByteArray(size) { "<trkpt lat=\"51.4\"/>"[it % 19].code.toByte() }

    @Test fun justUnderOneMegabyteGoesAsItIs() {
        val bytes = text(999_999)
        val (name, out) = prepareUpload("Morning.gpx", bytes)
        assertEquals("Morning.gpx", name)
        assertArrayEquals(bytes, out)
    }

    @Test fun everyTextTraceFromOneMegabyteIsGzipped() {
        for (ext in listOf("gpx", "GPX", "tcx", "csv")) {
            val bytes = text(1_000_000)
            val (name, out) = prepareUpload("Morning.$ext", bytes)
            assertEquals("Morning.$ext.gz", name)
            assertArrayEquals(bytes, GZIPInputStream(out.inputStream()).readBytes())
        }
        assertTrue(prepareUpload("Big.gpx", text(9_000_000)).second.size < MAX_UPLOAD_BYTES) // over the limit as it is, under once gzipped
    }

    @Test fun aFitIsNeverGzippedAndTooBigIsRefused() {
        assertEquals("Long.fit", prepareUpload("Long.fit", ByteArray(2_000_000)).first)
        assertEquals(TOO_BIG, assertThrows(ApiFailure::class.java) { prepareUpload("Long.fit", ByteArray(4_400_001)) }.message)
        assertEquals(4_400_000, prepareUpload("Edge.fit", ByteArray(4_400_000)).second.size)
    }

    @Test fun aTextTraceStillTooBigOnceGzippedIsRefused() {
        val noise = Random(1).nextBytes(4_500_000) // doesn't shrink
        assertThrows(ApiFailure::class.java) { prepareUpload("Noise.csv", noise) }
    }

    @Test fun theLimitAndTheWordsAreTheWebsites() {
        val web = File("../../../apps/web/src/lib/trace-upload.ts").readText()
        assertTrue("MAX_UPLOAD_BYTES", web.contains("MAX_UPLOAD_BYTES = 4_400_000") && MAX_UPLOAD_BYTES == 4_400_000)
        assertTrue("COMPRESS_FROM_BYTES", web.contains("COMPRESS_FROM_BYTES = 1_000_000"))
        assertTrue("TOO_BIG_MESSAGE", web.contains("'$TOO_BIG'"))
    }
}
