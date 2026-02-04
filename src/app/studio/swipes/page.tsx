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
}

export default function SwipesPage() {
  const { selectedProduct, openContextDrawer } = useAppContext()
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [swipes, setSwipes] = useState<SwipeRow[]>([])
  const [ingestUrl, setIngestUrl] = useState('')
  const [ingesting, setIngesting] = useState(false)

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return swipes
    return swipes.filter((s) => {
      const hay = `${s.title || ''} ${s.summary || ''} ${s.source_url || ''}`.toLowerCase()
      return hay.includes(query)
    })
  }, [q, swipes])

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

          <div className="editor-panel p-4 flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <input
              value={ingestUrl}
              onChange={(e) => setIngestUrl(e.target.value)}
              placeholder="Paste Meta Ad Library URL..."
              className="editor-input text-sm w-full sm:w-[380px]"
            />
            <button
              onClick={ingest}
              disabled={ingesting || !ingestUrl.trim()}
              className="editor-button"
            >
              {ingesting ? 'Saving...' : 'Ingest'}
            </button>
          </div>
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
                        : 'editor-tag--warning'
                    }`}
                  >
                    {s.status === 'ready'
                      ? 'Ready'
                      : s.status === 'failed'
                        ? 'Failed'
                        : 'Processing'}
                  </span>
                </div>

                {s.created_at && (
                  <p className="text-[11px] text-[var(--editor-ink-muted)] mt-4">
                    {new Date(s.created_at).toLocaleString()}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
