package com.paddlesnitch.app.tracker

import com.paddlesnitch.app.api.Api
import com.paddlesnitch.app.api.ApiFailure
import com.paddlesnitch.app.api.ApiJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The website's own account routes, called as the signed-in person
 * (mobile/contract/fixtures/tracker/README.md). The tracker's token never
 * leaves the tracker: the phone uploads as you, and the server's receipt
 * tells the tracker the recording arrived.
 */
class ApiTrackerAccount(private val api: Api) : TrackerAccount {
    private fun body(a: Api.Answer) = runCatching { ApiJson.parseToJsonElement(a.body) as? JsonObject }.getOrNull()
    private fun reply(a: Api.Answer) = body(a).let {
        Reply(a.code, (it?.get("error") as? JsonPrimitive)?.takeIf { p -> p.isString }?.content, (it?.get("receipt") as? JsonPrimitive)?.content)
    }

    override suspend fun myTrackerIds(): Set<String> {
        val a = api.rest("/api/account/devices")
        if (!a.ok) throw ApiFailure("Couldn’t load your trackers (${a.code}). Please try again.", a.code)
        return body(a)?.get("devices")?.jsonArray.orEmpty().mapNotNull { it.jsonObject["deviceId"]?.jsonPrimitive?.content }.toSet()
    }

    override suspend fun linkBluetooth(deviceId: String, tokenHash: String, signature: String, model: String, firmware: String): Reply {
        val q = { s: String -> JsonPrimitive(s).toString() }
        val json = """{"deviceId":${q(deviceId)},"tokenHash":${q(tokenHash)},"signature":${q(signature)},"model":${q(model)},"firmware":${q(firmware)}}"""
        return reply(api.rest("/api/account/devices/link-bluetooth", body = json.encodeToByteArray()))
    }

    override suspend fun upload(about: TrackerAbout, rec: PendingRecording, part: Int, parts: Int, bytes: ByteArray, compressed: Boolean): Reply {
        val query = buildMap {
            put("filename", rec.upload); put("part", "$part"); put("parts", "$parts")
            if (compressed) put("enc", "zlib")
        }
        return reply(api.rest(
            "/api/account/devices/${about.id}/sessions", query, bytes,
            type = if (compressed) "application/octet-stream" else "text/csv",
            headers = mapOf("x-device-firmware" to about.firmware, "x-device-model" to about.model),
        ))
    }

    override suspend fun staged(about: TrackerAbout, rec: PendingRecording): List<Int> {
        val a = api.rest("/api/account/devices/${about.id}/sessions", mapOf("filename" to rec.upload))
        if (!a.ok) return emptyList()
        return body(a)?.get("parts")?.jsonArray.orEmpty().mapNotNull { it.jsonPrimitive.intOrNull }
    }
}
