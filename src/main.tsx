import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Menu data stays fresh for 2 min – reduces re-fetches while tapping items
      staleTime: 2 * 60_000,
      // Keep old data on screen for up to 5 min while re-fetching in background
      gcTime: 5 * 60_000,
      // Don't refetch just because the window regained focus (common on mobile)
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})

// Remove StrictMode in production so components only mount once
// (StrictMode double-mounts every component in dev which appears laggy)
const root = ReactDOM.createRoot(document.getElementById('root')!)

if (import.meta.env.DEV) {
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  )
} else {
  root.render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  )
}