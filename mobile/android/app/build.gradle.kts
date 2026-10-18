// The CasaTorch app for Android phones and tablets. Open mobile/android in Android Studio and run, or:
//   gradle -p mobile/android assembleDebug
// Push alerts also need google-services.json from your Firebase project in app/ (see mobile/README.md);
// without it the app works, with alerts switched off.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "com.casatorch.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.casatorch.app"
        minSdk = 28
        targetSdk = 35
        versionCode = 800          // 0.8.0 -> 800; raise it for every upload
        versionName = "0.8.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    lint { abortOnError = false; checkReleaseBuilds = false }
    // the app's own screens (mobile/shell) are shared with the iPhone app; they're copied in at build time
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/casa-assets"))
}

val copyShell by tasks.registering(Copy::class) {
    from("../../shell")
    into(layout.buildDirectory.dir("generated/casa-assets/shell"))
}
tasks.named("preBuild") { dependsOn(copyShell) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.biometric:biometric:1.2.0-alpha05")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
}
