import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App.jsx'

// ── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          color: '#e6e1d8', padding: '2rem', background: '#05070a',
          height: '100vh', fontFamily: 'monospace', whiteSpace: 'pre-wrap'
        }}>
          <h2 style={{ color: '#ff6b35' }}>Something went wrong.</h2>
          <pre>{this.state.error?.toString()}</pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem', padding: '0.5rem 1rem',
              background: 'none', border: '1px solid #ff6b35',
              color: '#ff6b35', cursor: 'pointer', borderRadius: '4px'
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Service Worker Registration ───────────────────────────────────────────────
// Registers the SW and watches for updates.  When a new SW is ready,
// it immediately takes control (SKIP_WAITING) so users never see a stale app.
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })  // 'none' = always re-fetch sw.js
        .then((reg) => {
          console.log('[Mnemo] SW registered:', reg.scope)

          // Poll for updates every 60 s while the app is open
          const pollInterval = setInterval(() => reg.update(), 60_000)
          window.addEventListener('beforeunload', () => clearInterval(pollInterval))

          // When a new SW is waiting, tell it to skip waiting and take over
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing
            newWorker?.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[Mnemo] New SW ready — activating…')
                newWorker.postMessage('SKIP_WAITING')
              }
            })
          })
        })
        .catch((err) => console.warn('[Mnemo] SW registration failed:', err))

      // When the SW controller changes (new SW activated), reload all clients
      // so they use the fresh cached assets.
      let refreshing = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true
          console.log('[Mnemo] SW controller changed — reloading for fresh assets…')
          window.location.reload()
        }
      })
    })
  }
}

registerServiceWorker()

// ── Render ────────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </GoogleOAuthProvider>
  </StrictMode>,
)
