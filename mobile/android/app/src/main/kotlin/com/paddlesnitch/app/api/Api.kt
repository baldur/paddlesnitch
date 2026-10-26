package com.paddlesnitch.app.api

import com.paddlesnitch.app.auth.TokenStore
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.jsonObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Something to tell the person, in the server's own words when it gave some. */
/** [generic]: the server said nothing we can show, so the caller's own words ([shown]) say what failed. */
/** [reauth]: the server wants a sign-in from the last few minutes first (deleting the account). */
class ApiFailure(message: String, val status: Int = 0, val generic: Boolean = false, val reauth: Boolean = false) : Exception(message)

/** What to show for a failure: the server's or the app's own words, else [fallback]. Never a status code. */
fun Throwable.shown(fallback: String): String =
    // Only our own words reach the screen: any other exception's message is internal (a JSON parser quoting an HTML page, an Intent dump).
    if (this is ApiFailure && !generic || this is SignedOut) message ?: fallback else fallback

/** What the Account screens ask of the server (Api, or a fake in the tests). */
interface AccountApi {
    suspend fun me(): Me
    suspend fun terms(): TosStatus
    suspend fun acceptTerms(): TosAccepted
    suspend fun profile(): ProfileSettings
    suspend fun setProfilePublic(public: Boolean): ProfileSettings
    suspend fun claimHandle(handle: String): ProfileSettings
    suspend fun releaseHandle(): ProfileSettings
    suspend fun contact(): Contact
    suspend fun setContact(email: String): Contact
    suspend fun removeContact(): Ok
    /** Whether this session's sign-in is recent enough to delete the account. */
    suspend fun accountStatus(): AccountStatus
    suspend fun deleteAccount()
    suspend fun exportAccount(into: java.io.File): String
    suspend fun signedInPage(next: String): String
    // Strava for a signed-in account (mobile/contract/README.md § Strava, signed in).
    suspend fun stravaStatus(): StravaStatus
    /** The Strava page to open; 403 reauth when the sign-in is too old, 503 when Strava isn't set up. */
    suspend fun stravaConnect(challenge: String): WebPage
    suspend fun stravaConnectFinish(code: String, verifier: String): StravaStatus
    suspend fun setStravaAutoImport(enabled: Boolean): StravaAutoImport
    suspend fun stravaDisconnect(): Ok
}

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
    // Analysing an upload fetches the weather and river flow, so allow it a minute.
    private val http: OkHttpClient = OkHttpClient.Builder().readTimeout(60, TimeUnit.SECONDS).build(),
) : AccountApi {
    private val base = baseUrl.trimEnd('/').toHttpUrl()
    private val refreshing = Mutex()
    private val jsonType = "application/json".toMediaType()

    val signedIn: Boolean get() = tokens.refreshToken != null

    suspend fun login(email: String, password: String): SignIn =
        signIn("/att/api/auth/login", """{"email":${str(email)},"password":${str(password)}}""")

    suspend fun signUp(email: String, displayName: String, password: String, tosVersion: String): SignIn =
        signIn("/att/api/auth/signup", """{"email":${str(email)},"displayName":${str(displayName)},"password":${str(password)},"acceptedTosVersion":${str(tosVersion)}}""")

    /** Where Strava sign-in starts, for the Custom Tab (auth/StravaSignIn.kt). */
    fun stravaStartUrl(challenge: String): String =
        base.newBuilder().encodedPath("/att/api/auth/strava/init").addQueryParameter("challenge", challenge).build().toString()

    suspend fun stravaSignIn(code: String, verifier: String): SignIn =
        signIn("/att/api/auth/strava/app-token", """{"code":${str(code)},"verifier":${str(verifier)}}""")

    suspend fun signOut() {
        val refresh = tokens.refreshToken
        tokens.clear()
        // Best effort: signed out on the phone either way.
        if (refresh != null) runCatching { post("/att/api/auth/logout", """{"refreshToken":${str(refresh)}}""") }
    }

    /**
     * A website page that needs the website's sign-in (`next` is a path like
     * "/account#delete"), as a link that opens it already signed in: it carries
     * a one-minute, one-use code the website swaps for its cookies.
     */
    override suspend fun signedInPage(next: String): String {
        val url = base.newBuilder().addPathSegments("att/api/auth/web-code").build()
        val body = """{"next":${str(next)}}""".toRequestBody(jsonType)
        return read(authorized { Request.Builder().url(url).header(AUTH, "Bearer $it").post(body).build() }, WebPage.serializer()).url
    }

    override suspend fun me(): Me = query("me", Me.serializer())
    suspend fun paddles(): PaddleList = query("paddles.list", PaddleList.serializer())
    suspend fun paddle(id: String): AnalysisSession = query("paddles.get", AnalysisSession.serializer(), """{"id":${str(id)}}""")
    /** Writes a paddle's pending coach summary (can take a few seconds); the paddle as it is when already written. */
    suspend fun writeSummary(id: String): AnalysisSession = mutation("paddles.writeSummary", AnalysisSession.serializer(), """{"id":${str(id)}}""")

    // Account (mobile/contract/README.md § Account): the website's /api/account routes with the Bearer token.
    override suspend fun terms(): TosStatus = account("GET", "api/account/tos", null, TosStatus.serializer())
    override suspend fun acceptTerms(): TosAccepted =
        account("POST", "api/account/tos", """{"version":${str(Constants.tosVersion)}}""", TosAccepted.serializer())
    override suspend fun profile(): ProfileSettings = account("GET", "api/account/profile", null, ProfileSettings.serializer())
    override suspend fun setProfilePublic(public: Boolean): ProfileSettings =
        account("PATCH", "api/account/profile", """{"public":$public}""", ProfileSettings.serializer())
    override suspend fun claimHandle(handle: String): ProfileSettings =
        account("PUT", "api/account/handle", """{"handle":${str(handle)}}""", ProfileSettings.serializer())
    override suspend fun releaseHandle(): ProfileSettings = account("DELETE", "api/account/handle", null, ProfileSettings.serializer())
    override suspend fun contact(): Contact = account("GET", "api/account/contact", null, Contact.serializer())
    override suspend fun setContact(email: String): Contact = account("POST", "api/account/contact", """{"email":${str(email)}}""", Contact.serializer())
    override suspend fun removeContact(): Ok = account("DELETE", "api/account/contact", null, Ok.serializer())

    override suspend fun stravaStatus(): StravaStatus = account("GET", "att/api/strava/status", null, StravaStatus.serializer())
    override suspend fun stravaConnect(challenge: String): WebPage =
        account("POST", "att/api/strava/app-connect", """{"challenge":${str(challenge)}}""", WebPage.serializer())
    override suspend fun stravaConnectFinish(code: String, verifier: String): StravaStatus =
        account("POST", "att/api/strava/app-connect/finish", """{"code":${str(code)},"verifier":${str(verifier)}}""", StravaStatus.serializer())
    override suspend fun setStravaAutoImport(enabled: Boolean): StravaAutoImport =
        account("POST", "att/api/strava/auto-import", """{"enabled":$enabled}""", StravaAutoImport.serializer())
    override suspend fun stravaDisconnect(): Ok = account("POST", "att/api/strava/disconnect", null, Ok.serializer())

    override suspend fun accountStatus(): AccountStatus = account("GET", "api/account", null, AccountStatus.serializer())

    /** Erases the account; the refresh token stops working, so the stored tokens go too. */
    override suspend fun deleteAccount() {
        account("DELETE", "api/account", """{"refreshToken":${str(tokens.refreshToken.orEmpty())}}""", Ok.serializer())
        tokens.clear()
    }

    /**
     * "Download my data": the server writes the file and answers a 5-minute
     * link to it, which is fetched at once into [into]. Returns the file name
     * the website would save it as.
     */
    override suspend fun exportAccount(into: java.io.File): String {
        val link = account("POST", "api/account/export", null, DownloadLink.serializer()).url
        val url = base.resolve(link) ?: throw ApiFailure("Couldn’t prepare your download. Please try again.")
        // A signed S3 link takes no Authorization header; in local dev the link is our own GET, which does.
        val ours = url.host == base.host && url.port == base.port
        return withContext(Dispatchers.IO) {
            val req = Request.Builder().url(url).header(APP_HEADER, "android/$appVersion")
                .apply { if (ours) tokens.idToken?.let { header(AUTH, "Bearer $it") } }.build()
            try {
                // A half-written export is personal data left on the phone: never keep one.
                runCatching { http.newCall(req).execute() }.onFailure { into.delete() }.getOrThrow().use { res ->
                    if (!res.isSuccessful) { into.delete(); throw ApiFailure("Couldn’t prepare your download. Please try again.", res.code) }
                    runCatching { into.outputStream().use { res.body.byteStream().copyTo(it) } }.onFailure { into.delete() }.getOrThrow()
                    Regex("filename=\"?([^\";]+)").find(res.header("Content-Disposition").orEmpty())?.groupValues?.get(1) ?: "paddlesnitch-data.json"
                }
            } catch (e: IOException) {
                throw ApiFailure("Couldn’t reach paddlesnitch. Check your connection and try again.")
            }
        }
    }

    private suspend fun <T> account(method: String, path: String, body: String?, out: KSerializer<T>): T {
        val url = base.newBuilder().addPathSegments(path).build()
        return read(authorized { Request.Builder().url(url).header(AUTH, "Bearer $it").method(method, body?.toRequestBody(jsonType) ?: if (method == "GET" || method == "DELETE") null else ByteArray(0).toRequestBody()).build() }, out)
    }

    /**
     * A REST call as the signed-in person (`Authorization: Bearer`), for the
     * routes the app shares with the website: tracker setup and sync.
     * POST when there's a body, else GET.
     */
    suspend fun rest(path: String, query: Map<String, String> = emptyMap(), body: ByteArray? = null, type: String = "application/json", headers: Map<String, String> = emptyMap()): Answer {
        val url = base.newBuilder().addPathSegments(path.trimStart('/')).apply { query.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        return authorized { token ->
            Request.Builder().url(url).header(AUTH, "Bearer $token").apply {
                headers.forEach { (k, v) -> header(k, v) }
                if (body != null) post(body.toRequestBody(type.toMediaType()))
            }.build()
        }
    }

    private suspend fun signIn(path: String, body: String): SignIn {
        val answer = read(post(path, body), SignIn.serializer())
        tokens.save(answer.idToken, answer.refreshToken)
        return answer
    }

    /** Analyse and save a recording (GPX, FIT, TCX, CSV, or a zip of one), as the website's upload does. */
    suspend fun upload(fileName: String, bytes: ByteArray): Analysed {
        val url = base.newBuilder().addPathSegments("paddles/api/analyse").build()
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, bytes.toRequestBody("application/octet-stream".toMediaType())).build()
        return read(authorized { Request.Builder().url(url).header(AUTH, "Bearer $it").post(body).build() }, Analysed.serializer())
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
    class Answer(val code: Int, val body: String) { val ok get() = code in 200..299 }

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
        val error = runCatching { ApiJson.decodeFromString(ApiError.serializer(), res.body) }.getOrNull()
        val said = error?.error
        // A request over ~4.6 MB is refused before our code sees it (prepareUpload stops short of that).
        if (said == null && res.code == 413) return ApiFailure(com.paddlesnitch.app.paddles.TOO_BIG, 413)
        return if (said != null) ApiFailure(said, res.code, reauth = error.reauth == true) else ApiFailure("Couldn’t finish that. Please try again.", res.code, generic = true)
    }

    private fun str(s: String) = kotlinx.serialization.json.JsonPrimitive(s).toString()

    private companion object {
        const val AUTH = "Authorization"
        const val APP_HEADER = "x-paddlesnitch-app"
    }
}
