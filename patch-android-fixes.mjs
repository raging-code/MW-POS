#!/usr/bin/env node
// patch-android-fixes.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Fixes two Android issues in MW-POS:
//   1. STATUS BAR / NAV BAR OVERLAP  — app content goes behind system bars
//   2. WRONG APP ICON                — launcher still shows default Capacitor
//                                      icon instead of MWIcon.png
//
// Usage (run from the project root):
//   node patch-android-fixes.mjs
//
// Requirements: ImageMagick must be installed (`convert` / `magick` on PATH).
//   Install: sudo apt install imagemagick   OR   brew install imagemagick
// ─────────────────────────────────────────────────────────────────────────────

import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ── helpers ──────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`  ✔  ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }
function die(msg)  { console.error(`  ✖  ${msg}`); process.exit(1); }

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  log(`Written: ${path.relative(ROOT, filePath)}`);
}

function checkImageMagick() {
  // Try both the legacy `convert` binary and the newer `magick` CLI
  for (const bin of ["magick", "convert"]) {
    const r = spawnSync(bin, ["--version"], { stdio: "pipe" });
    if (r.status === 0) return bin;
  }
  return null;
}

function resizePng(src, dest, size, imBin) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const args =
    imBin === "magick"
      ? ["magick", src, "-resize", `${size}x${size}`, "-gravity", "center",
         "-background", "none", "-extent", `${size}x${size}`, dest]
      : [src, "-resize", `${size}x${size}`, "-gravity", "center",
         "-background", "none", "-extent", `${size}x${size}`, dest];
  const r = spawnSync(imBin === "magick" ? "magick" : "convert", args.slice(imBin === "magick" ? 1 : 0), { stdio: "pipe" });
  if (r.status !== 0) die(`ImageMagick failed for ${dest}:\n${r.stderr?.toString()}`);
  log(`Icon → ${path.relative(ROOT, dest)} (${size}×${size})`);
}

// ── paths ─────────────────────────────────────────────────────────────────────

const ANDROID_RES   = path.join(ROOT, "android/app/src/main/res");
const ANDROID_JAVA  = path.join(ROOT, "android/app/src/main/java/com/mwpos/app");
const MANIFEST      = path.join(ROOT, "android/app/src/main/AndroidManifest.xml");
const STYLES        = path.join(ANDROID_RES, "values/styles.xml");
const STYLES_NIGHT  = path.join(ANDROID_RES, "values-night/styles.xml");
const MAIN_ACTIVITY = path.join(ANDROID_JAVA, "MainActivity.kt");
const SOURCE_ICON   = path.join(ROOT, "public/MWIcon.png");

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 1 — FULL-SCREEN (hide status bar + navigation bar)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── PATCH 1: Full-screen / hide system bars ──────────────────────────────");

// 1-A  styles.xml  — add windowFullscreen flags to AppTheme.NoActionBar
const newStyles = `<?xml version="1.0" encoding="utf-8"?>
<resources>

    <!-- Base application theme. -->
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <!--
        FIX (system-bar overlap):
          windowFullscreen  — hides the status bar at the top.
          windowLayoutInDisplayCutoutMode shortEdges — lets content run into
            display cutout (notch) areas on API 28+ so nothing is clipped.
          android:background matches the app's warm-beige surface (#F0EDE8)
            to prevent a colour flash on cold start / activity resume.
    -->
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
        <item name="android:background">#F0EDE8</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
    </style>

</resources>
`;
writeFile(STYLES, newStyles);

// 1-B  values-night/styles.xml  — mirror for dark mode (same full-screen flags)
const nightStyles = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!--
        Night-mode mirror of AppTheme.NoActionBar.
        Keeps the same full-screen flags so the behaviour is consistent
        regardless of system dark-mode setting.
    -->
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
        <item name="android:background">#F0EDE8</item>
    </style>
</resources>
`;
writeFile(STYLES_NIGHT, nightStyles);

// 1-C  MainActivity.kt — add WindowInsetsController to hide nav bar at runtime
//      (XML flags hide the status bar; the nav bar needs the Window API on API 30+
//       and the legacy View flags on older versions)
const mainActivityContent = `// android/app/src/main/java/com/mwpos/app/MainActivity.kt
//
// PATCH: Added hideSystemBars() to suppress status bar AND navigation bar so
//        the app runs edge-to-edge without any system UI overlapping content.
//        Uses WindowInsetsController on API 30+ and the legacy systemUiVisibility
//        flags on older Android versions.

package com.mwpos.app

import android.os.Build
import android.os.Bundle
import android.os.Process
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.WebSettings
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(BluetoothPrinterPlugin::class.java)
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                WebView.setDataDirectorySuffix("mwpos_main")
            } catch (_: Exception) {}
        }

        hideSystemBars()
        tuneWebView()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Re-apply every time the window regains focus (e.g. after a dialog).
        if (hasFocus) hideSystemBars()
    }

    // ── Full-screen: hides BOTH status bar and navigation bar ────────────────
    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // API 30+ — WindowInsetsController (recommended)
            window.insetsController?.let { ctrl ->
                ctrl.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                ctrl.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            // API < 30 — legacy systemUiVisibility flags
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
            )
        }
    }

    // ── WebView performance tuning (unchanged from previous version) ─────────
    private fun tuneWebView() {
        val webView: WebView = bridge.webView ?: return
        val settings: WebSettings = webView.settings

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(
                WebView.RENDERER_PRIORITY_BOUND,
                true
            )
        }

        webView.post {
            Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY)
        }

        @Suppress("DEPRECATION")
        settings.savePassword             = false
        settings.saveFormData             = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        webView.importantForAccessibility = WebView.IMPORTANT_FOR_ACCESSIBILITY_NO
        settings.textZoom = 100
    }
}
`;
writeFile(MAIN_ACTIVITY, mainActivityContent);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 2 — APP ICON (replace default Capacitor icon with MWIcon.png)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── PATCH 2: Replace app icon with MWIcon.png ────────────────────────────");

if (!fs.existsSync(SOURCE_ICON)) {
  die(`Source icon not found: ${SOURCE_ICON}\nMake sure public/MWIcon.png exists.`);
}

const imBin = checkImageMagick();
if (!imBin) {
  warn("ImageMagick not found — skipping icon generation.");
  warn("Install it and re-run:  sudo apt install imagemagick  OR  brew install imagemagick");
} else {
  log(`Using ImageMagick binary: ${imBin}`);

  // Android launcher icon sizes (px)  mipmap-density : size
  const SIZES = {
    "mipmap-mdpi":    48,
    "mipmap-hdpi":    72,
    "mipmap-xhdpi":   96,
    "mipmap-xxhdpi":  144,
    "mipmap-xxxhdpi": 192,
  };

  for (const [density, size] of Object.entries(SIZES)) {
    const destDir = path.join(ANDROID_RES, density);

    resizePng(SOURCE_ICON, path.join(destDir, "ic_launcher.png"),           size,          imBin);
    resizePng(SOURCE_ICON, path.join(destDir, "ic_launcher_round.png"),     size,          imBin);
    resizePng(SOURCE_ICON, path.join(destDir, "ic_launcher_foreground.png"),
              Math.round(size * 1.25),  // foreground layer is 125% for adaptive icon safe zone
              imBin);
  }

  // Update adaptive icon background to white (clean behind the logo)
  const BG_XML = path.join(ANDROID_RES, "values/ic_launcher_background.xml");
  writeFile(BG_XML, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FFFFFF</color>
</resources>
`);

  // Ensure the adaptive icon XML references are correct (no-op if already right)
  const ADAPTIVE = path.join(ANDROID_RES, "mipmap-anydpi-v26/ic_launcher.xml");
  writeFile(ADAPTIVE, `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`);

  const ADAPTIVE_ROUND = path.join(ANDROID_RES, "mipmap-anydpi-v26/ic_launcher_round.xml");
  writeFile(ADAPTIVE_ROUND, `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DONE
// ─────────────────────────────────────────────────────────────────────────────

console.log(`
────────────────────────────────────────────────────────────
  ✅  Patch applied successfully!

  Next steps:
    1.  npx cap sync android          ← sync web assets + config
    2.  Open Android Studio and do:
          Build → Clean Project
          Build → Rebuild Project
    3.  Run on your device / emulator to verify:
          • App is full-screen (no status/nav bar overlay)
          • Launcher icon shows the MW logo
────────────────────────────────────────────────────────────
`);
