'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/components/app-shell'
import { ConfirmDialog, FeedbackNotice } from '@/components/ui/feedback'

type ResearchCategory = {
  id: string
  name: string
  description?: string | null
  item_count?: number
}

type ResearchItem = {
  id: string
  title?: string | null
  summary?: string | null
  content?: string | null
  status?: string | null
  created_at?: string
  category_id?: string | null
  category_name?: string | null
  job_status?: string | null
}

type OrganizePlan = {
  categories: Array<{ name: string; description?: string }>
  assignments: Array<{ item_id: string; category_name: string }>
}

type SynthesisPlan = {
  avatars: Array<{ name: string; content: string }>
  positionings: Array<{ name: string; content: string }>
  quotes: Array<{ quote: string; source?: string; note?: string }>
  awareness_insights: Array<{ name: string; summary: string; application?: string }>
}

const MAX_UPLOAD_MB = 20

export default function ResearchPage() {
  const { selectedProduct, openContextDrawer } = useAppContext()
  const [categories, setCategories] = useState<ResearchCategory[]>([])
  const [inboxCount, setInboxCount] = useState(0)
  const [items, setItems] = useState<ResearchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('inbox')

  const [textValue, setTextValue] = useState('')
  const [addingText, setAddingText] = useState(false)

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [organizePlan, setOrganizePlan] = useState<OrganizePlan | null>(null)
  const [organizing, setOrganizing] = useState(false)
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'info' | 'success' | 'error'; message: string } | null>(null)
  const [synthesizeOpen, setSynthesizeOpen] = useState(false)
  const [synthesisPlan, setSynthesisPlan] = useState<SynthesisPlan | null>(null)
  const [synthLoading, setSynthLoading] = useState(false)
  const [synthApplying, setSynthApplying] = useState(false)
  const [synthExtract, setSynthExtract] = useState({
    avatars: true,
    positioning: true,
    quotes: true,
    awareness: true,
  })
  const [researchItemToDelete, setResearchItemToDelete] = useState<string | null>(null)
  const [deletingResearchItem, setDeletingResearchItem] = useState(false)

  const stuckCount = useMemo(() => {
    const now = Date.now()
    return items.filter((s) => {
      if (s.status !== 'processing') return false
      const created = s.created_at ? new Date(s.created_at).getTime() : 0
      return created && now - created > 10 * 60 * 1000
    }).length
  }, [items])

  async function loadCategories() {
    if (!selectedProduct) return
    try {
      const res = await fetch(`/api/research/categories?product_id=${selectedProduct}`)
      const data = await res.json()
      setCategories(Array.isArray(data?.categories) ? data.categories : [])
      setInboxCount(Number(data?.inbox_count || 0))
    } catch {
      setCategories([])
      setInboxCount(0)
    }
  }

  async function loadItems() {
    if (!selectedProduct) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('product_id', selectedProduct)
      if (q.trim()) params.set('q', q.trim())
      if (activeCategory === 'inbox') params.set('status', 'inbox')
      if (activeCategory !== 'inbox' && activeCategory !== 'all') {
        params.set('category_id', activeCategory)
      }
      const res = await fetch(`/api/research/items?${params.toString()}`)
      const data = await res.json()
      setItems(Array.isArray(data) ? data : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCategories()
    loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct, activeCategory])

  useEffect(() => {
    const handle = setTimeout(() => {
      loadItems()
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  async function addTextItem() {
    if (!selectedProduct) return
    const content = textValue.trim()
    if (!content) return
    setAddingText(true)
    try {
      const res = await fetch('/api/research/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          type: 'text',
          content,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to add research')
      setTextValue('')
      await loadItems()
      await loadCategories()
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to add research',
      })
    } finally {
      setAddingText(false)
    }
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!selectedProduct || !fileList || fileList.length === 0) return
    setUploading(true)
    setUploadError(null)

    try {
      for (const file of Array.from(fileList)) {
        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
          throw new Error(`${file.name} exceeds ${MAX_UPLOAD_MB}MB limit`)
        }

        const res = await fetch('/api/research/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: selectedProduct,
            filename: file.name,
            mime: file.type || 'application/octet-stream',
            size: file.size,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Failed to get upload URL')

        await fetch(data.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        })

        const createRes = await fetch('/api/research/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: selectedProduct,
            type: 'file',
            file: {
              key: data.r2_key,
              filename: file.name,
              mime: file.type || 'application/octet-stream',
              size: file.size,
            },
          }),
        })
        const createData = await createRes.json()
        if (!createRes.ok) throw new Error(createData?.error || 'Failed to create item')
      }

      await loadItems()
      await loadCategories()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function runOrganize() {
    if (!selectedProduct) return
    setOrganizing(true)
    try {
      const res = await fetch('/api/research/organize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: selectedProduct }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to organize')
      setOrganizePlan(data)
      setOrganizeOpen(true)
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to organize',
      })
    } finally {
      setOrganizing(false)
    }
  }

  async function applyOrganize() {
    if (!selectedProduct || !organizePlan) return
    setOrganizing(true)
    try {
      const res = await fetch('/api/research/organize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          apply: true,
          categories: organizePlan.categories,
          assignments: organizePlan.assignments,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to apply')
      setOrganizeOpen(false)
      setOrganizePlan(null)
      await loadCategories()
      await loadItems()
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to apply',
      })
    } finally {
      setOrganizing(false)
    }
  }

  function getActiveThreadId() {
    if (!selectedProduct || typeof window === 'undefined') return ''
    const storageKey = `bl_active_thread_${selectedProduct}`
    return localStorage.getItem(storageKey) || ''
  }

  function emptySynthesisPlan(): SynthesisPlan {
    return {
      avatars: [],
      positionings: [],
      quotes: [],
      awareness_insights: [],
    }
  }

  async function runSynthesis() {
    if (!selectedProduct) return
    setSynthLoading(true)
    try {
      const res = await fetch('/api/research/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          item_ids: items.map((item) => item.id),
          extract: synthExtract,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to synthesize')
      setSynthesisPlan({
        avatars: Array.isArray(data?.avatars) ? data.avatars : [],
        positionings: Array.isArray(data?.positionings) ? data.positionings : [],
        quotes: Array.isArray(data?.quotes) ? data.quotes : [],
        awareness_insights: Array.isArray(data?.awareness_insights) ? data.awareness_insights : [],
      })
      setSynthesizeOpen(true)
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to synthesize',
      })
    } finally {
      setSynthLoading(false)
    }
  }

  async function applySynthesis(planOverride?: SynthesisPlan) {
    if (!selectedProduct) return
    const plan = planOverride || synthesisPlan
    if (!plan) return
    setSynthApplying(true)
    try {
      const res = await fetch('/api/research/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          apply: true,
          proposals: plan,
          thread_id: getActiveThreadId() || undefined,
          extract: synthExtract,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to apply synthesis')

      const created = data?.created || {}
      const avatarCount = Array.isArray(created.avatar_ids) ? created.avatar_ids.length : 0
      const pitchCount = Array.isArray(created.pitch_ids) ? created.pitch_ids.length : 0
      const insightCount = Array.isArray(created.research_item_ids) ? created.research_item_ids.length : 0

      setFeedback({
        tone: 'success',
        message: `Applied synthesis. Avatars: ${avatarCount}, Positioning: ${pitchCount}, Insights: ${insightCount}.`,
      })

      if (!planOverride) {
        setSynthesizeOpen(false)
      }
      await loadCategories()
      await loadItems()
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to apply synthesis',
      })
    } finally {
      setSynthApplying(false)
    }
  }

  async function ensureThreadForAttach(): Promise<string | null> {
    if (!selectedProduct) return null
    const storageKey = `bl_active_thread_${selectedProduct}`
    const stored = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null

    if (stored) {
      const existingRes = await fetch(`/api/agent/threads/${stored}`)
      if (existingRes.ok) return stored
    }

    const listRes = await fetch(`/api/agent/threads?product_id=${selectedProduct}&limit=1`)
    if (listRes.ok) {
      const list = await listRes.json().catch(() => [])
      const first = Array.isArray(list) ? list[0] : null
      if (first?.id) {
        localStorage.setItem(storageKey, first.id)
        return first.id
      }
    }

    const createRes = await fetch('/api/agent/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: selectedProduct }),
    })
    if (!createRes.ok) return null
    const created = await createRes.json().catch(() => null)
    if (!created?.id) return null
    localStorage.setItem(storageKey, created.id)
    return created.id as string
  }

  async function attachToAgent(itemId: string) {
    if (!selectedProduct) return
    const threadId = await ensureThreadForAttach()
    if (!threadId) {
      setFeedback({ tone: 'error', message: 'Could not find or create an Agent thread.' })
      return
    }

    const res = await fetch(`/api/agent/threads/${threadId}`)
    if (!res.ok) {
      setFeedback({ tone: 'error', message: 'Failed to load active thread.' })
      return
    }
    const thread = await res.json()
    const existing = Array.isArray(thread.context?.research_ids) ? thread.context.research_ids : []
    const next = Array.from(new Set([...existing, itemId]))
    await fetch(`/api/agent/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { research_ids: next } }),
    })
    setFeedback({ tone: 'success', message: 'Attached to Agent.' })
  }

  async function deleteResearchItem(itemId: string) {
    if (deletingResearchItem) return
    setDeletingResearchItem(true)
    try {
      const res = await fetch(`/api/research/items/${itemId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to delete research item')
      setItems((prev) => prev.filter((item) => item.id !== itemId))
      await loadCategories()
      setFeedback({ tone: 'success', message: 'Research item deleted.' })
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete research item',
      })
    } finally {
      setDeletingResearchItem(false)
    }
  }

  if (!selectedProduct) {
    return (
      <div className="h-full flex items-center justify-center p-10">
        <div className="editor-panel p-8 max-w-lg w-full text-center">
          <p className="font-serif text-2xl">Select a product</p>
          <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
            Research is organized per product.
          </p>
          <button onClick={openContextDrawer} className="editor-button mt-6">
            Open Context
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 p-6 overflow-hidden">
      {feedback && (
        <div className="mb-4">
          <FeedbackNotice
            message={feedback.message}
            tone={feedback.tone}
            onDismiss={() => setFeedback(null)}
          />
        </div>
      )}
      <div className="flex flex-col lg:flex-row gap-6 h-full min-h-0">
        {/* Sidebar */}
        <aside className="w-full lg:w-64 editor-panel p-4 flex flex-col min-h-0">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
              Research
            </p>
            <h1 className="font-serif text-2xl mt-1">Library</h1>
          </div>

          <div className="mt-6 space-y-2">
            <button
              onClick={() => setActiveCategory('inbox')}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm border transition-colors ${
                activeCategory === 'inbox'
                  ? 'bg-[var(--editor-accent-soft)] border-[var(--editor-accent)] text-[var(--editor-ink)]'
                  : 'border-[var(--editor-border)] text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)]'
              }`}
            >
              Inbox
              <span className="float-right text-xs">{inboxCount}</span>
            </button>
            <button
              onClick={() => setActiveCategory('all')}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm border transition-colors ${
                activeCategory === 'all'
                  ? 'bg-[var(--editor-accent-soft)] border-[var(--editor-accent)] text-[var(--editor-ink)]'
                  : 'border-[var(--editor-border)] text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)]'
              }`}
            >
              All Research
            </button>
          </div>

          <div className="mt-4 border-t border-[var(--editor-border)] pt-4 space-y-2 overflow-auto">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm border transition-colors ${
                  activeCategory === cat.id
                    ? 'bg-[var(--editor-accent-soft)] border-[var(--editor-accent)] text-[var(--editor-ink)]'
                    : 'border-[var(--editor-border)] text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)]'
                }`}
              >
                {cat.name}
                <span className="float-right text-xs">{cat.item_count || 0}</span>
              </button>
            ))}
          </div>

          <div className="mt-auto pt-4">
            <div className="space-y-2">
              <button
                onClick={runOrganize}
                disabled={organizing}
                className="editor-button w-full text-sm"
              >
                {organizing ? 'Organizing...' : 'Organize Inbox'}
              </button>
              <button
                onClick={runSynthesis}
                disabled={synthLoading || items.length === 0}
                className="editor-button-ghost w-full text-sm"
              >
                {synthLoading ? 'Synthesizing...' : 'Synthesize Insights'}
              </button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <section className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
          <div className="editor-panel p-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
                  How Research Works
                </p>
                <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
                  Add raw research, organize it into categories, then synthesize avatars, angles, quotes, and awareness insights you can apply directly.
                </p>
              </div>
              <button
                onClick={runSynthesis}
                disabled={synthLoading || items.length === 0}
                className="editor-button text-sm"
              >
                {synthLoading ? 'Synthesizing...' : 'Synthesize Insights'}
              </button>
            </div>
          </div>

          <div className="editor-panel p-5">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
                  Add Research
                </p>
                <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
                  Drop notes, surveys, Reddit threads, or docs here. The agent can use them as context.
                </p>
              </div>
              {stuckCount > 0 && (
                <div className="rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-panel-muted)] px-4 py-3">
                  <p className="text-xs text-[var(--editor-ink)] font-medium">
                    {stuckCount} item{stuckCount > 1 ? 's are' : ' is'} stuck processing.
                  </p>
                  <p className="text-[11px] text-[var(--editor-ink-muted)] mt-1">
                    Check your Render worker and Anthropic access (org key or `ANTHROPIC_API_KEY`).
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3">
                <textarea
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Paste research notes, VOC quotes, market insights..."
                  rows={6}
                  className="editor-input w-full text-sm leading-6 resize-none"
                />
                <button
                  onClick={addTextItem}
                  disabled={addingText || !textValue.trim()}
                  className="editor-button text-sm"
                >
                  {addingText ? 'Saving...' : 'Save Notes'}
                </button>
              </div>

              <div className="rounded-2xl border border-dashed border-[var(--editor-border)] bg-[var(--editor-panel-muted)] p-4 space-y-3">
                <p className="text-xs text-[var(--editor-ink-muted)]">
                  Upload PDFs, DOCX, or TXT. Max {MAX_UPLOAD_MB}MB each.
                </p>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => uploadFiles(e.target.files)}
                  className="text-xs"
                />
                {uploading && (
                  <p className="text-xs text-[var(--editor-ink-muted)]">Uploading...</p>
                )}
                {uploadError && (
                  <p className="text-xs text-red-600">{uploadError}</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search research..."
              className="editor-input text-sm w-full"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {loading ? (
              <p className="text-sm text-[var(--editor-ink-muted)]">Loading...</p>
            ) : items.length === 0 ? (
              <div className="editor-panel-soft p-8 text-center">
                <p className="text-sm text-[var(--editor-ink-muted)]">
                  No research yet for this view.
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {items.map((item) => (
                  <div key={item.id} className="editor-panel p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {item.title || 'Untitled research'}
                        </p>
                        {item.summary && (
                          <p className="text-sm text-[var(--editor-ink-muted)] mt-2 leading-6">
                            {item.summary}
                          </p>
                        )}
                        {!item.summary && item.content && (
                          <p className="text-sm text-[var(--editor-ink-muted)] mt-2 leading-6">
                            {item.content.slice(0, 160)}
                          </p>
                        )}
                        <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--editor-ink-muted)]">
                          <span>Status: {item.status || 'unknown'}</span>
                          {item.category_name && <span>• {item.category_name}</span>}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <button
                          onClick={() => attachToAgent(item.id)}
                          className="editor-button-ghost text-xs"
                        >
                          Attach to Agent
                        </button>
                        <button
                          onClick={() => setResearchItemToDelete(item.id)}
                          className="editor-button-ghost text-xs text-red-400"
                        >
                          Delete
                        </button>
                        {item.status === 'processing' && (
                          <span className="text-[10px] text-[var(--editor-ink-muted)]">
                            Processing…
                          </span>
                        )}
                        {item.status === 'failed' && (
                          <span className="text-[10px] text-red-600">Failed</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {organizeOpen && organizePlan && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/25 backdrop-blur-sm"
            onClick={() => setOrganizeOpen(false)}
          />
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="editor-panel w-full max-w-2xl p-6 max-h-[80vh] overflow-auto">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
                    Organizer
                  </p>
                  <h2 className="font-serif text-2xl">Proposed Categories</h2>
                </div>
                <button
                  onClick={() => setOrganizeOpen(false)}
                  className="text-sm text-[var(--editor-ink-muted)]"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {organizePlan.categories.map((cat) => (
                  <div key={cat.name} className="rounded-2xl border border-[var(--editor-border)] p-4">
                    <p className="text-sm font-semibold">{cat.name}</p>
                    {cat.description && (
                      <p className="text-xs text-[var(--editor-ink-muted)] mt-1">
                        {cat.description}
                      </p>
                    )}
                    <ul className="mt-2 space-y-1 text-xs text-[var(--editor-ink-muted)]">
                      {organizePlan.assignments
                        .filter((a) => a.category_name === cat.name)
                        .map((a) => {
                          const item = items.find((i) => i.id === a.item_id)
                          return (
                            <li key={a.item_id}>
                              {item?.title || item?.summary?.slice(0, 60) || a.item_id}
                            </li>
                          )
                        })}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  onClick={() => setOrganizeOpen(false)}
                  className="editor-button-ghost text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={applyOrganize}
                  disabled={organizing}
                  className="editor-button text-sm"
                >
                  {organizing ? 'Applying...' : 'Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {synthesizeOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/25 backdrop-blur-sm"
            onClick={() => setSynthesizeOpen(false)}
          />
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="editor-panel w-full max-w-4xl p-6 max-h-[86vh] overflow-auto">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
                    Synthesis
                  </p>
                  <h2 className="font-serif text-2xl">Research Insights</h2>
                  <p className="text-sm text-[var(--editor-ink-muted)] mt-1">
                    Generate strategy-ready outputs and apply what you want.
                  </p>
                </div>
                <button
                  onClick={() => setSynthesizeOpen(false)}
                  className="text-sm text-[var(--editor-ink-muted)]"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 editor-panel-soft p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
                  Extract
                </p>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <label className="text-xs text-[var(--editor-ink-muted)] flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={synthExtract.avatars}
                      onChange={(e) =>
                        setSynthExtract((prev) => ({ ...prev, avatars: e.target.checked }))
                      }
                    />
                    Avatars
                  </label>
                  <label className="text-xs text-[var(--editor-ink-muted)] flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={synthExtract.positioning}
                      onChange={(e) =>
                        setSynthExtract((prev) => ({ ...prev, positioning: e.target.checked }))
                      }
                    />
                    Positioning
                  </label>
                  <label className="text-xs text-[var(--editor-ink-muted)] flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={synthExtract.quotes}
                      onChange={(e) =>
                        setSynthExtract((prev) => ({ ...prev, quotes: e.target.checked }))
                      }
                    />
                    Quotes
                  </label>
                  <label className="text-xs text-[var(--editor-ink-muted)] flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={synthExtract.awareness}
                      onChange={(e) =>
                        setSynthExtract((prev) => ({ ...prev, awareness: e.target.checked }))
                      }
                    />
                    Awareness
                  </label>
                </div>
                <div className="mt-3">
                  <button
                    onClick={runSynthesis}
                    disabled={synthLoading}
                    className="editor-button text-sm"
                  >
                    {synthLoading ? 'Generating...' : 'Regenerate'}
                  </button>
                </div>
              </div>

              {!synthesisPlan ? (
                <div className="mt-5 editor-panel-soft p-8 text-center">
                  <p className="text-sm text-[var(--editor-ink-muted)]">
                    Generate insights to preview proposals.
                  </p>
                </div>
              ) : (
                <div className="mt-5 space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="editor-panel-soft p-3 text-center text-xs">
                      Avatars: {synthesisPlan.avatars.length}
                    </div>
                    <div className="editor-panel-soft p-3 text-center text-xs">
                      Positioning: {synthesisPlan.positionings.length}
                    </div>
                    <div className="editor-panel-soft p-3 text-center text-xs">
                      Quotes: {synthesisPlan.quotes.length}
                    </div>
                    <div className="editor-panel-soft p-3 text-center text-xs">
                      Awareness: {synthesisPlan.awareness_insights.length}
                    </div>
                  </div>

                  {synthesisPlan.avatars.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
                        Avatars
                      </p>
                      {synthesisPlan.avatars.map((avatar, idx) => (
                        <div key={`${avatar.name}-${idx}`} className="editor-panel p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">{avatar.name}</p>
                              <p className="text-sm text-[var(--editor-ink-muted)] mt-2 leading-6 whitespace-pre-wrap">
                                {avatar.content}
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                applySynthesis({
                                  ...emptySynthesisPlan(),
                                  avatars: [avatar],
                                })
                              }
                              disabled={synthApplying}
                              className="editor-button-ghost text-xs"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {synthesisPlan.positionings.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
                        Positioning
                      </p>
                      {synthesisPlan.positionings.map((positioning, idx) => (
                        <div key={`${positioning.name}-${idx}`} className="editor-panel p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">{positioning.name}</p>
                              <p className="text-sm text-[var(--editor-ink-muted)] mt-2 leading-6 whitespace-pre-wrap">
                                {positioning.content}
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                applySynthesis({
                                  ...emptySynthesisPlan(),
                                  positionings: [positioning],
                                })
                              }
                              disabled={synthApplying}
                              className="editor-button-ghost text-xs"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {synthesisPlan.quotes.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
                        Quotes
                      </p>
                      {synthesisPlan.quotes.map((quote, idx) => (
                        <div key={`${quote.quote}-${idx}`} className="editor-panel p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-sm text-[var(--editor-ink)] leading-6">
                                "{quote.quote}"
                              </p>
                              {(quote.source || quote.note) && (
                                <p className="text-xs text-[var(--editor-ink-muted)] mt-2">
                                  {[quote.source, quote.note].filter(Boolean).join(' · ')}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() =>
                                applySynthesis({
                                  ...emptySynthesisPlan(),
                                  quotes: [quote],
                                })
                              }
                              disabled={synthApplying}
                              className="editor-button-ghost text-xs"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {synthesisPlan.awareness_insights.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
                        Awareness Insights
                      </p>
                      {synthesisPlan.awareness_insights.map((insight, idx) => (
                        <div key={`${insight.name}-${idx}`} className="editor-panel p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">{insight.name}</p>
                              <p className="text-sm text-[var(--editor-ink-muted)] mt-2 leading-6">
                                {insight.summary}
                              </p>
                              {insight.application && (
                                <p className="text-xs text-[var(--editor-ink-muted)] mt-2">
                                  Application: {insight.application}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() =>
                                applySynthesis({
                                  ...emptySynthesisPlan(),
                                  awareness_insights: [insight],
                                })
                              }
                              disabled={synthApplying}
                              className="editor-button-ghost text-xs"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  onClick={() => setSynthesizeOpen(false)}
                  className="editor-button-ghost text-sm"
                >
                  Close
                </button>
                <button
                  onClick={() => applySynthesis()}
                  disabled={synthApplying || !synthesisPlan}
                  className="editor-button text-sm"
                >
                  {synthApplying ? 'Applying...' : 'Apply All'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(researchItemToDelete)}
        title="Delete this research item?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={deletingResearchItem}
        onCancel={() => setResearchItemToDelete(null)}
        onConfirm={() => {
          if (!researchItemToDelete) return
          void deleteResearchItem(researchItemToDelete).then(() => setResearchItemToDelete(null))
        }}
      />
    </div>
  )
}
