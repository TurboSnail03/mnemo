import { useState, useEffect } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import { motion } from 'framer-motion'
import './Login.css'

/**
 * Login.jsx
 * ─────────
 * Renders the full-screen login page.
 * On successful Google OAuth, calls onLogin(session) where session = { token, profile }.
 * The parent (App.jsx) is responsible for persisting the session.
 *
 * OAuth scopes requested:
 *   • openid + profile + email  →  to read the user's name/avatar
 *   • drive.appdata             →  to read/write mnemo_vault.json (hidden app folder)
 *   • drive.readonly            →  to read 'Play Books Notes' folder for sync
 */
export default function Login({ onLogin, onGuestLogin }) {
  const [status, setStatus]   = useState('idle')  // 'idle' | 'loading' | 'error'
  const [errorMsg, setError]  = useState('')

  // Compute moon phase for the decorative moon on the login card
  const [moonPhase, setMoonPhase] = useState('phase-waxing-crescent')

  useEffect(() => {
    const LP      = 2551442.8
    const REF_NEW = 947182440
    const phase   = ((Date.now() / 1000 - REF_NEW) % LP + LP) % LP / LP
    if (phase < 0.0337 || phase > 0.9663)      setMoonPhase('phase-new-moon')
    else if (phase < 0.2163)                   setMoonPhase('phase-waxing-crescent')
    else if (phase < 0.2837)                   setMoonPhase('phase-first-quarter')
    else if (phase < 0.4663)                   setMoonPhase('phase-waxing-gibbous')
    else if (phase < 0.5337)                   setMoonPhase('phase-full-moon')
    else if (phase < 0.7163)                   setMoonPhase('phase-waning-gibbous')
    else if (phase < 0.7837)                   setMoonPhase('phase-last-quarter')
    else                                       setMoonPhase('phase-waning-crescent')
  }, [])

  const login = useGoogleLogin({
    // ── Scopes ────────────────────────────────────────────────────────────
    // drive.appdata  → mnemo_vault.json lives here (invisible to user)
    // drive.readonly → read Play Books Notes folder for highlight sync
    scope: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/drive.appdata',
      'https://www.googleapis.com/auth/drive.readonly',
    ].join(' '),

    onSuccess: async (tokenResponse) => {
      setStatus('loading')
      try {
        // Fetch the user's profile so we can show their name/avatar
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        })
        if (!profileRes.ok) throw new Error('Failed to fetch Google profile')
        const profile = await profileRes.json()

        onLogin({
          token:      tokenResponse.access_token,
          // Google tokens expire in 3600s; record when so App can warn
          expiresAt:  Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
          profile: {
            name:    profile.name,
            email:   profile.email,
            picture: profile.picture,
          },
        })
      } catch (err) {
        console.error('[Mnemo] Login error:', err)
        setError('Could not fetch your Google profile. Please try again.')
        setStatus('error')
      }
    },

    onError: (err) => {
      console.error('[Mnemo] OAuth error:', err)
      // User closing the popup is not an error worth showing
      if (err.error !== 'popup_closed_by_user') {
        setError('Sign-in failed. Please allow pop-ups for this site and try again.')
        setStatus('error')
      } else {
        setStatus('idle')
      }
    },
  })

  const handleSignIn = () => {
    setStatus('loading')
    setError('')
    login()
  }

  return (
    <div className="login-root">
      {/* ── Atmosphere ─────────────────────────────────────────────────── */}
      <div className="login-sky" aria-hidden="true" />
      <div className={`login-moon ${moonPhase}`} aria-hidden="true" />

      {/* ── Card ───────────────────────────────────────────────────────── */}
      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0,  filter: 'blur(0px)' }}
        transition={{ duration: 1.0, ease: [0.25, 0.1, 0.25, 1] }}
        role="main"
        aria-label="Mnemo login"
      >
        <h1 className="login-logo">Mnemo</h1>
        <p className="login-tagline">a sanctuary for your book highlights</p>
        <div className="login-divider" aria-hidden="true" />

        <p className="login-body">
          Your highlights are stored in a private folder in{' '}
          <strong>your own Google Drive</strong> — Mnemo never touches any
          other files, and your data leaves with you.
        </p>

        {/* ── Google Sign-In Button ─────────────────────────────────── */}
        <button
          className="login-google-btn"
          onClick={handleSignIn}
          disabled={status === 'loading'}
          aria-busy={status === 'loading'}
        >
          {/* Official Google "G" logo SVG */}
          <svg className="login-google-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          {status === 'loading' ? 'Signing in…' : 'Continue with Google'}
        </button>

        {/* ── Status feedback ───────────────────────────────────────── */}
        {status === 'loading' && (
          <div className="login-loading" role="status" aria-live="polite">
            <div className="login-spinner" aria-hidden="true" />
            <span>Opening the vault…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="login-error" role="alert">
            {errorMsg}
          </div>
        )}

        {/* ── Guest option ─────────────────────────────────────────── */}
        <div className="login-guest-divider">
          <span>or</span>
        </div>

        <button
          className="login-guest-btn"
          onClick={onGuestLogin}
          disabled={status === 'loading'}
        >
          Continue without signing in
        </button>

        <p className="login-guest-warning">
          Guest data is stored in your browser only and is{' '}
          <strong>permanently deleted</strong> when you close this tab.
        </p>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div className="login-footer">
          By signing in you grant Mnemo read/write access to a hidden
          <em> App Data</em> folder in your Google Drive only.
          No other files are accessed.{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            Manage permissions
          </a>
        </div>
      </motion.div>
    </div>
  )
}
