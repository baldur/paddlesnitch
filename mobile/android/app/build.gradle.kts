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
    // The recorder core (recorder-core/) is C, built with the app's JNI wrapper.
    ndkVersion = "28.2.13676358"

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

    externalNativeBuild {
        cmake { path = file("src/main/cpp/CMakeLists.txt") }
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

// The release build declares exactly these permissions, because Play's forms ask
// about each one. Changing the list is a decision: it changes the Play data safety
// form and the declarations (PLAY-RELEASE.md). The map library adds fine and coarse
// location, which src/release/AndroidManifest.xml removes. The app's own manifest
// may not declare location while that overlay exists, or the overlay would quietly
// remove it from release too. Phone recording (#761) deletes the overlay and adds
// its permissions here.
val releasePermissions = setOf(
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",           // OkHttp, MapLibre
    "android.permission.ACCESS_WIFI_STATE",              // MapLibre
    "android.permission.BLUETOOTH",                      // tracker setup, Android 10-11
    "android.permission.BLUETOOTH_ADMIN",                // tracker setup, Android 10-11
    "android.permission.BLUETOOTH_CONNECT",              // tracker setup, Android 12+
    "com.paddlesnitch.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",  // androidx, app-internal
)

abstract class CheckReleasePermissions : DefaultTask() {
    @get:InputFile abstract val merged: RegularFileProperty
    @get:InputFile abstract val appManifest: RegularFileProperty
    @get:Input abstract val allowed: SetProperty<String>

    @TaskAction
    fun check() {
        val names = Regex("""<uses-permission(?:-sdk-23)?\s[^>]*android:name="([^"]+)"""")
        val declared = names.findAll(merged.get().asFile.readText()).map { it.groupValues[1] }.toSet()
        val extra = declared - allowed.get()
        val missing = allowed.get() - declared
        check(extra.isEmpty() && missing.isEmpty()) {
            "The release build's permissions changed: added $extra, gone $missing. " +
                "Update releasePermissions in app/build.gradle.kts and the Play forms (PLAY-RELEASE.md)."
        }
        val own = names.findAll(appManifest.get().asFile.readText()).map { it.groupValues[1] }.filter { "LOCATION" in it }.toList()
        check(own.isEmpty()) {
            "src/main/AndroidManifest.xml declares $own, which src/release/AndroidManifest.xml removes from release. " +
                "Delete that overlay and add the permissions to releasePermissions (#761)."
        }
    }
}

androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        val cap = variant.name.replaceFirstChar { it.uppercase() }
        val task = tasks.register<CheckReleasePermissions>("check${cap}Permissions") {
            merged.set(variant.artifacts.get(com.android.build.api.artifact.SingleArtifact.MERGED_MANIFEST))
            appManifest.set(layout.projectDirectory.file("src/main/AndroidManifest.xml"))
            allowed.set(releasePermissions)
        }
        tasks.named("check") { dependsOn(task) }
        // Every release build runs it, including one built by hand for Play.
        tasks.matching { it.name == "assemble$cap" || it.name == "bundle$cap" }.configureEach { dependsOn(task) }
    }
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
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.androidx.browser)
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
// The same JNI library built for this computer, so the unit tests replay
// recorder-core/fixtures through the real binding (RecorderFixturesTest).
// Needs cmake and a C compiler on the PATH (both are on CI's runners).
val hostRecorderDir = layout.buildDirectory.dir("host-recorder")
val hostRecorder = tasks.register("hostRecorder") {
    val src = file("src/main/cpp")
    val out = hostRecorderDir.get().asFile
    inputs.dir(src)
    inputs.dir(rootProject.file("../../recorder-core/src"))
    inputs.dir(rootProject.file("../../recorder-core/include"))
    outputs.dir(out)
    // jni.h from the NDK (it's the standard interface; Android Studio's JDK has no headers).
    val ndk = androidComponents.sdkComponents.ndkDirectory
    doLast {
        val headers = out.resolve("jni").apply { mkdirs() }
        ndk.get().asFile.resolve("toolchains/llvm/prebuilt").listFiles()!!.first()
            .resolve("sysroot/usr/include/jni.h").copyTo(headers.resolve("jni.h"), overwrite = true)
        fun run(vararg args: String) {
            val p = ProcessBuilder(*args).inheritIO().start()
            check(p.waitFor() == 0) { "failed: ${args.joinToString(" ")}" }
        }
        run("cmake", "-S", src.path, "-B", out.path, "-DCMAKE_BUILD_TYPE=Release", "-DHOST_JNI_INCLUDE=${headers.path}")
        run("cmake", "--build", out.path, "--target", "recorder")
    }
}
tasks.withType<Test>().configureEach {
    dependsOn(hostRecorder)
    val lib = hostRecorderDir.get().asFile.resolve(if (System.getProperty("os.name").startsWith("Mac")) "librecorder.dylib" else "librecorder.so")
    inputs.file(lib).withPropertyName("recorderLib")   // a changed library reruns the tests
    systemProperty("paddlesnitch.recorder.lib", lib.path)
}

roborazzi {
    outputDir.set(file("src/test/screenshots"))
}
