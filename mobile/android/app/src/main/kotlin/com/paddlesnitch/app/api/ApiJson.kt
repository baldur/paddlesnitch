package com.paddlesnitch.app.api

import kotlinx.serialization.json.Json

/** How every API answer is read: fields this app doesn't know are skipped (contract rule 1). */
val ApiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}
