package com.paddlesnitch.app.api

import com.paddlesnitch.app.auth.TokenStore
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.jsonObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Something to tell the person, in the server's own words when it gave some. */
class ApiFailure(message: String, val status: Int = 0) : Exception(message)

/** The session ended (the refresh token expired or was revoked): sign in again. */
class SignedOut : Exception("Please sign in again.")

/**
 * paddlesnitch.com for the app (mobile/contract/README.md): sign-in over REST
 * with the app header, everything else as tRPC with `Authorization: Bearer`.
 * An expired ID token is refreshed once and the call retried.
 */
class Api(
    baseUrl: String,
    private val tokens: TokenStore,
    private val appVersion: String,
    private val http: OkHttpClient = OkHttpClient(),
) {
    private val base = baseUrl.trimEnd('/').toHttpUrl()
    private val refreshing = Mutex()
    private val jsonType = "application/json".toMediaType()

    val signedIn: Boolean get() = tokens.refreshToken != null

    suspend fun login(email: String, password: String): SignIn =
        signIn("/att/api/auth/login", """{"email":${str(email)},"password":${str(password)}}""")

    suspend fun signUp(email: String, displayName: String, password: String, tosVersion: String): SignIn =
        signIn("/att/api/auth/signup", """{"email":${str(email)},"displayName":${str(displayName)},"password":${str(password)},"acceptedTosVersion":${str(tosVersion)}}""")

    suspend fun signOut() {
        val refresh = tokens.refreshToken
        tokens.clear()
        // Best effort: signed out on the phone either way.
        if (refresh != null) runCatching { post("/att/api/auth/logout", """{"refreshToken":${str(refresh)}}""") }
    }

    suspend fun me(): Me = query("me", Me.serializer())
    suspend fun paddles(): PaddleList = query("paddles.list", PaddleList.serializer())
    suspend fun paddle(id: String): AnalysisSession = query("paddles.get", AnalysisSession.serializer(), """{"id":${str(id)}}""")
    /** Writes a paddle's pending coach summary (can take a few seconds); the paddle as it is when already written. */
    suspend fun writeSummary(id: String): AnalysisSession = mutation("paddles.writeSummary", AnalysisSession.serializer(), """{"id":${str(id)}}""")

    private suspend fun signIn(path: String, body: String): SignIn {
        val answer = read(post(path, body), SignIn.serializer())
        tokens.save(answer.idToken, answer.refreshToken)
        return answer
    }

    /** A tRPC query: GET /api/trpc/<path>?input=<json>, answer {result:{data}}. */
    private suspend fun <T> query(path: String, out: KSerializer<T>, input: String? = null): T {
        val url = base.newBuilder().addPathSegments("api/trpc/$path").apply { if (input != null) addQueryParameter("input", input) }.build()
        return data(authorized { Request.Builder().url(url).header(AUTH, "Bearer $it").build() }, out)
    }

    /** A tRPC mutation: POST /api/trpc/<path> with the input as the body. */
    private suspend fun <T> mutation(path: String, out: KSerializer<T>, input: String): T {
        val url = base.newBuilder().addPathSegments("api/trpc/$path").build()
        return data(authorized { Request.Builder().url(url).header(AUTH, "Bearer $it").post(input.toRequestBody(jsonType)).build() }, out)
    }

    private fun <T> data(res: Answer, out: KSerializer<T>): T {
        if (!res.ok) throw error(res)
        val data = ApiJson.parseToJsonElement(res.body).jsonObject.getValue("result").jsonObject.getValue("data")
        return ApiJson.decodeFromJsonElement(out, data)
    }

    private suspend fun authorized(build: (idToken: String) -> Request): Answer {
        val sent = tokens.idToken ?: refreshed()
        val first = call(build(sent))
        if (first.code != 401) return first
        val retry = call(build(refreshed(stale = sent)))
        if (retry.code == 401) { tokens.clear(); throw SignedOut() }
        return retry
    }

    /** A fresh ID token; one refresh at a time, and none if another call already did it. */
    private suspend fun refreshed(stale: String? = null): String = refreshing.withLock {
        tokens.idToken?.let { if (stale == null || it != stale) return it }
        val refresh = tokens.refreshToken ?: throw SignedOut()
        val res = post("/att/api/auth/refresh", """{"refreshToken":${str(refresh)}}""")
        if (res.code == 401) { tokens.clear(); throw SignedOut() }
        val id = read(res, Refreshed.serializer()).idToken
        tokens.save(id)
        id
    }

    private suspend fun post(path: String, body: String): Answer =
        call(Request.Builder().url(base.newBuilder().addPathSegments(path.trimStart('/')).build()).post(body.toRequestBody(jsonType)).build())

    /** An answer read in full, so nothing touches the network on the caller's (main) thread. */
    private class Answer(val code: Int, val body: String) { val ok get() = code in 200..299 }

    private suspend fun call(req: Request): Answer = withContext(Dispatchers.IO) {
        try {
            http.newCall(req.newBuilder().header(APP_HEADER, "android/$appVersion").build()).execute().use { Answer(it.code, it.body.string()) }
        } catch (e: IOException) {
            throw ApiFailure("Couldn’t reach paddlesnitch. Check your connection and try again.")
        }
    }

    private fun <T> read(res: Answer, out: KSerializer<T>): T {
        if (!res.ok) throw error(res)
        return ApiJson.decodeFromString(out, res.body)
    }

    private fun error(res: Answer): ApiFailure {
        // Sign-in refusals are the contract's ApiError; tRPC's errors are shaped differently.
        val said = runCatching { ApiJson.decodeFromString(ApiError.serializer(), res.body).error }.getOrNull()
        return ApiFailure(said ?: "Something went wrong (${res.code}). Please try again.", res.code)
    }

    private fun str(s: String) = kotlinx.serialization.json.JsonPrimitive(s).toString()

    private companion object {
        const val AUTH = "Authorization"
        const val APP_HEADER = "x-paddlesnitch-app"
    }
}
