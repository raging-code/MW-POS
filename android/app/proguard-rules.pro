# ─────────────────────────────────────────────────────────────────────────────
# proguard-rules.pro — MW POS
#
# CONTEXT: build.gradle now sets minifyEnabled=true and
# proguardFiles getDefaultProguardFile('proguard-android-optimize.txt')
# which enables R8's full optimisation mode (not just stripping).
#
# These rules keep the classes that Capacitor and the BluetoothPrinterPlugin
# need to reflect into at runtime.
# ─────────────────────────────────────────────────────────────────────────────

# ── Capacitor bridge — reflection-heavy, must not be obfuscated ──────────────
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.CapacitorPlugin <fields>;
    @com.getcapacitor.PluginMethod public *;
}

# ── Our custom Bluetooth plugin ───────────────────────────────────────────────
-keep class com.mwpos.app.BluetoothPrinterPlugin { *; }
-keep class com.mwpos.app.MainActivity { *; }

# ── AndroidX / Jetpack — keep annotation-processed classes ───────────────────
-keep class androidx.core.app.** { *; }
-keep class androidx.core.content.FileProvider { *; }
-dontwarn androidx.window.**

# ── Kotlin reflection & coroutines ───────────────────────────────────────────
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**
-keepclassmembers class **$WhenMappings { <fields>; }

# ── Cordova / Capacitor plugins ──────────────────────────────────────────────
-keep class org.apache.cordova.** { *; }

# ── Preserve debug line numbers for crash reports ────────────────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Suppress R8 warnings for optional dependencies ───────────────────────────
-dontwarn com.google.android.gms.**
-dontwarn com.google.firebase.**