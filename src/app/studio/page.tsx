'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppContext } from '@/components/app-shell'
import { CONTENT_TYPES } from '@/lib/content-types'

type AgentRole = 'user' | 'assistant' | 'tool'

type AgentMessage = {
  id?: string
  role: AgentRole
  content: string
  created_at?: string
}

type ThreadContext = {
  skill?: string
  versions?: number
  avatar_ids?: string[]
  positioning_id?: string | null
  active_swipe_id?: string | null
}

type SwipeRow = {
  id: string
  status: 'processing' | 'ready' | 'failed'
  title?: string | null
  summary?: string | null
  source_url?: string | null
  transcript?: string | null
  error_message?: string | null
  created_at?: string
}

type AvatarRow = { id: string; name: string; content: string; is_active: boolean }
type PitchRow = { id: string; name: string; content: string; is_active: boolean }

function extractDraftBlock(text: string): string | null {
  const match = text.match(/```draft\s*([\s\S]*?)\s*```/i)
  if (!match) return null
  return match[1].trim()
}

function splitDraftVersions(draft: string, versions: number): string[] {
  const out = Array.from({ length: versions }, () => '')
  const re = /^##\s*Version\s*(\d+)\s*$/gim
  const matches: Array<{ index: number; version: number; len: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(draft))) {
    const v = Number(m[1])
    if (!Number.isFinite(v)) continue
    matches.push({ index: m.index, version: v, len: m[0].length })
  }

  if (matches.length === 0) {
    out[0] = draft.trim()
    return out
  }

  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i]
    const next = matches[i + 1]
    const start = cur.index + cur.len
    const end = next ? next.index : draft.length
    const body = draft.slice(start, end).trim()
    const idx = cur.version - 1
    if (idx >= 0 && idx < out.length) out[idx] = body
  }

  return out
}

function isMetaAdLibraryUrlCandidate(text: string) {
  return /facebook\.com\/ads\/library\//i.test(text)
}

export default function GeneratePage() {
  const { selectedProduct, openContextDrawer, setContextDrawerExtra } = useAppContext()

  const [threadId, setThreadId] = useState<string | null>(null)
  const [threadContext, setThreadContext] = useState<ThreadContext>({})

  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)

  const [avatars, setAvatars] = useState<AvatarRow[]>([])
  const [avatarQuery, setAvatarQuery] = useState('')
  const [pitches, setPitches] = useState<PitchRow[]>([])
  const [swipes, setSwipes] = useState<SwipeRow[]>([])
  const [activeSwipe, setActiveSwipe] = useState<SwipeRow | null>(null)

  // Editor
  const [activeTab, setActiveTab] = useState(0)
  const [canvasTabs, setCanvasTabs] = useState<string[]>([''])

  const scrollRef = useRef<HTMLDivElement | null>(null)

  const versions = Math.min(6, Math.max(1, Number(threadContext.versions || 1)))
  const skill = String(threadContext.skill || 'ugc_video_scripts')
  const avatarIds = Array.isArray(threadContext.avatar_ids) ? threadContext.avatar_ids : []
  const positioningId = threadContext.positioning_id || null
  const activeSwipeId = threadContext.active_swipe_id || null

  // Keep canvas tab count in sync with versions
  useEffect(() => {
    setCanvasTabs((prev) => {
      const next = [...prev]
      if (next.length < versions) {
        while (next.length < versions) next.push('')
      } else if (next.length > versions) {
        next.length = versions
      }
      return next
    })
    setActiveTab((t) => Math.min(t, versions - 1))
  }, [versions])

  // Create or reuse thread when product changes
  useEffect(() => {
    let active = true
    const run = async () => {
      setThreadId(null)
      setThreadContext({})
      setMessages([])
      if (!selectedProduct) return

      const res = await fetch('/api/agent/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: selectedProduct }),
      })
      if (!res.ok) return
      const thread = await res.json()
      if (!active) return
      setThreadId(thread.id)
      setThreadContext(thread.context || {})
    }
    run()
    return () => {
      active = false
    }
  }, [selectedProduct])

  // Load messages for the thread
  useEffect(() => {
    let active = true
    const run = async () => {
      if (!threadId) return
      const res = await fetch(`/api/agent/messages?thread_id=${threadId}`)
      if (!res.ok) return
      const data = await res.json()
      if (!active) return
      setMessages(Array.isArray(data) ? data : [])
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
    }
    run()
    return () => {
      active = false
    }
  }, [threadId])

  // Apply swipe param from Swipes page
  useEffect(() => {
    if (!threadId) return
    const params = new URLSearchParams(window.location.search)
    const swipeParam = params.get('swipe')
    if (!swipeParam) return
    setThreadContext((prev) => ({ ...prev, active_swipe_id: swipeParam }))
  }, [threadId])

  // Persist thread context (debounced)
  useEffect(() => {
    if (!threadId) return
    const handle = setTimeout(async () => {
      await fetch(`/api/agent/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            skill,
            versions,
            avatar_ids: avatarIds,
            positioning_id: positioningId,
            active_swipe_id: activeSwipeId,
          },
        }),
      })
    }, 450)
    return () => clearTimeout(handle)
  }, [threadId, skill, versions, avatarIds, positioningId, activeSwipeId])

  // Load avatars/pitches/swipes for context drawer
  useEffect(() => {
    let active = true
    const run = async () => {
      if (!selectedProduct) {
        setAvatars([])
        setPitches([])
        setSwipes([])
        return
      }

      const [aRes, pRes, sRes] = await Promise.all([
        fetch(`/api/avatars?product_id=${selectedProduct}`),
        fetch(`/api/pitches?product_id=${selectedProduct}&active_only=true`),
        fetch(`/api/swipes?product_id=${selectedProduct}`),
      ])

      if (!active) return

      const a = await aRes.json().catch(() => [])
      const p = await pRes.json().catch(() => [])
      const s = await sRes.json().catch(() => [])

      setAvatars(Array.isArray(a) ? a : [])
      setPitches(Array.isArray(p) ? p : [])
      setSwipes(Array.isArray(s) ? s : [])
    }
    run()
    return () => {
      active = false
    }
  }, [selectedProduct])

  // Poll active swipe status until ready/failed
  useEffect(() => {
    let cancelled = false
    let timer: any = null

    const fetchSwipe = async () => {
      if (!activeSwipeId) {
        setActiveSwipe(null)
        return
      }
      const res = await fetch(`/api/swipes/${activeSwipeId}`)
      if (!res.ok) return
      const data = await res.json()
      if (cancelled) return
      setActiveSwipe(data)
      if (data?.status === 'processing') {
        timer = setTimeout(fetchSwipe, 4500)
      }
    }

    fetchSwipe()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [activeSwipeId])

  // Register Generate-specific controls inside the global Context drawer
  useEffect(() => {
    const node = (
      <div className="space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)] mb-2">
            Skill
          </p>
          <div className="flex flex-wrap gap-2">
            {CONTENT_TYPES.map((ct) => {
              const active = ct.id === skill
              return (
                <button
                  key={ct.id}
                  onClick={() => setThreadContext((prev) => ({ ...prev, skill: ct.id }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                    active
                      ? 'bg-[var(--editor-accent)] text-white border-[var(--editor-accent)]'
                      : 'bg-transparent text-[var(--editor-ink-muted)] border-[var(--editor-border)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)]'
                  }`}
                  title={ct.description}
                >
                  {ct.label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
              Versions
            </p>
            <span className="text-xs text-[var(--editor-ink-muted)]">{versions}</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {[1, 2, 3, 4, 5, 6].map((v) => (
              <button
                key={v}
                onClick={() => setThreadContext((prev) => ({ ...prev, versions: v }))}
                className={`w-10 h-10 rounded-2xl text-xs font-semibold transition-all border ${
                  versions === v
                    ? 'bg-[var(--editor-ink)] text-[var(--editor-rail-ink)] border-[var(--editor-ink)]'
                    : 'bg-transparent text-[var(--editor-ink-muted)] border-[var(--editor-border)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)]'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--editor-ink-muted)] mt-2">
            Drafts are a secondary feature. Default is 1.
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)] mb-2">
            Avatars
          </p>
          <input
            value={avatarQuery}
            onChange={(e) => setAvatarQuery(e.target.value)}
            placeholder="Search avatars..."
            className="editor-input w-full text-sm"
          />
          <div className="mt-3 max-h-56 overflow-auto pr-1 space-y-1">
            {avatars
              .filter((a) =>
                a.name.toLowerCase().includes(avatarQuery.trim().toLowerCase())
              )
              .map((a) => {
                const checked = avatarIds.includes(a.id)
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      setThreadContext((prev) => {
                        const ids = Array.isArray(prev.avatar_ids) ? prev.avatar_ids : []
                        const next = checked ? ids.filter((x) => x !== a.id) : [...ids, a.id]
                        return { ...prev, avatar_ids: next }
                      })
                    }}
                    className={`w-full text-left px-3 py-2 rounded-2xl border transition-colors ${
                      checked
                        ? 'border-[var(--editor-accent)] bg-[var(--editor-accent-soft)]'
                        : 'border-[var(--editor-border)] hover:border-[var(--editor-ink)] bg-[var(--editor-panel)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{a.name}</span>
                      <span className="text-xs text-[var(--editor-ink-muted)]">
                        {checked ? 'Selected' : ''}
                      </span>
                    </div>
                  </button>
                )
              })}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)] mb-2">
            Positioning
          </p>
          <select
            value={positioningId || ''}
            onChange={(e) =>
              setThreadContext((prev) => ({
                ...prev,
                positioning_id: e.target.value ? e.target.value : null,
              }))
            }
            className="editor-input w-full text-sm"
          >
            <option value="">None</option>
            {pitches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--editor-ink-muted)] mt-2">
            (Pitches renamed in UI as "Positioning".)
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)] mb-2">
            Active Swipe
          </p>
          <select
            value={activeSwipeId || ''}
            onChange={(e) =>
              setThreadContext((prev) => ({
                ...prev,
                active_swipe_id: e.target.value ? e.target.value : null,
              }))
            }
            className="editor-input w-full text-sm"
          >
            <option value="">None</option>
            {swipes.map((s) => (
              <option key={s.id} value={s.id}>
                {(s.title || s.source_url || 'untitled').slice(0, 60)} {s.status !== 'ready' ? `(${s.status})` : ''}
              </option>
            ))}
          </select>

          {activeSwipe && (
            <div className="mt-3 p-3 rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-panel-muted)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold truncate">
                  {activeSwipe.title || 'Untitled swipe'}
                </p>
                <span
                  className={`editor-tag ${
                    activeSwipe.status === 'ready'
                      ? 'editor-tag--note'
                      : 'editor-tag--warning'
                  }`}
                >
                  {activeSwipe.status === 'ready'
                    ? 'Ready'
                    : activeSwipe.status === 'failed'
                      ? 'Failed'
                      : 'Transcribing...'}
                </span>
              </div>
              {activeSwipe.summary && (
                <p className="text-xs text-[var(--editor-ink-muted)] mt-2 line-clamp-3">
                  {activeSwipe.summary}
                </p>
              )}
              {activeSwipe.status === 'failed' && activeSwipe.error_message && (
                <p className="text-xs text-red-600 mt-2">{activeSwipe.error_message}</p>
              )}
            </div>
          )}
        </div>
      </div>
    )

    setContextDrawerExtra(node)
    return () => setContextDrawerExtra(null)
  }, [
    setContextDrawerExtra,
    skill,
    versions,
    avatarIds,
    avatarQuery,
    positioningId,
    activeSwipeId,
    avatars,
    pitches,
    swipes,
    activeSwipe,
  ])

  const filteredAvatarsLabel = useMemo(() => {
    if (avatarIds.length === 0) return 'No avatars selected'
    if (avatarIds.length === 1) return '1 avatar selected'
    return `${avatarIds.length} avatars selected`
  }, [avatarIds.length])

  async function sendMessage() {
    if (!threadId || sending) return
    const text = composer.trim()
    if (!text) return

    setSending(true)
    setComposer('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])

    try {
      // Refresh swipe list sooner when the user pastes a Meta URL
      if (selectedProduct && isMetaAdLibraryUrlCandidate(text)) {
        fetch(`/api/swipes?product_id=${selectedProduct}`)
          .then((r) => r.json())
          .then((data) => setSwipes(Array.isArray(data) ? data : []))
          .catch(() => {})
      }

      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId, message: text }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Agent chat failed')

      setThreadContext((prev) => ({ ...prev, ...(data.thread_context || {}) }))
      setMessages((prev) => [...prev, { role: 'assistant', content: data.assistant_message }])
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send'
      setMessages((prev) => [...prev, { role: 'tool', content: msg }])
    } finally {
      setSending(false)
    }
  }

  function insertDraftIntoCanvas(draft: string) {
    const split = splitDraftVersions(draft, versions)
    setCanvasTabs(split)
    setActiveTab(0)
  }

  if (!selectedProduct) {
    return (
      <div className="h-full flex items-center justify-center p-10">
        <div className="editor-panel p-8 max-w-lg w-full text-center">
          <p className="font-serif text-2xl">Select a context</p>
          <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
            Pick an org, brand, and product to start writing.
          </p>
          <button onClick={openContextDrawer} className="editor-button mt-6">
            Open Context
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4 p-5 overflow-hidden">
        {/* Chat */}
        <section className="editor-panel flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--editor-border)] bg-[var(--editor-panel)]/70">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
                  Agent
                </p>
                <p className="font-serif text-lg leading-tight">Write with context, not settings.</p>
                <p className="text-xs text-[var(--editor-ink-muted)] mt-1">
                  {filteredAvatarsLabel} - {CONTENT_TYPES.find((c) => c.id === skill)?.label || skill}
                </p>
              </div>
              <button onClick={openContextDrawer} className="editor-button-ghost text-xs">
                Context
              </button>
            </div>

            {activeSwipe && (
              <div className="mt-4 flex items-center gap-2">
                <span className="editor-tag editor-tag--note">Swipe</span>
                <span className="text-xs text-[var(--editor-ink-muted)] truncate max-w-[250px]">
                  {activeSwipe.title || activeSwipe.source_url || activeSwipe.id}
                </span>
                <span
                  className={`editor-tag ${
                    activeSwipe.status === 'ready' ? 'editor-tag--note' : 'editor-tag--warning'
                  }`}
                >
                  {activeSwipe.status === 'ready'
                    ? 'Ready'
                    : activeSwipe.status === 'failed'
                      ? 'Failed'
                      : 'Transcribing...'}
                </span>
              </div>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-auto p-5 space-y-4">
            {messages.length === 0 ? (
              <div className="text-sm text-[var(--editor-ink-muted)] leading-6">
                <p className="font-semibold text-[var(--editor-ink)]">Start simple:</p>
                <p className="mt-2">1. Paste a Meta Ad Library URL</p>
                <p>2. Say what you want to write (script, hooks, angles)</p>
                <p>3. Insert the draft into your canvas</p>
              </div>
            ) : (
              messages.map((m, idx) => {
                const isUser = m.role === 'user'
                const isTool = m.role === 'tool'
                const draft = m.role === 'assistant' ? extractDraftBlock(m.content) : null
                return (
                  <div key={m.id || idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[92%] rounded-2xl border px-4 py-3 ${
                        isUser
                          ? 'bg-[var(--editor-ink)] text-[var(--editor-rail-ink)] border-[var(--editor-ink)]'
                          : isTool
                            ? 'bg-[rgba(189,255,0,0.12)] text-[var(--editor-ink)] border-[rgba(10,31,28,0.16)]'
                            : 'bg-[var(--editor-panel)] text-[var(--editor-ink)] border-[var(--editor-border)]'
                      }`}
                    >
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-6">
                        {m.content}
                      </pre>

                      {draft && (
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => insertDraftIntoCanvas(draft)}
                            className="editor-button-ghost text-xs"
                          >
                            Insert to Canvas
                          </button>
                          {versions > 1 && (
                            <span className="text-xs text-[var(--editor-ink-muted)]">
                              Splits by &quot;## Version N&quot;
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="p-5 border-t border-[var(--editor-border)] bg-[var(--editor-panel)]/70">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                sendMessage()
              }}
              className="flex items-end gap-3"
            >
              <div className="flex-1">
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="Paste a Meta Ad Library URL, or tell me what to write..."
                  rows={2}
                  className="editor-input w-full text-sm resize-none"
                />
                <p className="text-[11px] text-[var(--editor-ink-muted)] mt-2">
                  Tip: start with &quot;Write 1 UGC script from this swipe, then 5 hook variations.&quot;
                </p>
              </div>
              <button
                type="submit"
                className="editor-button"
                disabled={!threadId || sending || !composer.trim()}
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </form>
          </div>
        </section>

        {/* Draft Canvas */}
        <section className="editor-panel flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--editor-border)] flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
                Draft Canvas
              </p>
              <p className="font-serif text-lg">Focus mode</p>
            </div>

            {versions > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                {Array.from({ length: versions }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveTab(i)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                      activeTab === i
                        ? 'bg-[var(--editor-ink)] text-[var(--editor-rail-ink)] border-[var(--editor-ink)]'
                        : 'bg-transparent text-[var(--editor-ink-muted)] border-[var(--editor-border)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)]'
                    }`}
                  >
                    V{i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto p-6">
            <textarea
              value={canvasTabs[activeTab] || ''}
              onChange={(e) => {
                const val = e.target.value
                setCanvasTabs((prev) => {
                  const next = [...prev]
                  next[activeTab] = val
                  return next
                })
              }}
              placeholder="Your draft lives here. Ask the agent for a draft, then insert it."
              className="w-full h-full min-h-[520px] p-5 rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-panel)] text-[15px] leading-7 text-[var(--editor-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--editor-accent)] resize-none"
            />
          </div>
        </section>
      </div>
    </div>
  )
}
