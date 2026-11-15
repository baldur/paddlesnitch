// The Android Gradle plugin's own libraries include versions with security
// advisories (gradle/libs.versions.toml, "Lowest safe versions"). These
// constraints only raise a version; they add nothing AGP doesn't already use.
buildscript {
    dependencies {
        constraints {
            classpath(libs.safe.guava)
            classpath(libs.safe.commons.lang3)
            classpath(libs.safe.bcprov)
            classpath(libs.safe.bcpkix)
            classpath(libs.safe.bcutil)
            classpath(libs.safe.httpclient)
            classpath(libs.safe.jose4j)
            classpath(libs.safe.jdom2)
        }
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.roborazzi) apply false
}
