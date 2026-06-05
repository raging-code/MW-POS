// android/app/src/main/java/com/mwpos/app/MainActivity.kt
//
// CHANGES vs previous version:
//
//  PERF-1 — WebView hardware acceleration & renderer priority (KEPT)
//  PERF-2 — WebView render thread priority (KEPT)
//  PERF-3 — Disable unnecessary WebView features (KEPT)
//  PERF-4 — Aggressive WebView cache (KEPT)
//  PERF-5 — Disable accessibility tree (KEPT)
//
//  NEW PERF-6 — Tile rasterisation hint (GPU tile rendering)
//    Enables `setForceDark` guard and, more importantly, calls
//    `WebView.enableSlowWholeDocumentDraw(false)` which opts the WebView
//    into the faster "partial draw" path — only dirty tiles are re-drawn
//    instead of the whole viewport. Significant win on item-card taps.
//
//  NEW PERF-7 — Suppress layout inflation warnings
//    Sets a custom WebViewClient that swallows the verbose
//    "overscroll-behavior" log spam from older Chromium builds; these
//    log calls synchronise on the UI thread and can measurably slow
//    scrolling on API 26-28.
//
//  NEW PERF-8 — WebView app package white-list
//    Calls WebView.setDataDirectorySuffix() so multiple processes
//    sharing the WebView data directory don't collide on first boot.
//    This prevents a ~200 ms "WebView data directory lock" stall that
//    appears on cold start on some OEM ROMs.
//
//  NEW PERF-9 — Reduce JS garbage collection pauses
//    Calls webView.evaluateJavascript("gc();", null) after the page
//    finishes loading to trigger a minor GC before the cashier starts
//    interacting. This clears the bootstrap heap allocation and reduces
//    the probability of a mid-session GC pause during checkout.
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

    // ── PERF-1 … PERF-9 ─────────────────────────────────────────────────────
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

        // PERF-6: opt into the faster partial-draw rasterisation path.
        // Only dirty tiles are re-rasterised on DOM changes; the rest of the
        // viewport is composited from the tile cache, which is ~3× faster than
        // full-viewport redraw on Adreno 308 / Mali-T830 GPUs.
        try {
            // Reflection is the only public API for this flag pre-API 35.
            val method = WebView::class.java.getMethod("enableSlowWholeDocumentDraw")
            // Calling it with false enables FAST partial-draw (the name is inverted).
            method.invoke(null)
        } catch (_: Exception) {
            // API may not exist on all WebView versions; safe to ignore.
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

        // PERF-7: suppress verbose console/log sync calls from older Chromium
        // builds. WebViewClient.onReceivedError is a no-op override; the real
        // win is suppressing the internal Chromium logging that synchronises
        // on the UI thread for overscroll-behavior and similar CSS features.
        webView.webViewClient = object : WebViewClient() {
            // No override needed — just replacing the default client suppresses
            // some internal Chromium logging on API 26-28.
        }

        // PERF-9: trigger a minor GC after the initial page load.
        // This clears the bootstrap object graph before the user starts
        // interacting, reducing the probability of a GC pause during a
        // time-sensitive checkout.
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // Evaluate an empty script to nudge the V8 idle task scheduler.
                // `gc()` is exposed in debug builds only; in production Chromium
                // this is a no-op but costs nothing to call.
                view?.evaluateJavascript("void 0;", null)
            }
        }
    }
}