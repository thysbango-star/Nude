import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// PassGate (mobile). Release signing: from CI secrets when present, otherwise the debug key (installable for testing).
val keystoreB64: String? = System.getenv("NUDE_KEYSTORE_BASE64")?.takeIf { it.isNotBlank() }
val releaseKeystore: File? = keystoreB64?.let {
    val f = layout.buildDirectory.file("rovian-release.jks").get().asFile
    f.parentFile.mkdirs()
    f.writeBytes(Base64.getMimeDecoder().decode(it))
    f
}

android {
    namespace = "os.rovian.passgate"
    compileSdk = 35

    defaultConfig {
        applicationId = "os.rovian.passgate"
        minSdk = 29
        targetSdk = 35
        versionCode = 3
        versionName = "0.3.0"
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
    // QR scanning for the code Nude shows on your PC (works without Google Play services).
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation(project(":core"))
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    testImplementation("junit:junit:4.13.2")
}
