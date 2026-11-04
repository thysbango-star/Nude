import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Release signing: from CI secrets when present, otherwise the debug key (installable for testing).
val keystoreB64: String? = System.getenv("NUDE_KEYSTORE_BASE64")?.takeIf { it.isNotBlank() }
val releaseKeystore: File? = keystoreB64?.let {
    val f = layout.buildDirectory.file("nude-release.jks").get().asFile
    f.parentFile.mkdirs()
    f.writeBytes(Base64.getMimeDecoder().decode(it))
    f
}

android {
    namespace = "os.nude.browser"
    compileSdk = 35

    defaultConfig {
        applicationId = "os.nude.browser"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = System.getenv("NUDE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("NUDE_KEY_ALIAS")
                keyPassword = System.getenv("NUDE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (releaseKeystore != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

dependencies {
    implementation(project(":core"))
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
}
