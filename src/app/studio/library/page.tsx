'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/components/app-shell'
import { ConfirmDialog, FeedbackNotice } from '@/components/ui/feedback'

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
  const [feedback, setFeedback] = useState<{ tone: 'info' | 'success' | 'error'; message: string } | null>(null)
  const [threadToDelete, setThreadToDelete] = useState<string | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(id: string) {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/agent/threads/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFeedback({ tone: 'error', message: data?.error || 'Failed to delete asset' })
        return
      }
      setThreads((prev) => prev.filter((t) => t.id !== id))
      setFeedback({ tone: 'success', message: 'Asset deleted.' })
    } catch {
      setFeedback({ tone: 'error', message: 'Failed to delete asset' })
    } finally {
      setDeleting(false)
    }
  }

  async function handleBulkDelete(ids: string[]) {
    if (deleting) return
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean)
    if (uniqueIds.length === 0) return

    setDeleting(true)
    try {
      const res = await fetch('/api/agent/threads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: uniqueIds }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFeedback({ tone: 'error', message: data?.error || 'Failed to delete selected assets' })
        return
      }
      const deletedSet = new Set<string>(Array.isArray(data?.deleted_ids) ? data.deleted_ids : uniqueIds)
      setThreads((prev) => prev.filter((t) => !deletedSet.has(t.id)))
      setSelectedIds((prev) => prev.filter((id) => !deletedSet.has(id)))
      setFeedback({
        tone: 'success',
        message: `${Number(data?.deleted || deletedSet.size)} asset${Number(data?.deleted || deletedSet.size) === 1 ? '' : 's'} deleted.`,
      })
    } catch {
      setFeedback({ tone: 'error', message: 'Failed to delete selected assets' })
    } finally {
      setDeleting(false)
    }
  }

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

  useEffect(() => {
    setSelectedIds([])
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

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedCount = selectedIds.length
  const visibleSelectedCount = useMemo(
    () => filtered.reduce((count, row) => (selectedSet.has(row.id) ? count + 1 : count), 0),
    [filtered, selectedSet]
  )
  const allVisibleSelected = filtered.length > 0 && visibleSelectedCount === filtered.length

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((value) => value !== id)
      return [...prev, id]
    })
  }

  function toggleSelectAllVisible() {
    const visibleIds = filtered.map((row) => row.id)
    if (visibleIds.length === 0) return
    setSelectedIds((prev) => {
      const prevSet = new Set(prev)
      const everyVisibleSelected = visibleIds.every((id) => prevSet.has(id))
      if (everyVisibleSelected) {
        return prev.filter((id) => !visibleIds.includes(id))
      }
      for (const id of visibleIds) prevSet.add(id)
      return Array.from(prevSet)
    })
  }

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
        {feedback && (
          <div className="mb-4">
            <FeedbackNotice
              message={feedback.message}
              tone={feedback.tone}
              onDismiss={() => setFeedback(null)}
            />
          </div>
        )}
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

        {filtered.length > 0 && (
          <div className="editor-panel-soft p-3 mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-[var(--editor-ink)]">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                className="h-4 w-4"
              />
              Select all shown ({filtered.length})
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--editor-ink-muted)]">
                {selectedCount} selected
              </span>
              <button
                type="button"
                disabled={selectedCount === 0 || deleting}
                onClick={() => setBulkDeleteOpen(true)}
                className="editor-button text-xs disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : `Delete selected (${selectedCount})`}
              </button>
            </div>
          </div>
        )}

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
                <div
                  key={t.id}
                  className="editor-panel p-5 hover:-translate-y-0.5 transition-transform"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          className="h-4 w-4"
                          aria-label={`Select ${title}`}
                        />
                        <Link
                          href={`/studio?thread=${t.id}`}
                          className="text-sm font-semibold truncate hover:underline"
                        >
                          {title}
                        </Link>
                      </div>
                      {excerpt && (
                        <p className="text-sm text-[var(--editor-ink-muted)] mt-2 leading-6">
                          {excerpt}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {t.updated_at && (
                        <span className="text-[11px] text-[var(--editor-ink-muted)]">
                          {new Date(t.updated_at).toLocaleString()}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          setThreadToDelete(t.id)
                        }}
                        className="text-[11px] text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(threadToDelete)}
        title="Delete this asset?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        onCancel={() => setThreadToDelete(null)}
        onConfirm={() => {
          if (!threadToDelete) return
          void handleDelete(threadToDelete).then(() => setThreadToDelete(null))
        }}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Delete ${selectedCount} selected asset${selectedCount === 1 ? '' : 's'}?`}
        description="This action cannot be undone."
        confirmLabel="Delete selected"
        tone="danger"
        busy={deleting}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={() => {
          void handleBulkDelete(selectedIds).then(() => setBulkDeleteOpen(false))
        }}
      />
    </div>
  )
}
