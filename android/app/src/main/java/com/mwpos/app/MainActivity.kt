// android/app/src/main/java/com/mwpos/app/MainActivity.kt
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
