/**
 * useSession.js
 * ─────────────
 * Manages session state across the app.
 *
 * Two session types:
 * ─────────────────
 * 1. Google OAuth: { token, expiresAt, profile, isGuest: false }
 *    Data lives in user's Google Drive. Persisted in sessionStorage so it
 *    survives page reloads but not browser restarts (tokens are ~1h anyway).
 *
 * 2. Guest:        { token: null, expiresAt: null, profile: null, isGuest: true }
 *    Data lives in sessionStorage only under 'mnemo_guest_vault'.
 *    Automatically lost when the tab is closed — the user is told this upfront.
 */

import { useState, useCallback, useEffect } from 'react'

const SESSION_KEY = 'mnemo_session'

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    // Guest sessions never expire
    if (s.isGuest) return s
    // Auth sessions: treat as expired if < 60s remain
    if (s.expiresAt && Date.now() > s.expiresAt - 60_000) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return s
  } catch {
    return null
  }
}

function saveSession(session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    console.warn('[Mnemo] Could not persist session to sessionStorage')
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch { /* ignore */ }
}

/**
 * useSession()
 * Returns { session, login, loginAsGuest, logout }
 *
 * session        — null when logged out
 * login(s)       — save a Google OAuth session
 * loginAsGuest() — start a no-auth guest session
 * logout()       — clear session and guest vault
 */
export function useSession() {
  const [session, setSession] = useState(() => readSession())

  // Auto-expire OAuth tokens while tab is open
  useEffect(() => {
    if (!session || session.isGuest || !session.expiresAt) return
    const msLeft = session.expiresAt - Date.now() - 60_000
    if (msLeft <= 0) { setSession(null); clearSession(); return }
    const timer = setTimeout(() => { setSession(null); clearSession() }, msLeft)
    return () => clearTimeout(timer)
  }, [session?.expiresAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback((newSession) => {
    const s = { ...newSession, isGuest: false }
    saveSession(s)
    setSession(s)
  }, [])

  const loginAsGuest = useCallback(() => {
    const s = { token: null, expiresAt: null, profile: null, isGuest: true }
    saveSession(s)
    setSession(s)
  }, [])

  const logout = useCallback(() => {
    clearSession()
    // Also wipe any guest vault data
    try { sessionStorage.removeItem('mnemo_guest_vault') } catch { /* ignore */ }
    setSession(null)
  }, [])

  return { session, login, loginAsGuest, logout }
}
