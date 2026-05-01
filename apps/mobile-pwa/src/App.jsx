import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google'
import './App.css'


const API = 'http://127.0.0.1:8000'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

// ─── Sync Drive Button (needs to be inside GoogleOAuthProvider) ───────────────
function SyncDriveButton({ onSyncStart, onSyncDone }) {
  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    onSuccess: async (tokenResponse) => {
      onSyncStart()
      try {
        const res = await fetch(`${API}/sync/drive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: tokenResponse.access_token }),
        })
        const data = await res.json()
        onSyncDone(data)
      } catch (err) {
        console.error('[Mnemo] Drive sync failed:', err)
        onSyncDone({ error: true })
      }
    },
    onError: (err) => {
      console.error('[Mnemo] OAuth error:', err)
      onSyncDone({ error: true })
    },
  })

  return (
    <button className="sync-drive-btn" onClick={() => login()} title="Sync Google Play Books">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2v6M12 16v6M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M16 12h6M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24"/>
      </svg>
      Sync Drive
    </button>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  const [highlights, setHighlights]     = useState([])
  const [loading, setLoading]           = useState(true)
  const [selectedSource, setSelectedSource] = useState(null)

  // Interaction States
  const [confirmingId, setConfirmingId] = useState(null)
  const [burningId, setBurningId]       = useState(null)
  const [moonPhase, setMoonPhase]       = useState('phase-full-moon')

  // Spirit Ledger (Search)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery]   = useState('')
  const searchInputRef                  = useRef(null)

  // Ash Tray (Undo)
  const [smoldering, setSmoldering] = useState([])

  // Active Vault — Inline Editing
  const [editingId, setEditingId]   = useState(null)
  const [editText, setEditText]     = useState('')

  // Active Vault — Source Renaming
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleText, setEditTitleText]   = useState('')

  // Active Vault — Manual Summon
  const [isSummonOpen, setIsSummonOpen]       = useState(false)
  const [newThoughtContent, setNewThoughtContent] = useState('')
  const [newThoughtSource, setNewThoughtSource]   = useState('')

  // Drive Sync State
  const [syncStatus, setSyncStatus] = useState(null) // null | 'syncing' | {added, error}

  // Kindle Upload State
  const [uploadStatus, setUploadStatus] = useState(null) // null | 'uploading' | {added, error}
  const kindleInputRef = useRef(null)

  // ── 1. Initial Fetch ─────────────────────────────────────────────────────
  const fetchHighlights = () => {
    fetch(`${API}/highlights/`)
      .then(res => res.json())
      .then(data => { setHighlights(data); setLoading(false) })
      .catch(err => { console.error('[Mnemo] Failed to load library', err); setLoading(false) })
  }

  useEffect(() => { fetchHighlights() }, [])

  // ── 2. Mathematical Moon Phase ───────────────────────────────────────────
  useEffect(() => {
    const calculateMoonPhase = () => {
      const now        = new Date()
      const lp         = 2551442.8
      const nowSecs    = now.getTime() / 1000
      const newMoonSecs = 947182440
      const phase      = ((nowSecs - newMoonSecs) % lp) / lp

      if (phase < 0.03 || phase > 0.97) return 'phase-new-moon'
      if (phase < 0.22) return 'phase-waxing-crescent'
      if (phase < 0.28) return 'phase-first-quarter'
      if (phase < 0.47) return 'phase-waxing-gibbous'
      if (phase < 0.53) return 'phase-full-moon'
      if (phase < 0.72) return 'phase-waning-gibbous'
      if (phase < 0.78) return 'phase-last-quarter'
      return 'phase-waning-crescent'
    }
    setMoonPhase(calculateMoonPhase())
  }, [])

  // ── 3. Keyboard Shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setIsSearchOpen(prev => !prev)
      }
      if (e.key === 'Escape') {
        setIsSearchOpen(false)
        setIsSummonOpen(false)
        setEditingId(null)
        setIsEditingTitle(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) searchInputRef.current.focus()
  }, [isSearchOpen])

  // ── 4. Ignite & Restore (Delete) ─────────────────────────────────────────
  const igniteThought = (item) => {
    setConfirmingId(null)
    setBurningId(item.id)

    setTimeout(() => {
      setHighlights(prev => prev.filter(h => h.id !== item.id))
      setBurningId(null)

      const fuseId = setTimeout(async () => {
        try {
          await fetch(`${API}/highlights/${item.id}`, { method: 'DELETE' })
          setSmoldering(prev => prev.filter(s => s.id !== item.id))
        } catch (err) {
          console.error('[Mnemo] Failed to burn thought:', err)
        }
      }, 15000)

      setSmoldering(prev => [...prev, { ...item, fuseId }])
    }, 2500)
  }

  const breatheLife = (ash) => {
    clearTimeout(ash.fuseId)
    setSmoldering(prev => prev.filter(s => s.id !== ash.id))
    setHighlights(prev => [ash, ...prev])
  }

  // ── 5. Active Vault Actions ───────────────────────────────────────────────

  // A. Edit Quote
  const startEditing = (item) => { setEditingId(item.id); setEditText(item.content) }

  const saveEdit = async (id) => {
    try {
      await fetch(`${API}/highlights/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText }),
      })
      setHighlights(prev => prev.map(h => h.id === id ? { ...h, content: editText } : h))
      setEditingId(null)
    } catch (err) {
      console.error('[Mnemo] Failed to save edit:', err)
    }
  }

  // B. Rename Source (bulk-renames all fragments of a volume)
  const startEditingTitle = () => { setEditTitleText(selectedSource); setIsEditingTitle(true) }

  const saveTitleRename = async () => {
    if (!editTitleText.trim() || editTitleText === selectedSource) {
      setIsEditingTitle(false)
      return
    }
    try {
      const res  = await fetch(`${API}/sources/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_title: selectedSource, new_title: editTitleText }),
      })
      const data = await res.json()
      setHighlights(prev =>
        prev.map(h => h.book_title === selectedSource ? { ...h, book_title: data.new_title } : h)
      )
      setSelectedSource(data.new_title)
      setIsEditingTitle(false)
    } catch (err) {
      console.error('[Mnemo] Failed to rename volume:', err)
    }
  }

  // C. Manual Summon (Create)
  const handleSummon = async () => {
    if (!newThoughtContent.trim()) return
    const finalSource = newThoughtSource.trim() || (selectedSource ?? 'Stray Thoughts')

    try {
      const res          = await fetch(`${API}/highlights/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_title: finalSource, content: newThoughtContent }),
      })
      const newHighlight = await res.json()
      setHighlights(prev => [newHighlight, ...prev])
      setIsSummonOpen(false)
      setNewThoughtContent('')
      setNewThoughtSource('')
    } catch (err) {
      console.error('[Mnemo] Failed to summon thought:', err)
    }
  }

  // D. Kindle File Upload
  const handleKindleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadStatus('uploading')
    const form = new FormData()
    form.append('file', file)
    try {
      const res  = await fetch(`${API}/upload/clippings`, { method: 'POST', body: form })
      const data = await res.json()
      setUploadStatus(data)
      if (!data.error) fetchHighlights()
    } catch (err) {
      console.error('[Mnemo] Upload failed:', err)
      setUploadStatus({ error: true })
    }
    // Reset the input so the same file can be re-selected if needed
    e.target.value = ''
    setTimeout(() => setUploadStatus(null), 5000)
  }

  // E. Drive Sync Callbacks
  const handleSyncStart = () => setSyncStatus('syncing')
  const handleSyncDone  = (data) => {
    setSyncStatus(data)
    if (!data.error) fetchHighlights()   // refresh the vault
    setTimeout(() => setSyncStatus(null), 5000)
  }

  // ── Filtering & Data Prep ────────────────────────────────────────────────
  // NOTE: Stacks are grouped exclusively by normalized book_title, per spec.
  const baseHighlights = selectedSource
    ? highlights.filter(h => h.book_title === selectedSource)
    : highlights

  const filteredHighlights = searchQuery.trim()
    ? baseHighlights.filter(h =>
        h.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (h.book_title && h.book_title.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : baseHighlights

  const matchedSources = [...new Set(
    filteredHighlights.map(h => h.book_title).filter(Boolean)
  )].sort()

  const groupedHighlights = filteredHighlights.reduce((acc, item) => {
    if (!acc[item.book_title]) acc[item.book_title] = []
    acc[item.book_title].push(item)
    return acc
  }, {})

  // In library view, show one card per book_title (as a Stack if >1 fragment)
  const displayedItems = selectedSource
    ? filteredHighlights
    : Object.entries(groupedHighlights).map(([title, items]) => ({
        isStack: items.length > 1,
        count:   items.length,
        ...items[0],
      }))

  const itemAnim = {
    hidden: { opacity: 0, y: 15, filter: 'blur(8px)' },
    show: (i) => ({
      opacity: 1, y: 0, filter: 'blur(0px)',
      transition: { delay: i * 0.08, duration: 1.0, ease: [0.25, 0.1, 0.25, 1] },
    }),
  }

  if (loading) return <div className="loading-state">Lighting the lamps…</div>

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {/* ── ATMOSPHERE ─────────────────────────────────────────────────── */}
      <div className="night-sky" aria-hidden="true" />
      <div className={`moon ${moonPhase}`} aria-hidden="true" />

      {/* ── ASH TRAY (Undo) ────────────────────────────────────────────── */}
      {/* ── KINDLE UPLOAD STATUS TOAST ──────────────────────────────── */}
      <AnimatePresence>
        {uploadStatus && (
          <motion.div
            className="sync-toast kindle-toast"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.35 }}
            role="status"
          >
            {uploadStatus === 'uploading'
              ? '📖 Reading your Kindle clippings…'
              : uploadStatus.error
                ? '✕ Upload failed. Is it a My Clippings.txt file?'
                : `✓ Forged ${uploadStatus.added} new thought${uploadStatus.added !== 1 ? 's' : ''} from Kindle.`}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ash-tray" role="status" aria-live="polite">
        <AnimatePresence>
          {smoldering.map((ash) => (
            <motion.div
              key={`ash-${ash.id}`}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.9, filter: 'blur(5px)' }}
              transition={{ duration: 0.4 }}
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

      {/* ── SYNC STATUS TOAST ──────────────────────────────────────────── */}
      <AnimatePresence>
        {syncStatus && (
          <motion.div
            className="sync-toast"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.35 }}
            role="status"
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

        {/* ── MANUAL SUMMON MODAL ─────────────────────────────────────── */}
        <AnimatePresence>
          {isSummonOpen && (
            <motion.div
              className="spirit-ledger-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSummonOpen(false)}
            >
              <motion.div
                className="spirit-ledger-card"
                initial={{ y: 30, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -20, opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="ledger-header">
                  <span className="ledger-title">Summon a New Thought</span>
                  <button className="ledger-close-btn" onClick={() => setIsSummonOpen(false)} aria-label="Close">✕</button>
                </div>
                <div className="summon-form">
                  {!selectedSource && (
                    <input
                      id="summon-source-input"
                      type="text"
                      className="edit-source-input"
                      placeholder="Volume Title (blank → Stray Thoughts)"
                      value={newThoughtSource}
                      onChange={(e) => setNewThoughtSource(e.target.value)}
                    />
                  )}
                  <textarea
                    id="summon-content-input"
                    className="edit-textarea"
                    placeholder="Write the thought here…"
                    rows="6"
                    value={newThoughtContent}
                    onChange={(e) => setNewThoughtContent(e.target.value)}
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

        {/* ── SPIRIT LEDGER (Ctrl+K) ──────────────────────────────────── */}
        <AnimatePresence>
          {isSearchOpen && (
            <motion.div
              className="spirit-ledger-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSearchOpen(false)}
            >
              <motion.div
                className="spirit-ledger-card"
                initial={{ y: 30, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -20, opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="Search the Library"
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
                  ref={searchInputRef}
                  id="spirit-ledger-input"
                  type="text"
                  className="ledger-input"
                  placeholder="Whisper a word…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search highlights"
                />

                {searchQuery && matchedSources.length > 0 && !selectedSource && (
                  <div className="ledger-dropdown-list" role="listbox">
                    <span className="dropdown-label">Found in Volumes:</span>
                    {matchedSources.map(source => {
                      const count = filteredHighlights.filter(h => h.book_title === source).length
                      return (
                        <button
                          key={source}
                          className="ledger-dropdown-item"
                          role="option"
                          onClick={() => {
                            setSelectedSource(source)
                            setIsSearchOpen(false)
                            setSearchQuery('')
                          }}
                        >
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
                  id="title-rename-input"
                  type="text"
                  className="edit-source-input h1-style"
                  value={editTitleText}
                  onChange={(e) => setEditTitleText(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && saveTitleRename()}
                />
                <button className="quill-save-btn" onClick={saveTitleRename}>Save</button>
                <button className="quill-cancel-btn" onClick={() => setIsEditingTitle(false)}>✕</button>
              </div>
            ) : (
              <h1>
                {selectedSource ?? 'Mnemo'}
                {selectedSource && (
                  <button className="title-edit-btn" onClick={startEditingTitle} title="Rename Volume" aria-label="Rename volume">✎</button>
                )}
              </h1>
            )}

            <div className="header-cta-group">
              <button
                id="add-thought-btn"
                className="summon-top-btn"
                onClick={() => setIsSummonOpen(true)}
                title="Summon New Thought"
              >
                + Add
              </button>

              {/* Hidden file input — triggered by the button below */}
              <input
                ref={kindleInputRef}
                type="file"
                accept=".txt"
                style={{ display: 'none' }}
                onChange={handleKindleUpload}
                aria-hidden="true"
              />
              <button
                id="kindle-upload-btn"
                className="kindle-upload-btn"
                onClick={() => kindleInputRef.current?.click()}
                title="Upload My Clippings.txt from Kindle"
                disabled={uploadStatus === 'uploading'}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Kindle
              </button>

              <SyncDriveButton onSyncStart={handleSyncStart} onSyncDone={handleSyncDone} />
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
                <motion.span
                  className="active-filter-badge"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
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

        {/* ── EMPTY STATE ─────────────────────────────────────────────── */}
        {displayedItems.length === 0 && searchQuery && (
          <div className="empty-state" role="status">No thoughts found matching "{searchQuery}".</div>
        )}

        {/* ── NATIVE CSS MASONRY GRID ─────────────────────────────────── */}
        <div className="masonry-grid">
          {displayedItems.map((item, index) => {
            const isBurning = burningId === item.id
            const isEditing = editingId === item.id

            return (
              <motion.article
                key={item.id}
                custom={index}
                initial="hidden"
                animate="show"
                variants={itemAnim}
                className={`quote-card ${item.isStack && !selectedSource ? 'tome-stack' : ''} ${isBurning ? 'burning-ash' : ''}`}
                onClick={() => !isBurning && !isEditing && item.isStack && !selectedSource && setSelectedSource(item.book_title)}
              >
                {/* Burn Confirmation Overlay */}
                <AnimatePresence>
                  {confirmingId === item.id && !isBurning && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="confirm-overlay"
                    >
                      <span>Forget this thought?</span>
                      <div className="confirm-btns">
                        <button className="burn-btn" onClick={(e) => { e.stopPropagation(); igniteThought(item) }}>Burn</button>
                        <button className="keep-btn" onClick={(e) => { e.stopPropagation(); setConfirmingId(null) }}>Keep</button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Card Actions */}
                {(!item.isStack || selectedSource) && !isBurning && !isEditing && (
                  <div className="card-actions">
                    <button className="quill-edit-btn" onClick={(e) => { e.stopPropagation(); startEditing(item) }} title="Edit Thought" aria-label="Edit thought">✎</button>
                    <button className="whisper-delete"  onClick={(e) => { e.stopPropagation(); setConfirmingId(item.id) }} title="Burn Thought" aria-label="Delete thought">✕</button>
                  </div>
                )}

                {/* Content or Editor */}
                {isEditing ? (
                  <div className="edit-mode-container" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      className="edit-textarea"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows="6"
                      autoFocus
                      aria-label="Edit thought content"
                    />
                    <div className="edit-actions">
                      <button className="quill-save-btn"   onClick={() => saveEdit(item.id)}>Save</button>
                      <button className="quill-cancel-btn" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <blockquote
                    className="quote-content"
                    dangerouslySetInnerHTML={{
                      __html: searchQuery
                        ? `"${item.content.replace(
                            new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                            match => `<mark class="ink-highlight">${match}</mark>`
                          )}"`
                        : `"${item.content}"`,
                    }}
                  />
                )}

                <div className="quote-meta">
                  <span className="book-title">{item.book_title}</span>
                  {item.url && !item.isStack && (
                    <a href={item.url} target="_blank" rel="noreferrer" className="source-link" onClick={e => e.stopPropagation()}>
                      Source
                    </a>
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
      <button
        className="mobile-summon-btn"
        onClick={() => setIsSummonOpen(true)}
        aria-label="Add new thought"
        title="Add Thought"
      >
        +
      </button>
    </GoogleOAuthProvider>
  )
}

export default App