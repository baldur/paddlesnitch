package com.paddlesnitch.app.api

import java.io.File
import kotlinx.serialization.KSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The generated models read every golden answer in mobile/contract/fixtures/api.
class FixturesTest {
    private val dir = File("../../contract/fixtures/api")
    private fun <T> read(name: String, serializer: KSerializer<T>): T = ApiJson.decodeFromString(serializer, dir.resolve(name).readText())

    @Test
    fun everyFixtureHasAModelAndDecodes() {
        val byProcedure = mapOf(
            "me" to Me.serializer(), "paddles.list" to PaddleList.serializer(), "paddles.get" to AnalysisSession.serializer(), "paddles.writeSummary" to AnalysisSession.serializer(),
            "auth.login" to SignIn.serializer(), "auth.refresh" to Refreshed.serializer(),
            "auth.error" to ApiError.serializer(), "auth.otp-verify.retry" to ApiError.serializer(),
            "account.tos" to TosStatus.serializer(), "account.tos-accepted" to TosAccepted.serializer(), "account.export" to DownloadLink.serializer(),
            "account.profile" to ProfileSettings.serializer(), "account.handle-check" to HandleAvailability.serializer(),
            "account.contact" to Contact.serializer(), "account.error" to ApiError.serializer(),
        )
        val names = dir.list()!!.filter { it.endsWith(".json") }
        assertTrue(names.size >= 7)
        for (name in names) {
            val procedure = byProcedure.keys.filter { name.startsWith("$it.") }.maxBy { it.length }
            read(name, byProcedure.getValue(procedure))
        }
    }

    @Test
    fun theListCarriesWhatTheScreenDraws() {
        val list = read("paddles.list.json", PaddleList.serializer())
        val motion = list.cards.single { it.id == "pdl-motion" }
        assertEquals(true, motion.noGps)
        assertTrue("a paddle that lost its GPS part-way keeps a route", motion.route.isNotEmpty())
        val river = list.cards.single { it.id == "pdl-river" }
        assertEquals("Headwind on the way back.", river.note)
        assertEquals(listOf(PaddleCard.SameOuting("pdl-river-watch", "strava")), river.sameOuting)
        assertEquals(12, list.logbook.weeks.size)
        assertEquals(BoatClass._2X, motion.boatClass)
    }

    @Test
    fun aNewerServersValuesDecodeToUnknown() {
        val s = read("paddles.get.unknown-values.json", AnalysisSession.serializer())
        assertEquals(AnalysisSource.Type.Unknown, s.source.type)
        assertEquals(BoatClass.Unknown, s.boatClass)
        assertEquals(Segment.Kind.Unknown, s.result.stops[0].kind)
        assertEquals(NoPaddleReason.Unknown("eaten_by_seal"), s.result.noGps?.reason)
    }

    @Test
    fun signInAnswers() {
        assertEquals(true, read("auth.login.needs-terms.json", SignIn.serializer()).needsTerms)
        assertEquals("AYABeOtp-session-from-cognito", read("auth.otp-verify.retry.json", ApiError.serializer()).session)
    }

    @Test
    fun aKnownReasonDecodesToItsCase() {
        val s = read("paddles.get.motion-only.json", AnalysisSession.serializer())
        assertTrue(s.result.noGps?.reason is NoPaddleReason.GpsLost)
        assertEquals("C", s.seat?.content)
    }
}
