import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
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
        // The server the app talks to. Point a debug build at a dev server with
        // -Ppaddlesnitch.api=http://<your Mac's LAN address>:3000
        val api = (project.findProperty("paddlesnitch.api") as String?) ?: "https://paddlesnitch.com"
        buildConfigField("String", "API_BASE_URL", "\"$api\"")
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

    // Compose UI and screenshot tests run on the JVM under Robolectric.
    testOptions.unitTests {
        isIncludeAndroidResources = true
        // Robolectric reaches into java.io on newer JDKs (Android Studio's is 25).
        all { it.jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED", "--add-opens=java.base/java.io=ALL-UNNAMED", "--enable-native-access=ALL-UNNAMED") }
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

// The API models, from the shared contract (mobile/contract/api), the same
// way: see buildSrc/src/main/kotlin/ContractModels.kt.
abstract class GenerateModels : DefaultTask() {
    @get:InputDirectory abstract val apiDir: DirectoryProperty
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val dir = outputDir.get().asFile.resolve("com/paddlesnitch/app/api").apply { mkdirs() }
        dir.resolve("Models.kt").writeText(ContractModels.generate(apiDir.get().asFile, "com.paddlesnitch.app.api"))
    }
}

val generateModels = tasks.register<GenerateModels>("generateModels") {
    apiDir.set(rootProject.layout.projectDirectory.dir("../contract/api"))
    outputDir.set(layout.buildDirectory.dir("generated/models"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.kotlin?.addGeneratedSourceDirectory(generateTokens, GenerateTokens::outputDir)
        variant.sources.kotlin?.addGeneratedSourceDirectory(generateModels, GenerateModels::outputDir)
        // The contract's golden answers ship as the app's sample paddles
        // (shown until sign-in, labelled as samples).
        variant.sources.assets?.addStaticSourceDirectory(rootProject.layout.projectDirectory.dir("../contract/fixtures").asFile.path)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.okhttp)
    implementation(libs.maplibre)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(libs.json)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
}

// Screenshot goldens are committed beside the tests: `./gradlew recordRoborazziDebug`
// writes them, `verifyRoborazziDebug` (run by CI) fails on any difference.
roborazzi {
    outputDir.set(file("src/test/screenshots"))
}
