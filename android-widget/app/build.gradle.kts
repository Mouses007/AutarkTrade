plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.autarktrade.widget"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.autarktrade.widget"
        minSdk = 31
        targetSdk = 35
        versionCode = 20
        versionName = "4.0.0-20"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // org.json is part of the Android platform — no dependency needed.
}
