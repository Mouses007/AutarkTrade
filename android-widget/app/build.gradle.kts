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
        versionCode = 26
        versionName = "4.1.0-26"
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

    // APK nach Version benennen (autarktrade-widget-4.0.0-21-debug.apk) statt app-debug.apk —
    // so liegt nie eine alte Datei unter demselben Namen herum.
    applicationVariants.all {
        val variante = this
        outputs.all {
            (this as com.android.build.gradle.internal.api.BaseVariantOutputImpl).outputFileName =
                "autarktrade-widget-${variante.versionName}-${variante.buildType.name}.apk"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // UnifiedPush (Sofort-Zustellung der Chart-Alarme über die ntfy-App, ohne Google-Dienste).
    // 3.0.10 ist die letzte mit Kotlin 2.0.x gebaute Version — ab 3.1 bräuchte es Kotlin 2.2.
    implementation("org.unifiedpush.android:connector:3.0.10")
    // org.json is part of the Android platform — no dependency needed.
}
