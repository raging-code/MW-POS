// capacitor.config.ts
// Place this file in the ROOT of your MW-POS project (same level as package.json).

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Must match the applicationId in android/app/build.gradle
  appId: 'com.mwpos.app',

  // Displayed as the app name on the Android home screen
  appName: 'MW POS',

  // Vite builds into the "dist" folder — Capacitor copies it into the Android webview
  webDir: 'dist',

  plugins: {
    SplashScreen: {
      // Hide splash screen immediately once the WebView is ready
      launchShowDuration: 0,
      // Prevents white flash between splash and app on slow devices
      launchAutoHide: true,

      // FIX: Was #111827 (near-black). The app's actual background is
      // #F0EDE8 (CSS var(--surface-page), warm beige). A mismatched
      // backgroundColor causes a visible colour flash as the splash
      // fades out and the WebView's first paint comes in.
      // Setting both to the same value makes the transition invisible.
      backgroundColor: '#F0EDE8',

      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },

  android: {
    // ── WebView performance flags ──────────────────────────────────────────
    // Use the system Chromium WebView (updated via Play Store) instead of the
    // slower built-in fallback on older Android versions.
    // This gives hardware-accelerated CSS compositing on API 24+.

    // Allow mixed HTTP/HTTPS only during local LAN dev; prod builds serve
    // everything from the bundled dist/ so this is harmless there too.
    allowMixedContent: true,

    // Capture keyboard events inside the WebView (needed for barcode scanners
    // that act as HID keyboards and for numeric PIN entry).
    captureInput: true,

    // Disable WebView debugging in production builds for a tiny perf boost and
    // to prevent remote-debug access on end-user devices.
    // Set to true during development: npx cap run android --flavor debug
    webContentsDebuggingEnabled: false,

    // ── Viewport / touch ─────────────────────────────────────────────────
    // Already set in index.html but repeating here makes it apply even before
    // the HTML is parsed, eliminating the double-render on first paint.
    // initialFocus: false keeps the soft keyboard from auto-opening on load.
    initialFocus: false,
  },

  // ── Dev server (local network development only) ───────────────────────────
  // Uncomment and set your PC's LAN IP when running `npx cap run android`
  // so the device loads the Vite dev server instead of a stale dist/.
  //
  // server: {
  //   url: 'http://192.168.x.x:5173',
  //   cleartext: true,   // needed for plain HTTP on LAN
  // },
};

export default config;