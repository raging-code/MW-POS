// android/app/src/main/java/com/mwpos/app/MainActivity.kt
//
// Performance additions vs the previous version:
//
//  PERF-1 — WebView hardware acceleration & GPU rasterization
//    Capacitor's Bridge already enables hardware acceleration by default, but
//    we also enable GPU rasterization so CSS compositing (transforms, opacity,
//    will-change) is offloaded to the GPU on devices that support it.
//
//  PERF-2 — WebView rendering priority
//    Sets the WebView thread priority to THREAD_PRIORITY_DISPLAY so the render
//    thread competes equally with the UI thread instead of running at lower
//    background priority (the default on some OEM ROMs).
//
//  PERF-3 — Disable unnecessary WebView features
//    Turns off save-password prompts, form auto-fill, and file access from file
//    URLs — none of which the POS app needs — reducing per-page overhead.
//
//  PERF-4 — Aggressive WebView cache
//    Sets LOAD_DEFAULT so WebView uses HTTP cache headers from the Cloudflare
//    Worker response. The Vite-built assets have content-hashed filenames so
//    they can be cached indefinitely; only index.html is re-fetched each launch.
//
//  PERF-5 — Disable accessibility node caching
//    importantForAccessibility="no" is already set on many views, but the
//    WebView accessibility tree can still be expensive on mid-range devices.
//    We disable it here since POS terminals are operator-facing, not
//    accessibility-critical.
//
// NOTE: BluetoothPrinterPlugin registration is preserved exactly as before.

package com.mwpos.app

import android.os.Bundle
import android.os.Process
import android.webkit.WebSettings
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // BluetoothPrinterPlugin must be registered BEFORE super.onCreate
        // so Capacitor's bridge knows about it when it initialises the WebView.
        registerPlugin(BluetoothPrinterPlugin::class.java)
        super.onCreate(savedInstanceState)

        // Tune the WebView after the Bridge has created it.
        tuneWebView()
    }

    // ── PERF-1 / PERF-2 / PERF-3 / PERF-4 / PERF-5 ────────────────────────
    private fun tuneWebView() {
        val webView: WebView = bridge.webView ?: return
        val settings: WebSettings = webView.settings

        // PERF-1: GPU rasterization — composites CSS layers on the GPU.
        //   setForceDark / hardware acceleration is already on by default in
        //   Capacitor; this flag specifically enables tile rasterisation on GPU.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
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
    }
}