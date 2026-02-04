'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/components/app-shell'

type ThreadRow = {
  id: string
  title?: string | null
  draft_title?: string | null
  draft_content?: string | null
  updated_at?: string
}

function excerptFromDraft(raw?: string | null) {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    const tabs = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tabs) ? parsed.tabs : null
    if (tabs) {
      const combined = tabs.join('\n').trim()
      return combined.slice(0, 140)
    }
  } catch {
    // fall through
  }
  return raw.slice(0, 140)
}

export default function LibraryPage() {
  const { selectedProduct, openContextDrawer } = useAppContext()
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  async function load() {
    if (!selectedProduct) return
    setLoading(true)
    try {
      const res = await fetch(`/api/agent/threads?product_id=${selectedProduct}`)
      const data = await res.json()
      setThreads(Array.isArray(data) ? data : [])
    } catch {
      setThreads([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return threads
    return threads.filter((t) => {
      const title = t.draft_title || t.title || ''
      const excerpt = excerptFromDraft(t.draft_content)
      return `${title} ${excerpt}`.toLowerCase().includes(query)
    })
  }, [threads, q])

  if (!selectedProduct) {
    return (
      <div className="h-full flex items-center justify-center p-10">
        <div className="editor-panel p-8 max-w-lg w-full text-center">
          <p className="font-serif text-2xl">Select a product</p>
          <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
            Library is organized per product.
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
            <h1 className="font-serif text-3xl leading-tight">Saved Assets</h1>
            <p className="text-sm text-[var(--editor-ink-muted)] mt-1">
              All saved drafts for this product.
            </p>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search drafts..."
            className="editor-input text-sm w-full md:w-80"
          />
        </div>

        {loading ? (
          <p className="text-sm text-[var(--editor-ink-muted)]">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="editor-panel-soft p-8 text-center">
            <p className="text-sm text-[var(--editor-ink-muted)]">
              No saved assets yet.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filtered.map((t) => {
              const title = t.draft_title || t.title || 'Untitled draft'
              const excerpt = excerptFromDraft(t.draft_content)
              return (
                <Link
                  key={t.id}
                  href={`/studio?thread=${t.id}`}
                  className="editor-panel p-5 hover:-translate-y-0.5 transition-transform"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{title}</p>
                      {excerpt && (
                        <p className="text-sm text-[var(--editor-ink-muted)] mt-2 leading-6">
                          {excerpt}
                        </p>
                      )}
                    </div>
                    {t.updated_at && (
                      <span className="text-[11px] text-[var(--editor-ink-muted)]">
                        {new Date(t.updated_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
