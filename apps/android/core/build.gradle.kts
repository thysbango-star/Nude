plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Shared by Nude, Rovian Defender and PassGate: the Rovian Defender engine, Sign in with Rovian, and the matte theme.
android {
    namespace = "os.rovian.core"
    compileSdk = 35
    defaultConfig { minSdk = 29; consumerProguardFiles("consumer-rules.pro") }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    api(composeBom)
    api("androidx.core:core-ktx:1.13.1")
    api("androidx.activity:activity-compose:1.9.3")
    api("androidx.compose.ui:ui")
    api("androidx.compose.foundation:foundation")
    api("androidx.compose.material3:material3")
    api("androidx.compose.material:material-icons-core")
    testImplementation("junit:junit:4.13.2")
    // Android's org.json is a stub in local unit tests; use the real one there.
    testImplementation("org.json:json:20240303")
}
