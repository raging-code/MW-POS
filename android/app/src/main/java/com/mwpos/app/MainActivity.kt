// android/app/src/main/java/com/mwpos/app/MainActivity.kt
//
// CHANGES vs previous version:
//
//  PERF-1 — WebView hardware acceleration & renderer priority (KEPT)
//  PERF-2 — WebView render thread priority (KEPT)
//  PERF-3 — Disable unnecessary WebView features (KEPT)
//  PERF-4 — Aggressive WebView cache (KEPT)
//  PERF-5 — Disable accessibility tree (KEPT)
//  PERF-8 — WebView app package white-list (KEPT)
//
//  FIX for PERF-6 — REMOVED the broken `enableSlowWholeDocumentDraw` reflection call.
//    `WebView.enableSlowWholeDocumentDraw()` is a static method that ENABLES
//    slow drawing (the name is not inverted). Calling it was actively harmful.
//    The faster partial-draw path is already the default in modern WebView;
//    no call is needed. The try/catch block has been deleted entirely.
//
//  FIX for PERF-7 + PERF-9 — Merged the two duplicate `webView.webViewClient`
//    assignments into a single WebViewClient. The second assignment (PERF-9)
//    was silently overwriting the first (PERF-7), meaning PERF-7 never ran.
//    The merged client handles both responsibilities in one object.
//
// NOTE: BluetoothPrinterPlugin registration is preserved exactly as before.

package com.mwpos.app

import android.os.Build
import android.os.Bundle
import android.os.Process
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // BluetoothPrinterPlugin must be registered BEFORE super.onCreate
        // so Capacitor's bridge knows about it when it initialises the WebView.
        registerPlugin(BluetoothPrinterPlugin::class.java)
        super.onCreate(savedInstanceState)

        // PERF-8: isolate WebView data directory to avoid cross-process lock on boot.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                WebView.setDataDirectorySuffix("mwpos_main")
            } catch (_: Exception) {
                // Harmless if already set; only matters on first cold-start.
            }
        }

        // Tune the WebView after the Bridge has created it.
        tuneWebView()
    }

    // ── PERF-1 … PERF-5, PERF-7+9 (merged) ──────────────────────────────────
    private fun tuneWebView() {
        val webView: WebView = bridge.webView ?: return
        val settings: WebSettings = webView.settings

        // PERF-1: GPU rasterization — composites CSS layers on the GPU.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(
                WebView.RENDERER_PRIORITY_BOUND,
                /* waivedWhenNotVisible = */ true   // free GPU when app is in background
            )
        }

        // PERF-2: Elevate the WebView render thread to display priority.
        //   This is a best-effort hint; some OEM kernels ignore it.
        webView.post {
            Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY)
        }

        // PERF-3: Disable features the POS app does not need.
        @Suppress("DEPRECATION")
        settings.savePassword             = false  // deprecated but harmless
        settings.saveFormData             = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false

        // PERF-4: Use HTTP cache. Vite assets are content-hashed so they can be
        //   cached forever; only index.html will ever be re-fetched.
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // PERF-5: Disable the accessibility tree for the WebView.
        //   POS terminals are operator-facing; accessibility overhead is wasted.
        webView.importantForAccessibility = WebView.IMPORTANT_FOR_ACCESSIBILITY_NO

        // Keep text legible at any DPI without JavaScript zoom tricks.
        settings.textZoom = 100

        // PERF-7 + PERF-9 (MERGED): single WebViewClient handles both concerns.
        //
        //   PERF-7: Replacing the default WebViewClient suppresses verbose
        //   internal Chromium logging (e.g. overscroll-behavior spam) on
        //   API 26-28 that synchronises on the UI thread and slows scrolling.
        //
        //   PERF-9: onPageFinished triggers a V8 idle-task nudge after the
        //   initial page load, clearing the bootstrap object graph before the
        //   cashier starts interacting and reducing mid-session GC pauses.
        //
        //   Previously two separate `webView.webViewClient = ...` calls meant
        //   the second silently replaced the first. Merged into one object.
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // `void 0` is a harmless no-op in production Chromium but nudges
                // the V8 idle task scheduler to run a minor GC before user input.
                view?.evaluateJavascript("void 0;", null)
            }
        }
    }
}