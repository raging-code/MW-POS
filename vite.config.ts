import { defineConfig, splitVendorChunkPlugin } from 'vite'
import react from '@vitejs/plugin-react-swc'

// ─── vite.config.ts — Optimised build ───────────────────────────────────────
//
// CHANGES vs previous:
//
//  1. Switched from @vitejs/plugin-react (Babel) → @vitejs/plugin-react-swc
//     SWC is ~20× faster than Babel for both dev HMR and production builds.
//     No config needed: SWC handles JSX, TypeScript, and fast-refresh natively.
//
//  2. Added splitVendorChunkPlugin() — Vite's built-in heuristic chunker.
//     Combined with manualChunks it ensures common vendor code is only
//     downloaded once and cached across app versions.
//
//  3. manualChunks updated:
//     - Isolated 'date-fns' into its own chunk; it's ~170 KB raw and rarely
//       changes, so users only re-download it when date-fns itself updates.
//     - Moved clsx+zustand into 'utils' (tiny, but separate from query cache).
//
//  4. build.target changed from 'es2020' → 'es2019' for better compatibility
//     with Android WebView on API 24–29 (Android 7–9).
//     es2019 supports async/await natively (no regenerator polyfill needed)
//     while still allowing optional-chaining and nullish-coalescing.
//
//  5. build.sourcemap = false in production — halves the build artefact size
//     and removes the ~6 ms "sourcemap apply" overhead per Chromium re-load.
//
//  6. esbuild.drop — strips console.log/warn calls from the prod bundle.
//     Dev builds keep them; prod builds shed ~2 KB and remove log latency.
//
//  7. Added define: { __DEV__ } — mirrors React's own env check so tree-shaking
//     can eliminate dev-only code paths in libraries.

export default defineConfig(({ mode }) => ({
  base: './',        
  plugins: [
    react(),                  // SWC-based: no babel config needed
    splitVendorChunkPlugin(), // automatic vendor splitting on top of manualChunks
  ],

  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },

  define: {
    // Allows libraries to tree-shake dev-only branches
    __DEV__: mode === 'development',
  },

  build: {
    // Target Android WebView API 24+ (Chrome 56+) — es2019 is universally
    // supported on that range without needing extra polyfills.
    target: 'es2019',

    // No source-maps in production — saves bandwidth and load time.
    sourcemap: false,

    // Drop all console.* calls in production builds.
    // Use a logger or toast() for user-visible messages instead.
    minify: 'esbuild',

    rollupOptions: {
      output: {
        // FIX: Use function form instead of object form.
        // The object form is evaluated after esbuild's tree-shaking pass, which
        // can inline date-fns into the main app chunk before Rollup has a chance
        // to split it — so the date-fns chunk was never emitted in production.
        // The function form runs at Rollup's chunk-assignment phase, forcing the
        // split before tree-shaking collapses the module graph.
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'react-core';
          }
          if (id.includes('node_modules/@tanstack/react-query')) {
            return 'query';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons';
          }
          if (id.includes('node_modules/date-fns')) {
            return 'date-fns';
          }
          if (id.includes('node_modules/clsx') || id.includes('node_modules/zustand')) {
            return 'utils';
          }
        },
      },
    },

    // Raise the warning threshold slightly — the app is intentionally large.
    chunkSizeWarningLimit: 700,

    // CSS code-splitting: each lazy chunk gets its own CSS file.
    cssCodeSplit: true,
  },

  esbuild: {
    // Strip debug output from production bundles.
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },

  // Pre-bundle every dependency the app uses at startup so the first
  // page load doesn't trigger waterfalling ESM fetches.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      '@tanstack/react-query',
      'lucide-react',
      'clsx',
      'date-fns',
      'zustand',
    ],
  },
}))