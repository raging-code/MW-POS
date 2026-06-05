import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react({
      // Use SWC-based fast refresh (already in @vitejs/plugin-react >= 4)
      babel: {
        plugins: [
          // Prune unused dead code in prod
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split vendor chunks for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          'react-core':    ['react', 'react-dom'],
          'query':         ['@tanstack/react-query'],
          'icons':         ['lucide-react'],
          'utils':         ['clsx', 'date-fns', 'zustand'],
        },
      },
    },
    // Raise chunk size warning limit (large app)
    chunkSizeWarningLimit: 700,
    // Enable minification optimisations
    minify: 'esbuild',
    target: 'es2020',
    // CSS code splitting
    cssCodeSplit: true,
  },
  // Aggressive dependency pre-bundling
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-dom/client',
      '@tanstack/react-query',
      'lucide-react',
      'clsx',
      'date-fns',
      'zustand',
    ],
  },
})