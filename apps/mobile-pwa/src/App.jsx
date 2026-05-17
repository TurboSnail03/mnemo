import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSession } from './useSession.js'
import Login from './Login.jsx'
import './App.css'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
const GUEST_VAULT_KEY = 'mnemo_guest_vault'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function authFetch(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  })
}

// Guest vault — reads/writes to sessionStorage
function loadGuestVault() {
  try {
    const raw = sessionStorage.getItem(GUEST_VAULT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveGuestVault(items) {
  try { sessionStorage.setItem(GUEST_VAULT_KEY, JSON.stringify(items)) } catch { /* ignore */ }
}

function guestFingerprint(title, content) {
  // Simple but sufficient for guest mode (no SHA-256needed client-side)
  return btoa(encodeURIComponent(`${title}::${content}`)).slice(0, 40)
}

// ─── SyncDriveButton — only shown for auth users ──────────────────────────────
function SyncDriveButton({ token, onSyncStart, onSyncDone }) {
  const handleSync = async () => {
    onSyncStart()
    try {
      const res  = await authFetch(`${API}/sync/drive`, token, { method: 'POST' })
      const data = await res.json()
      onSyncDone(data)
    } catch (err) {
      console.error('[Mnemo] Drive sync failed:', err)
      onSyncDone({ error: true })
    }
  }
  return (
    <button className="sync-drive-btn" onClick={handleSync} title="Sync Google Play Books">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2v6M12 16v6M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M16 12h6M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24"/>
      </svg>
      Sync Drive
    </button>
  )
}

// ─── Token expiry banner ──────────────────────────────────────────────────────
function TokenExpiryBanner({ onRelogin }) {
  return (
    <motion.div className="token-expiry-banner" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} role="alert">
      Your session has expired.{' '}
      <button className="relogin-btn" onClick={onRelogin}>Sign in again</button>
    </motion.div>
  )
}

// ─── Guest banner ─────────────────────────────────────────────────────────────
function GuestBanner({ onSignIn }) {
  return (
    <div className="guest-banner" role="status">
      <span className="guest-banner-text">
        👻 Guest mode — highlights live in this tab only and are{' '}
        <strong>deleted when you close it</strong>
      </span>
      <button className="guest-sign-in-btn" onClick={onSignIn}>
        Save to Google Drive →
      </button>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ session, onLogout }) {
  const isGuest        = session.isGuest
  const token          = session.token
  const profile        = session.profile

  const [highlights, setHighlights]         = useState([])
  const [loading, setLoading]               = useState(true)
  const [fetchError, setFetchError]         = useState(false)
  const [selectedSource, setSelectedSource] = useState(null)
  const [tokenExpired, setTokenExpired]     = useState(false)
  const [moonPhase, setMoonPhase]           = useState('phase-full-moon')

  // Modals / interaction state
  const [confirmingId, setConfirmingId]       = useState(null)
  const [burningId, setBurningId]             = useState(null)
  const [isSearchOpen, setIsSearchOpen]       = useState(false)
  const [searchQuery, setSearchQuery]         = useState('')
  const searchInputRef                        = useRef(null)
  const [smoldering, setSmoldering]           = useState([])
  const [editingId, setEditingId]             = useState(null)
  const [editText, setEditText]               = useState('')
  const [isEditingTitle, setIsEditingTitle]   = useState(false)
  const [editTitleText, setEditTitleText]     = useState('')
  const [isSummonOpen, setIsSummonOpen]       = useState(false)
  const [newThoughtContent, setNewThoughtContent] = useState('')
  const [newThoughtSource, setNewThoughtSource]   = useState('')
  const [syncStatus, setSyncStatus]           = useState(null)
  const [uploadStatus, setUploadStatus]       = useState(null)
  const kindleInputRef                        = useRef(null)

  // Burn source modal
  const [burnSourceConfirm, setBurnSourceConfirm] = useState(false)

  // Nuke vault modal (delete everything)
  const [nukeConfirmOpen, setNukeConfirmOpen] = useState(false)
  const [nukeInput, setNukeInput]             = useState('')
  const [nukeStatus, setNukeStatus]           = useState('idle') // 'idle'|'loading'|'done'
  const nukeInputRef                          = useRef(null)

  // User menu — click-toggled so "Sign out" is reachable without hover
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef                 = useRef(null)

  // ── Guest helpers ─────────────────────────────────────────────────────────
  const persistGuest = useCallback((items) => {
    setHighlights(items)
    saveGuestVault(items)
  }, [])

  // ── Authenticated fetch wrapper ───────────────────────────────────────────
  const handle401 = () => setTokenExpired(true)

  const apiFetch = useCallback(async (path, options = {}) => {
    const res = await authFetch(`${API}${path}`, token, options)
    if (res.status === 401) { handle401(); throw new Error('401') }
    return res
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Moon phase ────────────────────────────────────────────────────────────
  useEffect(() => {
    const compute = () => {
      const LP = 2551442.8, REF = 947182440
      const p  = ((Date.now() / 1000 - REF) % LP + LP) % LP / LP
      if (p < 0.0337 || p > 0.9663) return 'phase-new-moon'
      if (p < 0.2163) return 'phase-waxing-crescent'
      if (p < 0.2837) return 'phase-first-quarter'
      if (p < 0.4663) return 'phase-waxing-gibbous'
      if (p < 0.5337) return 'phase-full-moon'
      if (p < 0.7163) return 'phase-waning-gibbous'
      if (p < 0.7837) return 'phase-last-quarter'
      return 'phase-waning-crescent'
    }
    setMoonPhase(compute())
    const id = setInterval(() => setMoonPhase(compute()), 60_000)
    return () => clearInterval(id)
  }, [])

  // ── Fetch / load highlights ───────────────────────────────────────────────
  const fetchHighlights = useCallback(async () => {
    setFetchError(false)
    if (isGuest) {
      setHighlights(loadGuestVault())
      setLoading(false)
      return
    }
    try {
      const res  = await apiFetch('/highlights/')
      const data = await res.json()
      setHighlights(Array.isArray(data) ? data : [])
    } catch (err) {
      if (err.message !== '401') setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [isGuest, apiFetch])

  useEffect(() => { fetchHighlights() }, [fetchHighlights])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setIsSearchOpen(p => !p) }
      if (e.key === 'Escape') {
        setIsSearchOpen(false); setIsSummonOpen(false)
        setEditingId(null); setIsEditingTitle(false)
        setBurnSourceConfirm(false); setNukeConfirmOpen(false); setMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (isSearchOpen) searchInputRef.current?.focus() }, [isSearchOpen])

  // Close user menu when clicking outside it
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])
  useEffect(() => { if (nukeConfirmOpen) setTimeout(() => nukeInputRef.current?.focus(), 50) }, [nukeConfirmOpen])

  // ── Delete (burn single) ──────────────────────────────────────────────────
  const igniteThought = (item) => {
    setConfirmingId(null)
    setBurningId(item.id)
    setTimeout(() => {
      setHighlights(prev => prev.filter(h => h.id !== item.id))
      setBurningId(null)
      if (isGuest) {
        saveGuestVault(highlights.filter(h => h.id !== item.id))
        return
      }
      const fuseId = setTimeout(async () => {
        try {
          await apiFetch(`/highlights/${item.id}`, { method: 'DELETE' })
          setSmoldering(prev => prev.filter(s => s.id !== item.id))
        } catch { /* already removed from UI */ }
      }, 15000)
      setSmoldering(prev => [...prev, { ...item, fuseId }])
    }, 2500)
  }

  const breatheLife = (ash) => {
    clearTimeout(ash.fuseId)
    setSmoldering(prev => prev.filter(s => s.id !== ash.id))
    // eslint-disable-next-line no-unused-vars
    const { fuseId, ...highlight } = ash
    setHighlights(prev => [highlight, ...prev])
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  const startEditing = (item) => { setEditingId(item.id); setEditText(item.content) }

  const saveEdit = async (id) => {
    const updated = highlights.map(h => h.id === id ? { ...h, content: editText } : h)
    setHighlights(updated)
    setEditingId(null)
    if (isGuest) { saveGuestVault(updated); return }
    try {
      await apiFetch(`/highlights/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText }),
      })
    } catch { /* 401 handled */ }
  }

  // ── Source rename ─────────────────────────────────────────────────────────
  const startEditingTitle = () => { setEditTitleText(selectedSource); setIsEditingTitle(true) }

  const saveTitleRename = async () => {
    if (!editTitleText.trim() || editTitleText === selectedSource) { setIsEditingTitle(false); return }
    const newTitle   = normaliseTitle(editTitleText)
    const updated    = highlights.map(h => h.book_title === selectedSource ? { ...h, book_title: newTitle } : h)
    setHighlights(updated)
    setSelectedSource(newTitle)
    setIsEditingTitle(false)
    if (isGuest) { saveGuestVault(updated); return }
    try {
      await apiFetch('/sources/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_title: selectedSource, new_title: editTitleText }),
      })
    } catch { /* 401 handled */ }
  }

  // ── Burn entire source ────────────────────────────────────────────────────
  const handleBurnSource = async () => {
    const updated = highlights.filter(h => h.book_title !== selectedSource)
    setHighlights(updated)
    setSelectedSource(null)
    setBurnSourceConfirm(false)
    if (isGuest) { saveGuestVault(updated); return }
    try {
      await apiFetch(`/sources/${encodeURIComponent(selectedSource)}`, { method: 'DELETE' })
    } catch { /* 401 handled */ }
  }

  // ── Nuke vault (delete everything) ───────────────────────────────────────
  const handleNukeVault = async () => {
    if (nukeInput.trim() !== 'CONFIRM') return
    setNukeStatus('loading')
    if (isGuest) {
      saveGuestVault([])
      setHighlights([])
      setNukeStatus('done')
      setTimeout(() => { setNukeConfirmOpen(false); setNukeInput(''); setNukeStatus('idle') }, 1200)
      return
    }
    try {
      await apiFetch('/highlights/', { method: 'DELETE' })
      setHighlights([])
      setNukeStatus('done')
      setTimeout(() => { setNukeConfirmOpen(false); setNukeInput(''); setNukeStatus('idle') }, 1200)
    } catch { setNukeStatus('idle') }
  }

  // ── Manual summon ─────────────────────────────────────────────────────────
  const handleSummon = async () => {
    if (!newThoughtContent.trim()) return
    const src   = newThoughtSource.trim() || (selectedSource ?? 'Stray Thoughts')
    const title = normaliseTitle(src)
    if (isGuest) {
      const item = {
        id:         guestFingerprint(title, newThoughtContent),
        book_title: title,
        author:     'Unknown',
        content:    newThoughtContent,
        added_on:   new Date().toLocaleString(),
        source:     'manual',
      }
      const updated = [item, ...highlights]
      persistGuest(updated)
      setIsSummonOpen(false); setNewThoughtContent(''); setNewThoughtSource('')
      return
    }
    try {
      const res  = await apiFetch('/highlights/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_title: src, content: newThoughtContent }),
      })
      const item = await res.json()
      setHighlights(prev => [item, ...prev])
      setIsSummonOpen(false); setNewThoughtContent(''); setNewThoughtSource('')
    } catch { /* 401 handled */ }
  }

  // ── Kindle upload ─────────────────────────────────────────────────────────
  const handleKindleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadStatus('uploading')
    if (isGuest) {
      // Parse client-side for guest — send to backend but without auth,
      // so we read the file and push to guest state directly
      const text = await file.text()
      const items = parseKindleClient(text)
      const merged = mergeGuest(highlights, items)
      persistGuest(merged)
      setUploadStatus({ added: merged.length - highlights.length })
      e.target.value = ''
      setTimeout(() => setUploadStatus(null), 5000)
      return
    }
    const form = new FormData()
    form.append('file', file)
    try {
      const res  = await apiFetch('/upload/clippings', { method: 'POST', body: form })
      const data = await res.json()
      setUploadStatus(data)
      if (!data.error) fetchHighlights()
    } catch (err) {
      if (err.message !== '401') setUploadStatus({ error: true })
    }
    e.target.value = ''
    setTimeout(() => setUploadStatus(null), 5000)
  }

  // ── Drive sync callbacks ──────────────────────────────────────────────────
  const handleSyncStart = () => setSyncStatus('syncing')
  const handleSyncDone  = (data) => {
    setSyncStatus(data)
    if (!data.error) fetchHighlights()
    setTimeout(() => setSyncStatus(null), 5000)
  }

  // ── Data prep ─────────────────────────────────────────────────────────────
  const baseHighlights = selectedSource
    ? highlights.filter(h => h.book_title === selectedSource)
    : highlights

  const filteredHighlights = searchQuery.trim()
    ? baseHighlights.filter(h =>
        h.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (h.book_title || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : baseHighlights

  const matchedSources = [...new Set(filteredHighlights.map(h => h.book_title).filter(Boolean))].sort()

  const displayedItems = selectedSource
    ? filteredHighlights
    : Object.entries(
        filteredHighlights.reduce((acc, item) => {
          if (!acc[item.book_title]) acc[item.book_title] = []
          acc[item.book_title].push(item)
          return acc
        }, {})
      ).map(([, items]) => ({
        isStack: items.length > 1,
        count:   items.length,
        ...items[0],
      }))

  const itemAnim = {
    hidden: { opacity: 0, y: 15, filter: 'blur(8px)' },
    show:   (i) => ({
      opacity: 1, y: 0, filter: 'blur(0px)',
      transition: { delay: i * 0.07, duration: 0.9, ease: [0.25, 0.1, 0.25, 1] },
    }),
  }

  if (loading) return <div className="loading-state">Lighting the lamps…</div>

  return (
    <>
      {/* Atmosphere */}
      <div className="night-sky" aria-hidden="true" />
      <div className={`moon ${moonPhase}`} aria-hidden="true" />

      {/* Banners */}
      {tokenExpired && <TokenExpiryBanner onRelogin={onLogout} />}
      {isGuest && <GuestBanner onSignIn={onLogout} />}

      {/* Upload toast */}
      <AnimatePresence>
        {uploadStatus && (
          <motion.div
            className="sync-toast kindle-toast"
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.35 }} role="status"
          >
            {uploadStatus === 'uploading'
              ? '📖 Reading your Kindle clippings…'
              : uploadStatus.error
                ? '✕ Upload failed. Is it a My Clippings.txt file?'
                : `✓ Forged ${uploadStatus.added} new thought${uploadStatus.added !== 1 ? 's' : ''} from Kindle.`}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Undo tray */}
      <div className="ash-tray" role="status" aria-live="polite">
        <AnimatePresence>
          {smoldering.map(ash => (
            <motion.div
              key={`ash-${ash.id}`}
              initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.9, filter: 'blur(5px)' }} transition={{ duration: 0.4 }}
              className="ember-toast"
            >
              <div className="ember-text">
                <span className="ember-title">A thought is smoldering…</span>
                <span className="ember-preview">"{ash.content.substring(0, 40)}…"</span>
                <div className="fuse-bar" />
              </div>
              <button className="resurrect-btn" onClick={() => breatheLife(ash)}>Restore</button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Sync toast */}
      <AnimatePresence>
        {syncStatus && (
          <motion.div
            className="sync-toast"
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.35 }} role="status"
          >
            {syncStatus === 'syncing'
              ? '☁ Syncing Play Books from Drive…'
              : syncStatus.error
                ? '✕ Drive sync failed. Check console.'
                : `✓ Synced ${syncStatus.added} new thought${syncStatus.added !== 1 ? 's' : ''} from Drive.`}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="dashboard-container">

        {/* ── MODALS ──────────────────────────────────────────────────── */}

        {/* Nuke vault — type CONFIRM to delete everything */}
        <AnimatePresence>
          {nukeConfirmOpen && (
            <motion.div
              className="spirit-ledger-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setNukeConfirmOpen(false); setNukeInput('') }}
            >
              <motion.div
                className="spirit-ledger-card burn-source-card"
                initial={{ y: 30, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -20, opacity: 0, scale: 0.95 }}
                onClick={e => e.stopPropagation()}
                role="alertdialog" aria-label="Delete all highlights"
              >
                <div className="burn-source-icon" aria-hidden="true">💀</div>
                <h2 className="burn-source-title">Erase the entire vault?</h2>
                <p className="burn-source-body">
                  Every single highlight across all {highlights.length} entries will be{' '}
                  <strong style={{ color: '#e05c5c' }}>permanently destroyed</strong>.
                  {!isGuest && ' Your Google Drive file will also be wiped.'}
                </p>
                <p className="nuke-confirm-label">
                  Type <strong>CONFIRM</strong> to proceed
                </p>
                <input
                  ref={nukeInputRef}
                  className="nuke-confirm-input"
                  type="text"
                  value={nukeInput}
                  onChange={e => setNukeInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && nukeInput === 'CONFIRM' && handleNukeVault()}
                  placeholder="CONFIRM"
                  autoComplete="off"
                  spellCheck="false"
                />
                <div className="burn-source-actions">
                  <button className="keep-btn" onClick={() => { setNukeConfirmOpen(false); setNukeInput('') }}>
                    Cancel
                  </button>
                  <button
                    className="burn-source-confirm-btn"
                    onClick={handleNukeVault}
                    disabled={nukeInput.trim() !== 'CONFIRM' || nukeStatus === 'loading'}
                  >
                    {nukeStatus === 'loading' ? 'Erasing…' : nukeStatus === 'done' ? '✓ Done' : 'Destroy everything'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Burn source confirmation */}
        <AnimatePresence>
          {burnSourceConfirm && (
            <motion.div
              className="spirit-ledger-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setBurnSourceConfirm(false)}
            >
              <motion.div
                className="spirit-ledger-card burn-source-card"
                initial={{ y: 30, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -20, opacity: 0, scale: 0.95 }}
                onClick={e => e.stopPropagation()}
                role="alertdialog" aria-label="Confirm delete volume"
              >
                <div className="burn-source-icon" aria-hidden="true">🔥</div>
                <h2 className="burn-source-title">Burn this entire volume?</h2>
                <p className="burn-source-body">
                  Every highlight from{' '}
                  <strong className="burn-source-name">"{selectedSource}"</strong>{' '}
                  will be permanently erased. This cannot be undone.
                </p>
                <div className="burn-source-actions">
                  <button className="keep-btn" onClick={() => setBurnSourceConfirm(false)}>Keep the memories</button>
                  <button className="burn-source-confirm-btn" onClick={handleBurnSource}>Burn it all</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Summon modal */}
        <AnimatePresence>
          {isSummonOpen && (
            <motion.div
              className="spirit-ledger-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsSummonOpen(false)}
            >
              <motion.div
                className="spirit-ledger-card"
                initial={{ y: 30, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -20, opacity: 0, scale: 0.95 }}
                onClick={e => e.stopPropagation()}
              >
                <div className="ledger-header">
                  <span className="ledger-title">Summon a New Thought</span>
                  <button className="ledger-close-btn" onClick={() => setIsSummonOpen(false)} aria-label="Close">✕</button>
                </div>
                <div className="summon-form">
                  {!selectedSource && (
                    <input
                      type="text" className="edit-source-input"
                      placeholder="Volume Title (blank → Stray Thoughts)"
                      value={newThoughtSource} onChange={e => setNewThoughtSource(e.target.value)}
                    />
                  )}
                  <textarea
                    className="edit-textarea"
                    placeholder="Write the thought here… (Ctrl+Enter to save)"
                    rows="6" value={newThoughtContent}
                    onChange={e => setNewThoughtContent(e.target.value)}
                    onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSummon() }}
                    autoFocus
                  />
                  <div className="summon-actions">
                    <button className="keep-btn" onClick={() => setIsSummonOpen(false)}>Cancel</button>
                    <button className="summon-save-btn" onClick={handleSummon}>Forge Thought</button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Spirit Ledger (Ctrl+K) */}
        <AnimatePresence>
          {isSearchOpen && (
            <motion.div
              className="spirit-ledger-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsSearchOpen(false)}
            >
              <motion.div
                className="spirit-ledger-card"
                initial={{ y: 30, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -20, opacity: 0, scale: 0.95 }}
                onClick={e => e.stopPropagation()}
                role="dialog" aria-label="Search the Library"
              >
                <div className="ledger-header">
                  <span className="ledger-title">Search the Library</span>
                  <div className="ledger-header-actions">
                    <span className="ledger-shortcut">ESC to dismiss</span>
                    <button className="ledger-close-btn" onClick={() => setIsSearchOpen(false)} aria-label="Close search">✕</button>
                  </div>
                </div>
                {selectedSource && (
                  <div className="ledger-context-badge">
                    Searching within: <strong>{selectedSource}</strong>
                  </div>
                )}
                <input
                  ref={searchInputRef} type="text" className="ledger-input"
                  placeholder="Whisper a word…" value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)} aria-label="Search highlights"
                />
                {searchQuery && matchedSources.length > 0 && !selectedSource && (
                  <div className="ledger-dropdown-list" role="listbox">
                    <span className="dropdown-label">Found in Volumes:</span>
                    {matchedSources.map(source => {
                      const count = filteredHighlights.filter(h => h.book_title === source).length
                      return (
                        <button key={source} className="ledger-dropdown-item" role="option"
                          onClick={() => { setSelectedSource(source); setIsSearchOpen(false); setSearchQuery('') }}>
                          <span className="dropdown-source-name">{source}</span>
                          <span className="dropdown-source-count">{count} fragment{count !== 1 ? 's' : ''}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── HEADER ──────────────────────────────────────────────────── */}
        <header className="header">
          <div className="header-title-row">
            {isEditingTitle && selectedSource ? (
              <div className="title-edit-mode">
                <input
                  type="text" className="edit-source-input h1-style"
                  value={editTitleText} onChange={e => setEditTitleText(e.target.value)}
                  autoFocus onKeyDown={e => e.key === 'Enter' && saveTitleRename()}
                />
                <button className="quill-save-btn" onClick={saveTitleRename}>Save</button>
                <button className="quill-cancel-btn" onClick={() => setIsEditingTitle(false)}>✕</button>
              </div>
            ) : (
              <h1>
                {selectedSource ?? 'Mnemo'}
                {selectedSource && (
                  <>
                    <button className="title-edit-btn" onClick={startEditingTitle} title="Rename Volume" aria-label="Rename volume">✎</button>
                    <button className="title-burn-btn" onClick={() => setBurnSourceConfirm(true)} title="Burn entire volume" aria-label="Delete all highlights from this volume">🔥</button>
                  </>
                )}
              </h1>
            )}

            <div className="header-cta-group">
              <button className="summon-top-btn" onClick={() => setIsSummonOpen(true)} title="Add Thought">+ Add</button>

              <input ref={kindleInputRef} type="file" accept=".txt" style={{ display: 'none' }} onChange={handleKindleUpload} aria-hidden="true" />
              <button
                className="kindle-upload-btn"
                onClick={() => kindleInputRef.current?.click()}
                title="Upload My Clippings.txt from Kindle"
                disabled={uploadStatus === 'uploading'}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Kindle
              </button>

              {/* Drive sync — auth users only */}
              {!isGuest && (
                <SyncDriveButton token={token} onSyncStart={handleSyncStart} onSyncDone={handleSyncDone} />
              )}

              {/* Nuke vault — always available, shown in main library view */}
              {!selectedSource && highlights.length > 0 && (
                <button
                  className="nuke-vault-btn"
                  onClick={() => { setNukeInput(''); setNukeConfirmOpen(true) }}
                  title="Delete all highlights"
                  aria-label="Delete all highlights"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                  Clear all
                </button>
              )}

              {/* User avatar — auth users only */}
              {!isGuest && (
                <div
                  className={`user-menu${menuOpen ? ' open' : ''}`}
                  ref={menuRef}
                >
                  <button
                    className="user-avatar-btn"
                    onClick={() => setMenuOpen(p => !p)}
                    aria-label="Account menu"
                    aria-expanded={menuOpen}
                    aria-haspopup="true"
                  >
                    {profile?.picture
                      ? <img src={profile.picture} alt={profile.name} className="user-avatar" referrerPolicy="no-referrer" />
                      : <div className="user-avatar user-avatar-fallback">{profile?.name?.[0] ?? '?'}</div>
                    }
                  </button>
                  {menuOpen && (
                    <div className="user-dropdown" role="menu">
                      <span className="user-name">{profile?.name}</span>
                      <span className="user-email">{profile?.email}</span>
                      <button
                        className="sign-out-btn"
                        role="menuitem"
                        onClick={() => { setMenuOpen(false); onLogout() }}
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="header-meta">
            {selectedSource ? (
              <button className="back-btn" onClick={() => { setSelectedSource(null); setSearchQuery('') }}>
                ← Back to Library
              </button>
            ) : (
              <span className="library-count">
                The Midnight Library — {highlights.length} thoughts secured.
              </span>
            )}
            <AnimatePresence>
              {searchQuery && (
                <motion.span className="active-filter-badge"
                  initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                  Whisper: "{searchQuery}"
                  <button className="clear-filter-btn" onClick={() => setSearchQuery('')} aria-label="Clear search">✕</button>
                </motion.span>
              )}
            </AnimatePresence>
            {!searchQuery && (
              <span className="keyboard-hint" onClick={() => setIsSearchOpen(true)} role="button" tabIndex={0}>
                <span className="key-box">Ctrl</span> + <span className="key-box">K</span> to search
              </span>
            )}
          </div>
        </header>

        {/* ── EMPTY / ERROR STATES ────────────────────────────────────── */}
        {fetchError && (
          <div className="empty-state" role="alert">
            Could not reach the vault.{' '}
            <button className="back-btn" onClick={fetchHighlights} style={{ marginLeft: '0.5rem' }}>Retry</button>
          </div>
        )}
        {!fetchError && displayedItems.length === 0 && searchQuery && (
          <div className="empty-state" role="status">No thoughts found matching "{searchQuery}".</div>
        )}
        {!fetchError && displayedItems.length === 0 && !searchQuery && (
          <motion.div className="empty-state vault-empty"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
            role="status"
          >
            <p className="empty-state-headline">The vault is empty.</p>
            <p className="empty-state-hint">
              Upload a <strong>My Clippings.txt</strong> from your Kindle,
              {!isGuest && <> sync your Google Play Books,</>} or press <strong>+ Add</strong> to forge a thought manually.
            </p>
          </motion.div>
        )}

        {/* ── MASONRY GRID ────────────────────────────────────────────── */}
        <div className="masonry-grid">
          {displayedItems.map((item, index) => {
            const isBurning = burningId === item.id
            const isEditing = editingId === item.id
            return (
              <motion.article
                key={item.id}
                custom={index}
                initial="hidden" animate="show" variants={itemAnim}
                className={`quote-card ${item.isStack && !selectedSource ? 'tome-stack' : ''} ${isBurning ? 'burning-ash' : ''}`}
                onClick={() => !isBurning && !isEditing && item.isStack && !selectedSource && setSelectedSource(item.book_title)}
              >
                <AnimatePresence>
                  {confirmingId === item.id && !isBurning && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="confirm-overlay">
                      <span>Forget this thought?</span>
                      <div className="confirm-btns">
                        <button className="burn-btn" onClick={e => { e.stopPropagation(); igniteThought(item) }}>Burn</button>
                        <button className="keep-btn" onClick={e => { e.stopPropagation(); setConfirmingId(null) }}>Keep</button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {(!item.isStack || selectedSource) && !isBurning && !isEditing && (
                  <div className="card-actions">
                    <button className="quill-edit-btn" onClick={e => { e.stopPropagation(); startEditing(item) }} title="Edit" aria-label="Edit thought">✎</button>
                    <button className="whisper-delete" onClick={e => { e.stopPropagation(); setConfirmingId(item.id) }} title="Delete" aria-label="Delete thought">✕</button>
                  </div>
                )}

                {isEditing ? (
                  <div className="edit-mode-container" onClick={e => e.stopPropagation()}>
                    <textarea className="edit-textarea" value={editText} onChange={e => setEditText(e.target.value)} rows="6" autoFocus aria-label="Edit thought content" />
                    <div className="edit-actions">
                      <button className="quill-save-btn" onClick={() => saveEdit(item.id)}>Save</button>
                      <button className="quill-cancel-btn" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <blockquote
                    className="quote-content"
                    dangerouslySetInnerHTML={{
                      __html: searchQuery
                        ? `"${escapeHtml(item.content).replace(
                            new RegExp(escapeHtml(searchQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                            m => `<mark class="ink-highlight">${m}</mark>`
                          )}"`
                        : `"${escapeHtml(item.content)}"`,
                    }}
                  />
                )}

                <div className="quote-meta">
                  <span className="book-title">{item.book_title}</span>
                  {item.url && !item.isStack && (
                    <a href={item.url} target="_blank" rel="noreferrer" className="source-link" onClick={e => e.stopPropagation()}>Source</a>
                  )}
                </div>
                {item.isStack && !selectedSource && (
                  <div className="tome-indicator">{item.count} Fragments</div>
                )}
              </motion.article>
            )
          })}
        </div>
      </div>

      {/* Mobile FAB */}
      <button className="mobile-summon-btn" onClick={() => setIsSummonOpen(true)} aria-label="Add new thought">+</button>
    </>
  )
}

// ─── Shared title normaliser (mirrors backend normalize_title) ────────────────
// Ensures sources from different ingestion paths always produce the same key.
// Rules: strip "Notes from", uppercase, drop " - Author", drop parentheticals.
function normaliseTitle(raw) {
  if (!raw) return 'Stray Thoughts'
  let s = raw.trim()
  // Strip Play Books "Notes from \"Title\"" wrapper
  const notesFrom = s.match(/^Notes\s+from\s+["""]?(.+?)["""]?\s*$/i)
  if (notesFrom) s = notesFrom[1].trim()
  // Uppercase for canonical matching
  s = s.toUpperCase()
  // Drop " - AUTHOR" or " BY AUTHOR"
  s = s.split(/\s+-\s+|\s+BY\s+/)[0]
  // Drop parentheticals like "(FRANK HERBERT)"
  s = s.replace(/\([^)]*\)/g, '').trim()
  return s || 'Stray Thoughts'
}

// ─── Client-side Kindle parser (guest mode) ───────────────────────────────────
function parseKindleClient(rawText) {
  const items = []
  const blocks = rawText.split('==========')
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 3) continue
    const [titleLine, metaLine, ...rest] = lines
    if (!metaLine.includes('Highlight')) continue
    const content = rest.join(' ')
    let rawTitle = titleLine, author = 'Unknown'
    if (titleLine.includes('(') && titleLine.endsWith(')')) {
      const idx = titleLine.lastIndexOf('(')
      rawTitle = titleLine.slice(0, idx).trim()
      author   = titleLine.slice(idx + 1, -1).trim()
    }
    const title = normaliseTitle(rawTitle)
    items.push({ id: guestFingerprint(title, content), book_title: title, author, content, added_on: metaLine, source: 'kindle' })
  }
  return items
}

function mergeGuest(existing, incoming) {
  const ids = new Set(existing.map(h => h.id))
  return [...existing, ...incoming.filter(h => !ids.has(h.id))]
}

// ─── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { session, login, loginAsGuest, logout } = useSession()
  if (!session) return <Login onLogin={login} onGuestLogin={loginAsGuest} />
  return <Dashboard session={session} onLogout={logout} />
}
