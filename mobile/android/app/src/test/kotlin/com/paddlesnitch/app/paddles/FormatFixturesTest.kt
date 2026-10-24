package com.paddlesnitch.app.paddles

import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.NoPaddleReason
import java.io.File
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
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
    )

    @Test
    fun everyFunctionInTheFileHasAPort() = assertEquals(cases.keys, ports.keys)

    @Test
    fun everyCaseGivesTheWebsitesAnswer() {
        for ((fn, list) in cases) for (c in list.jsonArray) {
            val o = c.jsonObject
            assertEquals("$fn(${o["in"]})", o.getValue("out").jsonPrimitive.content, ports.getValue(fn)(o.getValue("in")))
        }
    }
}
