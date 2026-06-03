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

  // Keep the splash screen until the app signals it's ready
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },

  // When running `npx cap run android` on a device, point to your Cloudflare Worker URL.
  // During development with a local backend you can also use your PC's LAN IP:
  //   server: { url: 'http://192.168.x.x:5173', cleartext: true }
  // For production builds, leave `server` out — the bundled dist/ is used.
  //
  // server: {
  //   url: 'https://your-worker.workers.dev',
  //   cleartext: false,
  // },
};

export default config;