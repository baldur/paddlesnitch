import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// The release build is signed with the upload key when CI provides it (a
// GitHub secret; see docs/features/android-app.md). Without it, only debug
// builds sign, with the usual local debug key.
val uploadKeystore = System.getenv("PS_UPLOAD_KEYSTORE")

android {
    namespace = "com.paddlesnitch.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.paddlesnitch.app"
        minSdk = 29
        targetSdk = 37
        versionCode = System.getenv("PS_VERSION_CODE")?.toInt() ?: 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (uploadKeystore != null) create("upload") {
            storeFile = file(uploadKeystore)
            storePassword = System.getenv("PS_UPLOAD_STORE_PASSWORD")
            keyAlias = System.getenv("PS_UPLOAD_KEY_ALIAS")
            keyPassword = System.getenv("PS_UPLOAD_KEY_PASSWORD")
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            if (uploadKeystore != null) signingConfig = signingConfigs.getByName("upload")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

// Colours and corner radii come from the shared design tokens
// (mobile/contract/tokens/tokens.json, written by `pnpm mobile:contract` from
// the website's CSS), generated into Kotlin at build time so the app can't
// drift from the website.
abstract class GenerateTokens : DefaultTask() {
    @get:InputFile abstract val tokens: RegularFileProperty
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        @Suppress("UNCHECKED_CAST")
        val json = JsonSlurper().parse(tokens.get().asFile) as Map<String, Map<String, Any>>
        val name = { key: String -> key.split('-').mapIndexed { i, w -> if (i == 0) w else w.replaceFirstChar(Char::uppercase) }.joinToString("") }
        val colors = json.getValue("color").entries.joinToString("\n") { (k, v) ->
            "    val ${name(k)} = Color(0xFF${(v as String).removePrefix("#").uppercase()})"
        }
        val colorMap = json.getValue("color").keys.joinToString(", ") { "\"$it\" to ${name(it)}" }
        val radii = json.getValue("radius").entries.joinToString("\n") { (k, v) -> "    val ${name(k)} = ${v}.dp" }
        val dir = outputDir.get().asFile.resolve("com/paddlesnitch/app/ui").apply { mkdirs() }
        dir.resolve("Tokens.kt").writeText(
            """
            |// Generated from mobile/contract/tokens/tokens.json. Do not edit.
            |package com.paddlesnitch.app.ui
            |
            |import androidx.compose.ui.graphics.Color
            |import androidx.compose.ui.unit.dp
            |
            |object PsColor {
            |$colors
            |
            |    /** Every colour by its token name, for tests. */
            |    val all: Map<String, Color> = mapOf($colorMap)
            |}
            |
            |object PsRadius {
            |$radii
            |}
            |""".trimMargin()
        )
    }
}

val generateTokens = tasks.register<GenerateTokens>("generateTokens") {
    tokens.set(rootProject.layout.projectDirectory.file("../contract/tokens/tokens.json"))
    outputDir.set(layout.buildDirectory.dir("generated/tokens"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.kotlin?.addGeneratedSourceDirectory(generateTokens, GenerateTokens::outputDir)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(libs.json)
}
