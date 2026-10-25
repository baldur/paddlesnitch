package com.paddlesnitch.app.api

import java.io.File
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The generated models read every golden answer in mobile/contract/fixtures/api.
class FixturesTest {
    private val dir = File("../../contract/fixtures/api")
    private fun <T> read(name: String, serializer: KSerializer<T>): T = ApiJson.decodeFromString(serializer, dir.resolve(name).readText())

    // fixtures/api/index.json says which model each golden answer is (pnpm test keeps it complete).
    @Test
    fun everyFixtureHasAModelAndDecodes() {
        val index = ApiJson.parseToJsonElement(dir.resolve("index.json").readText()).jsonObject
        val names = dir.list()!!.filter { it.endsWith(".json") && it != "index.json" }
        assertTrue(names.size >= 7)
        assertEquals("every fixture is in index.json and every entry has a file", names.toSet(), index.keys)
        for ((name, entry) in index) {
            val schema = entry.jsonObject.getValue("schema").jsonPrimitive.content
            val model = runCatching { serializer(Class.forName("com.paddlesnitch.app.api.$schema")) }
                .getOrElse { throw AssertionError("$name: no generated model $schema", it) }
            runCatching { read(name, model) }.getOrElse { throw AssertionError("$name doesn't decode as $schema", it) }
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
