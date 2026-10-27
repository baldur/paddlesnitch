package com.paddlesnitch.app.paddles

import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.NoPaddleReason
import java.io.File
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

// Every case in mobile/contract/format/format.json: the website's own answers
// for what the app writes. A port that drifts fails here.
class FormatFixturesTest {
    private val cases: JsonObject = ApiJson.parseToJsonElement(File("../../contract/format/format.json").readText()).jsonObject

    private val ports: Map<String, (JsonElement) -> String> = mapOf(
        "fmtDur" to { i -> fmtDur(i.jsonPrimitive.double) },
        "fmtClock" to { i -> fmtClock(i.jsonPrimitive.double) },
        "split500" to { i -> split500(i.jsonPrimitive.double) },
        "fmtWeekday" to { i -> fmtWeekday(i.jsonPrimitive.content) },
        "fmtMonth" to { i -> fmtMonth(i.jsonPrimitive.content) },
        "paddleKm" to { i ->
            val o = i.jsonObject
            paddleKm(o.getValue("distanceKm").jsonPrimitive.double, o["noGps"]?.jsonPrimitive?.booleanOrNull == true)
        },
        "compassPoint" to { i -> compassPoint(i.jsonPrimitive.double) },
        "noPaddleMessage" to { i ->
            val o = i.jsonObject
            noPaddleMessage(ApiJson.decodeFromJsonElement(NoPaddleReason.serializer(), o.getValue("reason")), o.getValue("hasMotion").jsonPrimitive.boolean)
        },
        "roundStrokes" to { i -> roundStrokes(i.jsonPrimitive.double) },
        "fmtDay" to { i -> fmtDay(i.jsonPrimitive.contentOrNull) },
        "fmtDist" to { i -> fmtDist(i.jsonPrimitive.doubleOrNull) },
        "fmtAgo" to { i ->
            val o = i.jsonObject
            fmtAgo(o["at"]?.jsonPrimitive?.contentOrNull, java.time.OffsetDateTime.parse(o.getValue("now").jsonPrimitive.content).toInstant().toEpochMilli())
        },
        "fmtDayTime" to { i ->
            val o = i.jsonObject
            fmtDayTime(o.getValue("at").jsonPrimitive.content, java.time.ZoneId.of(o.getValue("zone").jsonPrimitive.content))
        },
        "fmtEvenness" to { i -> fmtEvenness(i.jsonPrimitive.double) },
        "noMotionCopy" to { i -> noMotionCopy(if (i is kotlinx.serialization.json.JsonNull) null else ApiJson.decodeFromJsonElement(com.paddlesnitch.app.api.BoatMotion.serializer(), motionOf(i.jsonObject))) },
        // The answer is a list: compared as JSON.
        "axisTicks" to { i -> kotlinx.serialization.json.JsonArray(axisTicks(i.jsonPrimitive.double).map { kotlinx.serialization.json.JsonPrimitive(it) }).toString() },
    )

    @Test
    fun everyFunctionInTheFileHasAPort() = assertEquals(cases.keys, ports.keys)

    @Test
    fun everyCaseGivesTheWebsitesAnswer() {
        for ((fn, list) in cases) for (c in list.jsonArray) {
            val o = c.jsonObject
            val out = o.getValue("out")
            assertEquals("$fn(${o["in"]})", if (out is kotlinx.serialization.json.JsonArray) out.toString() else out.jsonPrimitive.content, ports.getValue(fn)(o.getValue("in")))
        }
    }

    /** The cases give only the fields that matter; the rest of a BoatMotion is filled in empty. */
    private fun motionOf(given: JsonObject): JsonElement = ApiJson.parseToJsonElement(
        """{"available":false,"reason":"","sampleRateHz":null,"samples":0,"envelope":[],"excerpt":[],"rollHistogram":null,"rollRmsDeg":null,"pitchRmsDeg":null,"rollP5Deg":null,"rollP95Deg":null,"plotBoundDeg":null,"rollToPitchRatio":null,"axisConfident":false,"symmetry":null,"excludedWindows":0,"excludedSeconds":0}"""
    ).jsonObject.let { JsonObject(it + given) }
}
