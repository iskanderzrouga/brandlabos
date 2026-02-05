'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/components/app-shell'

type SwipeRow = {
  id: string
  status: 'processing' | 'ready' | 'failed'
  title?: string | null
  summary?: string | null
  source_url?: string | null
  created_at?: string
  updated_at?: string
  job_status?: 'queued' | 'running' | 'completed' | 'failed' | null
}

export default function SwipesPage() {
  const { selectedProduct, openContextDrawer } = useAppContext()
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [swipes, setSwipes] = useState<SwipeRow[]>([])
  const [ingestUrl, setIngestUrl] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualText, setManualText] = useState('')
  const [manualAvatarId, setManualAvatarId] = useState('')
  const [manualPositioningId, setManualPositioningId] = useState('')
  const [avatars, setAvatars] = useState<Array<{ id: string; name: string }>>([])
  const [pitches, setPitches] = useState<Array<{ id: string; name: string }>>([])
  const [savingManual, setSavingManual] = useState(false)

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return swipes
    return swipes.filter((s) => {
      const hay = `${s.title || ''} ${s.summary || ''} ${s.source_url || ''}`.toLowerCase()
      return hay.includes(query)
    })
  }, [q, swipes])

  const stuckCount = useMemo(() => {
    const now = Date.now()
    return swipes.filter((s) => {
      if (s.status !== 'processing') return false
      const created = s.created_at ? new Date(s.created_at).getTime() : 0
      return created && now - created > 10 * 60 * 1000
    }).length
  }, [swipes])

  async function load() {
    if (!selectedProduct) return
    setLoading(true)
    try {
      const res = await fetch(`/api/swipes?product_id=${selectedProduct}`)
      const data = await res.json()
      setSwipes(Array.isArray(data) ? data : [])
    } catch {
      setSwipes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct])

  useEffect(() => {
    let active = true
    const run = async () => {
      if (!selectedProduct) {
        setAvatars([])
        setPitches([])
        return
      }
      const [aRes, pRes] = await Promise.all([
        fetch(`/api/avatars?product_id=${selectedProduct}`),
        fetch(`/api/pitches?product_id=${selectedProduct}&active_only=true`),
      ])
      if (!active) return
      const a = await aRes.json().catch(() => [])
      const p = await pRes.json().catch(() => [])
      setAvatars(Array.isArray(a) ? a : [])
      setPitches(Array.isArray(p) ? p : [])
    }
    run()
    return () => {
      active = false
    }
  }, [selectedProduct])

  async function ingest() {
    if (!selectedProduct) return
    const url = ingestUrl.trim()
    if (!url) return
    setIngesting(true)
    try {
      const res = await fetch('/api/swipes/ingest-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: selectedProduct, url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to ingest')
      setIngestUrl('')
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to ingest')
    } finally {
      setIngesting(false)
    }
  }

  async function createManualSwipe() {
    if (!selectedProduct) return
    const transcript = manualText.trim()
    if (!transcript) return
    setSavingManual(true)
    try {
      const res = await fetch('/api/swipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          transcript,
          title: manualTitle.trim(),
          avatar_id: manualAvatarId || null,
          positioning_id: manualPositioningId || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to save swipe')
      setManualTitle('')
      setManualText('')
      setManualAvatarId('')
      setManualPositioningId('')
      setManualOpen(false)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save swipe')
    } finally {
      setSavingManual(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this swipe? This cannot be undone.')) return
    const res = await fetch(`/api/swipes/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data?.error || 'Failed to delete swipe')
      return
    }
    setSwipes((prev) => prev.filter((s) => s.id !== id))
  }

  if (!selectedProduct) {
    return (
      <div className="h-full flex items-center justify-center p-10">
        <div className="editor-panel p-8 max-w-lg w-full text-center">
          <p className="font-serif text-2xl">Select a product</p>
          <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
            Swipes are saved per product.
          </p>
          <button onClick={openContextDrawer} className="editor-button mt-6">
            Open Context
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
              Library
            </p>
            <h1 className="font-serif text-3xl leading-tight">Swipes</h1>
            <p className="text-sm text-[var(--editor-ink-muted)] mt-1">
              Meta Ad Library URLs -&gt; video + transcript -&gt; searchable context.
            </p>
          </div>

          <div className="editor-panel p-4 flex flex-col gap-3 w-full md:w-auto">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={ingestUrl}
                onChange={(e) => setIngestUrl(e.target.value)}
                placeholder="Paste Meta Ad Library URL..."
                className="editor-input text-sm w-full sm:w-[360px]"
              />
              <button
                onClick={ingest}
                disabled={ingesting || !ingestUrl.trim()}
                className="editor-button"
              >
                {ingesting ? 'Saving...' : 'Ingest'}
              </button>
            </div>
            <button
              onClick={() => setManualOpen((v) => !v)}
              className="editor-button-ghost text-xs"
            >
              {manualOpen ? 'Close Manual Swipe' : 'Add Manual Swipe'}
            </button>
          </div>
        </div>

        {manualOpen && (
          <div className="editor-panel p-5 mb-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="flex-1 space-y-3">
                <div>
                  <label className="block text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)] mb-2">
                    Optional name
                  </label>
                  <input
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder="Leave blank to auto-name"
                    className="editor-input text-sm w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)] mb-2">
                    Transcript / notes
                  </label>
                  <textarea
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder="Paste swipe text here..."
                    rows={6}
                    className="editor-input text-sm w-full resize-none"
                  />
                </div>
              </div>
              <div className="w-full md:w-64 space-y-3">
                <div>
                  <label className="block text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)] mb-2">
                    Avatar (optional)
                  </label>
                  <select
                    value={manualAvatarId}
                    onChange={(e) => setManualAvatarId(e.target.value)}
                    className="editor-input text-sm w-full"
                  >
                    <option value="">None</option>
                    {avatars.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)] mb-2">
                    Angle (optional)
                  </label>
                  <select
                    value={manualPositioningId}
                    onChange={(e) => setManualPositioningId(e.target.value)}
                    className="editor-input text-sm w-full"
                  >
                    <option value="">None</option>
                    {pitches.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={createManualSwipe}
                  disabled={savingManual || !manualText.trim()}
                  className="editor-button w-full"
                >
                  {savingManual ? 'Saving...' : 'Save Swipe'}
                </button>
                <p className="text-[11px] text-[var(--editor-ink-muted)]">
                  Auto-name uses 3-5 words with hyphens.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="editor-panel p-5 mb-6">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
            How it works
          </p>
          <p className="text-sm text-[var(--editor-ink)] mt-2">
            We scrape the Meta Ad Library page, download the video, transcribe it with Whisper,
            and store it in your swipe library. This requires the Render worker + an OpenAI API key
            (set in Settings → API Keys or via env fallback).
          </p>
          {stuckCount > 0 && (
            <div className="mt-4 p-3 rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-panel-muted)]">
              <p className="text-sm text-[var(--editor-ink)] font-medium">
                {stuckCount} swipe{stuckCount > 1 ? 's are' : ' is'} stuck in processing.
              </p>
              <p className="text-xs text-[var(--editor-ink-muted)] mt-1">
                Check your Render worker is running and has access to OpenAI (org key or `OPENAI_API_KEY`).
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 mb-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search swipes..."
            className="editor-input text-sm w-full"
          />
        </div>

        {loading ? (
          <p className="text-sm text-[var(--editor-ink-muted)]">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="editor-panel-soft p-8 text-center">
            <p className="text-sm text-[var(--editor-ink-muted)]">
              No swipes yet. Paste a Meta Ad Library URL above or in the Agent chat.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filtered.map((s) => (
              <Link
                key={s.id}
                href={`/studio/swipes/${s.id}`}
                className="editor-panel p-5 hover:-translate-y-0.5 transition-transform"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {s.title || 'Untitled swipe'}
                    </p>
                    {s.summary && (
                      <p className="text-sm text-[var(--editor-ink-muted)] mt-2 leading-6">
                        {s.summary}
                      </p>
                    )}
                    {!s.summary && s.source_url && (
                      <p className="text-xs text-[var(--editor-ink-muted)] mt-2 truncate">
                        {s.source_url}
                      </p>
                    )}
                  </div>

                  <span
                    className={`editor-tag ${
                      s.status === 'ready'
                        ? 'editor-tag--note'
                        : s.status === 'failed'
                          ? 'editor-tag--warning'
                          : 'editor-tag--warning'
                    }`}
                  >
                    {s.status === 'ready'
                      ? 'Ready'
                      : s.status === 'failed'
                        ? 'Failed'
                        : s.job_status === 'queued'
                          ? 'Queued'
                          : s.job_status === 'running'
                            ? 'Running'
                            : 'Processing'}
                  </span>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  {s.created_at && (
                    <p className="text-[11px] text-[var(--editor-ink-muted)]">
                      {new Date(s.created_at).toLocaleString()}
                    </p>
                  )}
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleDelete(s.id)
                    }}
                    className="text-[11px] text-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
