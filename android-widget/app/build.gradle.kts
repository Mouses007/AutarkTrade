import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release-Signatur: Schlüssel liegt NIE im Repo, sondern ausserhalb (Vorgabe
// ~/.config/autarktrade/android-release.properties, anderer Pfad über die
// Umgebungsvariable AT_ANDROID_SIGNIERUNG). Die Datei nennt storeFile, storePassword,
// keyAlias, keyPassword. Fehlt sie, bricht der Release-Build ab (unten) — kein stilles
// Signieren mit dem Debug-Schlüssel, sonst passte ein Update nicht mehr zur Installation.
val signierDatei = file(
    System.getenv("AT_ANDROID_SIGNIERUNG")
        ?: "${System.getProperty("user.home")}/.config/autarktrade/android-release.properties"
)
val signierung = Properties().apply {
    if (signierDatei.isFile) signierDatei.inputStream().use { load(it) }
}

android {
    namespace = "com.autarktrade.widget"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.autarktrade.widget"
        minSdk = 31
        targetSdk = 35
        versionCode = 28
        versionName = "4.2.0-28"
    }

    signingConfigs {
        create("release") {
            if (signierDatei.isFile) {
                storeFile = file(signierung.getProperty("storeFile") ?: "")
                storePassword = signierung.getProperty("storePassword")
                keyAlias = signierung.getProperty("keyAlias")
                keyPassword = signierung.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
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

    // APK nach Version benennen (Release: autarktrade-widget-4.2.0-28.apk, Debug mit
    // „-debug") statt app-release.apk — so liegt nie eine alte Datei unter demselben Namen herum.
    applicationVariants.all {
        val variante = this
        val zusatz = if (variante.buildType.name == "release") "" else "-${variante.buildType.name}"
        outputs.all {
            (this as com.android.build.gradle.internal.api.BaseVariantOutputImpl).outputFileName =
                "autarktrade-widget-${variante.versionName}$zusatz.apk"
        }
    }
}

// Release-Build ohne Signierdatei: klar abbrechen statt unsigniert/debug-signiert bauen.
gradle.taskGraph.whenReady {
    val baueRelease = allTasks.any { it.project == project && it.name.contains("Release") &&
        (it.name.startsWith("assemble") || it.name.startsWith("package") || it.name.startsWith("bundle")) }
    if (baueRelease) {
        val fehlt = when {
            !signierDatei.isFile -> "Signierdatei fehlt: $signierDatei"
            listOf("storeFile", "storePassword", "keyAlias", "keyPassword").any { signierung.getProperty(it).isNullOrBlank() } ->
                "Signierdatei unvollständig (storeFile, storePassword, keyAlias, keyPassword): $signierDatei"
            !file(signierung.getProperty("storeFile")).isFile -> "Keystore fehlt: ${signierung.getProperty("storeFile")}"
            else -> null
        }
        if (fehlt != null) throw GradleException(
            "Release-Signatur: $fehlt — Pfad über AT_ANDROID_SIGNIERUNG setzen (siehe android-widget/README.md). " +
            "Für Testbuilds: assembleDebug.")
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
