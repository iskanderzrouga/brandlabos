'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  research_ids?: string[]
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
type ResearchItemRow = {
  id: string
  title?: string | null
  summary?: string | null
  status?: string | null
}
type SkillOption = { id: string; label: string; description: string; source: 'core' | 'custom' }

function extractDraftBlock(text: string): string | null {
  const match = text.match(/```draft\s*([\s\S]*?)\s*```/i)
  if (!match) return null
  return match[1].trim()
}

function splitDraftMessage(text: string): { before: string; draft: string | null; after: string } {
  const match = text.match(/```draft\s*([\s\S]*?)\s*```/i)
  if (!match || match.index == null) return { before: text.trim(), draft: null, after: '' }
  const before = text.slice(0, match.index).trim()
  const after = text.slice(match.index + match[0].length).trim()
  return { before, draft: match[1].trim(), after }
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

function serializeDraftTabs(tabs: string[]) {
  return JSON.stringify({ tabs })
}

function parseDraftTabs(raw: string | null, versions: number): string[] {
  if (!raw) return Array.from({ length: versions }, () => '')
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const next = [...parsed]
      while (next.length < versions) next.push('')
      next.length = versions
      return next
    }
    if (parsed && Array.isArray(parsed.tabs)) {
      const next = [...parsed.tabs]
      while (next.length < versions) next.push('')
      next.length = versions
      return next
    }
  } catch {
    // fall through to plain text
  }
  const next = Array.from({ length: versions }, () => '')
  next[0] = raw
  return next
}

function deriveDraftTitle(tabs: string[]) {
  const joined = tabs.join('\n')
  const firstLine = joined
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0)
  return firstLine ? firstLine.slice(0, 80) : 'Untitled draft'
}

function deriveThreadTitleFromMessage(message: string) {
  const clean = message.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const sentence = clean.split(/[.!?\n]/)[0].trim()
  if (!sentence) return null
  return sentence.slice(0, 80)
}

function isMetaAdLibraryUrlCandidate(text: string) {
  return /facebook\.com\/ads\/library\//i.test(text)
}

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(`[^`]+`)/g)
  const out: React.ReactNode[] = []
  parts.forEach((part, idx) => {
    if (!part) return
    if (part.startsWith('`') && part.endsWith('`')) {
      out.push(
        <code key={`${keyPrefix}-code-${idx}`}>{part.slice(1, -1)}</code>
      )
      return
    }
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g
    let last = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(part))) {
      if (match.index > last) {
        out.push(part.slice(last, match.index))
      }
      const token = match[0]
      if (token.startsWith('**')) {
        out.push(
          <strong key={`${keyPrefix}-bold-${match.index}`}>{token.slice(2, -2)}</strong>
        )
      } else {
        out.push(
          <em key={`${keyPrefix}-em-${match.index}`}>{token.slice(1, -1)}</em>
        )
      }
      last = match.index + token.length
    }
    if (last < part.length) {
      out.push(part.slice(last))
    }
  })
  return out
}

function renderParagraph(text: string, key: string) {
  const lines = text.split('\n')
  return (
    <p key={key}>
      {lines.map((line, idx) => (
        <span key={`${key}-line-${idx}`}>
          {renderInline(line, `${key}-inline-${idx}`)}
          {idx < lines.length - 1 && <br />}
        </span>
      ))}
    </p>
  )
}

function renderMarkdownBlocks(text: string) {
  if (!text) return null
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let blockIndex = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }

    if (line.trim().startsWith('```')) {
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push(
        <pre key={`code-${blockIndex}`}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      blockIndex += 1
      continue
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`hr-${blockIndex}`} />)
      blockIndex += 1
      i += 1
      continue
    }

    if (/^\s*([-*+])\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+])\s+/, ''))
        i += 1
      }
      blocks.push(
        <ul key={`ul-${blockIndex}`}>
          {items.map((item, idx) => (
            <li key={`ul-${blockIndex}-${idx}`}>{renderInline(item, `ul-${blockIndex}-${idx}`)}</li>
          ))}
        </ul>
      )
      blockIndex += 1
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''))
        i += 1
      }
      blocks.push(
        <ol key={`ol-${blockIndex}`}>
          {items.map((item, idx) => (
            <li key={`ol-${blockIndex}-${idx}`}>{renderInline(item, `ol-${blockIndex}-${idx}`)}</li>
          ))}
        </ol>
      )
      blockIndex += 1
      continue
    }

    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !/^\s*([-*+])\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i += 1
    }
    blocks.push(renderParagraph(paraLines.join('\n'), `p-${blockIndex}`))
    blockIndex += 1
  }

  return blocks
}

function computeDiffRange(oldText: string, newText: string) {
  if (oldText === newText) return null
  const minLen = Math.min(oldText.length, newText.length)
  let start = 0
  while (start < minLen && oldText[start] === newText[start]) {
    start += 1
  }
  let endOld = oldText.length - 1
  let endNew = newText.length - 1
  while (endOld >= start && endNew >= start && oldText[endOld] === newText[endNew]) {
    endOld -= 1
    endNew -= 1
  }
  const end = Math.max(start, endNew + 1)
  if (end <= start) return null
  return { start, end }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

function makeSkillKey(name: string) {
  const base = slugify(name)
  if (!base) return `custom_${Date.now()}`
  return `custom_${base}`
}

export default function GeneratePage() {
  const { selectedProduct, openContextDrawer, setContextDrawerExtra, setTopBarExtra } = useAppContext()

  const [threadId, setThreadId] = useState<string | null>(null)
  const [threadContext, setThreadContext] = useState<ThreadContext>({})
  const [threads, setThreads] = useState<Array<any>>([])
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [threadHydrating, setThreadHydrating] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)

  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)

  const [avatars, setAvatars] = useState<AvatarRow[]>([])
  const [avatarQuery, setAvatarQuery] = useState('')
  const [pitches, setPitches] = useState<PitchRow[]>([])
  const [customSkills, setCustomSkills] = useState<SkillOption[]>([])
  const [skillsLoaded, setSkillsLoaded] = useState(false)
  const [skillBuilderOpen, setSkillBuilderOpen] = useState(false)
  const [skillName, setSkillName] = useState('')
  const [skillDescription, setSkillDescription] = useState('')
  const [skillGuidance, setSkillGuidance] = useState('')
  const [skillSaving, setSkillSaving] = useState(false)
  const [skillError, setSkillError] = useState<string | null>(null)
  const [skillSuccess, setSkillSuccess] = useState<string | null>(null)
  const [swipes, setSwipes] = useState<SwipeRow[]>([])
  const [activeSwipe, setActiveSwipe] = useState<SwipeRow | null>(null)
  const [researchItems, setResearchItems] = useState<ResearchItemRow[]>([])
  const [draftVisibility, setDraftVisibility] = useState<Record<string, boolean>>({})
  const [selectionText, setSelectionText] = useState('')
  const [selectionNote, setSelectionNote] = useState('')
  const [selectionQueue, setSelectionQueue] = useState<Array<{ id: string; text: string; note: string }>>([])
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(null)
  const [queueExpanded, setQueueExpanded] = useState<Record<string, boolean>>({})
  const [pendingAutoApply, setPendingAutoApply] = useState(false)
  const [highlightState, setHighlightState] = useState<{ tab: number; start: number; end: number } | null>(null)
  const [flashActive, setFlashActive] = useState(false)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [promptPreview, setPromptPreview] = useState<string | null>(null)
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false)
  const [conversationOpen, setConversationOpen] = useState(false)

  // Editor
  const [activeTab, setActiveTab] = useState(0)
  const [canvasTabs, setCanvasTabs] = useState<string[]>([''])
  const canvasRef = useRef<string[]>([''])
  const canvasTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingAutoApplyRef = useRef(false)
  const suppressSelectionRef = useRef(false)
  const historyRef = useRef<Record<number, { entries: string[]; index: number }>>({})
  const historyLockRef = useRef(false)
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)

  const versions = Math.min(6, Math.max(1, Number(threadContext.versions || 1)))
  const skill = String(threadContext.skill || 'ugc_video_scripts')
  const avatarIds = useMemo(
    () => (Array.isArray(threadContext.avatar_ids) ? threadContext.avatar_ids : []),
    [threadContext.avatar_ids]
  )
  const positioningId = threadContext.positioning_id || null
  const activeSwipeId = threadContext.active_swipe_id || null
  const researchIds = useMemo(
    () => (Array.isArray(threadContext.research_ids) ? threadContext.research_ids : []),
    [threadContext.research_ids]
  )
  const canvasHasContent = canvasTabs.some((t) => t.trim().length > 0)
  const hasQueuedNotes = selectionQueue.some(
    (item) => item.text.trim().length > 0 && item.note.trim().length > 0
  )
  const historyState = useMemo(
    () => historyRef.current[activeTab],
    [activeTab, historyVersion]
  )
  const canUndo = Boolean(historyState && historyState.index > 0)
  const canRedo = Boolean(
    historyState && historyState.index < historyState.entries.length - 1
  )

  const skillOptions = useMemo<SkillOption[]>(() => {
    const core = CONTENT_TYPES.map((ct) => ({
      id: ct.id,
      label: ct.label,
      description: ct.description,
      source: 'core' as const,
    }))
    const custom = customSkills.filter(
      (cs) => !core.some((c) => c.id === cs.id)
    )
    return [...core, ...custom]
  }, [customSkills])

  const recentThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0
      return bTime - aTime
    })
  }, [threads])

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

  useEffect(() => {
    canvasRef.current = canvasTabs
  }, [canvasTabs])

  useEffect(() => {
    if (!threadId) return
    const history = historyRef.current
    canvasTabs.forEach((tab, idx) => {
      if (!history[idx]) {
        history[idx] = { entries: [tab || ''], index: 0 }
      }
    })
  }, [canvasTabs, threadId])

  useEffect(() => {
    if (!threadId) return
    if (historyLockRef.current) return
    const current = canvasTabs[activeTab] || ''
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => {
      const history = historyRef.current
      const entry = history[activeTab] || { entries: [], index: -1 }
      const existing = entry.entries[entry.index]
      if (existing === current) return
      const nextEntries = entry.entries.slice(0, entry.index + 1).concat(current)
      history[activeTab] = { entries: nextEntries, index: nextEntries.length - 1 }
      setHistoryVersion((v) => v + 1)
    }, 350)
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current)
    }
  }, [canvasTabs, activeTab, threadId])

  useEffect(() => {
    if (!highlightState || !flashActive) return
    if (highlightState.tab !== activeTab) return
    const el = canvasTextareaRef.current
    if (!el) return
    suppressSelectionRef.current = true
    requestAnimationFrame(() => {
      try {
        el.focus()
        el.setSelectionRange(highlightState.start, highlightState.end)
      } catch {
        // ignore selection errors
      }
    })
    const timer = setTimeout(() => {
      if (canvasTextareaRef.current) {
        try {
          canvasTextareaRef.current.setSelectionRange(0, 0)
        } catch {
          // ignore
        }
      }
      suppressSelectionRef.current = false
      setFlashActive(false)
      setHighlightState(null)
    }, 1200)
    return () => clearTimeout(timer)
  }, [highlightState, flashActive, activeTab])

  const storageKey = selectedProduct ? `bl_active_thread_${selectedProduct}` : null

  const loadThreadById = useCallback(async (id: string) => {
    if (!id) return
    setThreadHydrating(true)
    setMessages([])
    setThreadId(id)
    setThreadContext({})
    setCanvasTabs([''])
    setActiveTab(0)
    setDraftVisibility({})
    setDraftSavedAt(null)
    historyRef.current = {}

    const threadRes = await fetch(`/api/agent/threads/${id}`)
    if (!threadRes.ok) {
      setThreadHydrating(false)
      return
    }
    const thread = await threadRes.json()
    setThreadId(thread.id)
    setThreadContext(thread.context || {})

    const threadVersions = Math.min(6, Math.max(1, Number(thread.context?.versions || 1)))
    const tabs = parseDraftTabs(thread.draft_content || null, threadVersions)
    setCanvasTabs(tabs)
    setActiveTab(0)
    setDraftSavedAt(thread.updated_at || null)
    historyRef.current = {}
    tabs.forEach((tab, idx) => {
      historyRef.current[idx] = { entries: [tab || ''], index: 0 }
    })
    setHistoryVersion((v) => v + 1)

    const msgRes = await fetch(`/api/agent/messages?thread_id=${thread.id}`)
    if (msgRes.ok) {
      const data = await msgRes.json()
      setMessages(Array.isArray(data) ? data : [])
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
    }

    if (storageKey) {
      localStorage.setItem(storageKey, thread.id)
    }
    const params = new URLSearchParams(window.location.search)
    params.set('thread', thread.id)
    window.history.replaceState(null, '', `/studio?${params.toString()}`)

    setThreadHydrating(false)
  }, [storageKey])

  const createThread = useCallback(async (contextSeed: ThreadContext | null) => {
    if (!selectedProduct) return null
    const res = await fetch('/api/agent/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: selectedProduct, context: contextSeed || undefined }),
    })
    if (!res.ok) return null
    const thread = await res.json()
    return thread
  }, [selectedProduct])

  // Load threads and hydrate active thread
  useEffect(() => {
    let active = true
    const run = async () => {
      setThreads([])
      setThreadId(null)
      setThreadContext({})
      setMessages([])
      setCanvasTabs([''])
      setActiveTab(0)
      setDraftSavedAt(null)
      if (!selectedProduct) return

      setThreadsLoading(true)
      const res = await fetch(`/api/agent/threads?product_id=${selectedProduct}`)
      const list = res.ok ? await res.json() : []
      if (!active) return
      const threadsList = Array.isArray(list) ? list : []
      setThreads(threadsList)
      setThreadsLoading(false)

      const params = new URLSearchParams(window.location.search)
      const threadFromUrl = params.get('thread')
      const candidateExists = threadFromUrl && threadsList.some((t: any) => t.id === threadFromUrl)

      if (candidateExists) {
        await loadThreadById(threadFromUrl as string)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [selectedProduct, storageKey, loadThreadById])

  // Apply swipe param from Swipes page
  useEffect(() => {
    if (!threadId) return
    const params = new URLSearchParams(window.location.search)
    const swipeParam = params.get('swipe')
    if (!swipeParam) return
    setThreadContext((prev) => ({ ...prev, active_swipe_id: swipeParam }))
  }, [threadId, skill, versions, avatarIds, positioningId, activeSwipeId, researchIds])

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
            research_ids: researchIds,
          },
        }),
      })
    }, 450)
    return () => clearTimeout(handle)
  }, [threadId, skill, versions, avatarIds, positioningId, activeSwipeId, researchIds])

  // Auto-save draft content
  useEffect(() => {
    if (!threadId || threadHydrating) return
    const handle = setTimeout(async () => {
      const payload = serializeDraftTabs(canvasTabs)
      const draftTitle = deriveDraftTitle(canvasTabs)
      setDraftSaving(true)
      await fetch(`/api/agent/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft_content: payload,
          draft_title: draftTitle,
        }),
      }).catch(() => {})
      const updatedAt = new Date().toISOString()
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? { ...t, draft_title: draftTitle, draft_content: payload, updated_at: updatedAt }
            : t
        )
      )
      setDraftSaving(false)
      setDraftSavedAt(updatedAt)
    }, 900)
    return () => clearTimeout(handle)
  }, [threadId, canvasTabs, threadHydrating])

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

      const [aRes, pRes, sRes, rRes] = await Promise.all([
        fetch(`/api/avatars?product_id=${selectedProduct}`),
        fetch(`/api/pitches?product_id=${selectedProduct}&active_only=true`),
        fetch(`/api/swipes?product_id=${selectedProduct}`),
        fetch(`/api/research/items?product_id=${selectedProduct}`),
      ])

      if (!active) return

      const a = await aRes.json().catch(() => [])
      const p = await pRes.json().catch(() => [])
      const s = await sRes.json().catch(() => [])
      const r = await rRes.json().catch(() => [])

      setAvatars(Array.isArray(a) ? a : [])
      setPitches(Array.isArray(p) ? p : [])
      setSwipes(Array.isArray(s) ? s : [])
      setResearchItems(Array.isArray(r) ? r : [])
    }
    run()
    return () => {
      active = false
    }
  }, [selectedProduct])

  const refreshSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/prompt-blocks?type=feature_template&scope=global&active_only=true')
      if (!res.ok) throw new Error('Failed to load skills')
      const data = await res.json()
      const mapped = (Array.isArray(data) ? data : [])
        .map((row: any) => {
          const meta = row.metadata || {}
          const key = typeof meta.key === 'string' ? meta.key : null
          if (!key) return null
          return {
            id: key,
            label: meta.label || row.name || key,
            description: meta.description || 'Custom skill',
            source: 'custom' as const,
          }
        })
        .filter(Boolean) as SkillOption[]

      const unique = new Map(mapped.map((m) => [m.id, m]))
      setCustomSkills(Array.from(unique.values()))
    } catch (err) {
      setCustomSkills([])
    } finally {
      setSkillsLoaded(true)
    }
  }, [])

  useEffect(() => {
    refreshSkills()
  }, [refreshSkills])

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      if (cancelled) return
      const run = async () => {
        if (!threadId) {
          setPromptPreview(null)
          return
        }
        const res = await fetch(`/api/agent/threads/${threadId}/prompt`)
        if (!res.ok) {
          if (!cancelled) setPromptPreview(null)
          return
        }
        const data = await res.json().catch(() => ({}))
        if (!cancelled) {
          setPromptPreview(typeof data?.prompt === 'string' ? data.prompt : null)
        }
      }
      run()
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [threadId, skill, versions, avatarIds, positioningId, activeSwipeId, researchIds])

  useEffect(() => {
    if (!threadId) {
      setTopBarExtra(null)
      return
    }
    setTopBarExtra(
      <button
        type="button"
        onClick={() => setPromptPreviewOpen(true)}
        className="editor-icon-ghost"
        aria-label="View compiled agent prompt"
        title="View compiled agent prompt"
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
          <path
            d="M4.5 4.5h11a2 2 0 012 2v10.5l-3-2.5H6.5a2 2 0 01-2-2v-8a2 2 0 012-2z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M8 9h7M8 12.5h5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    )
    return () => setTopBarExtra(null)
  }, [threadId, setTopBarExtra])

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

  const resetSkillBuilder = useCallback(() => {
    setSkillName('')
    setSkillDescription('')
    setSkillGuidance('')
    setSkillError(null)
    setSkillSuccess(null)
  }, [])

  const saveCustomSkill = useCallback(async () => {
    const name = skillName.trim()
    const guidance = skillGuidance.trim()
    if (!name || !guidance) {
      setSkillError('Add a name and guidance for the skill.')
      return
    }

    const key = makeSkillKey(name)
    setSkillSaving(true)
    setSkillError(null)
    setSkillSuccess(null)

    try {
      const res = await fetch('/api/prompt-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type: 'feature_template',
          scope: 'global',
          content: guidance,
          metadata: {
            key,
            label: name,
            description: skillDescription.trim() || 'Custom skill',
            origin: 'custom',
          },
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save skill')
      }

      await refreshSkills()
      setThreadContext((prev) => ({ ...prev, skill: key }))
      setSkillSuccess('Skill saved.')
      setSkillBuilderOpen(false)
      resetSkillBuilder()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save skill'
      setSkillError(msg)
    } finally {
      setSkillSaving(false)
    }
  }, [skillName, skillGuidance, skillDescription, refreshSkills, resetSkillBuilder])

  // Register Generate-specific controls inside the global Context drawer
  useEffect(() => {
    const node = (
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
              Skill
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSkillBuilderOpen((v) => !v)
                  setSkillError(null)
                  setSkillSuccess(null)
                }}
                className="editor-button-ghost text-[11px] px-3 py-1.5"
              >
                {skillBuilderOpen ? 'Close builder' : 'New skill'}
              </button>
              <a
                href="/studio/skills"
                className="text-[11px] text-[var(--editor-ink-muted)] underline underline-offset-4"
              >
                Skills
              </a>
            </div>
          </div>

          {skillsLoaded ? (
            <div className="flex flex-wrap gap-2">
              {skillOptions.map((ct) => {
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
          ) : (
            <p className="text-xs text-[var(--editor-ink-muted)]">Loading skills...</p>
          )}

          {skillBuilderOpen && (
            <div className="mt-3 p-4 rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-panel-muted)] space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-[0.2em] text-[var(--editor-ink-muted)] mb-1">
                  Skill Name
                </label>
                <input
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  placeholder="e.g., Short Form UGC Hooks"
                  className="editor-input w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.2em] text-[var(--editor-ink-muted)] mb-1">
                  Description
                </label>
                <input
                  value={skillDescription}
                  onChange={(e) => setSkillDescription(e.target.value)}
                  placeholder="What this skill is best at."
                  className="editor-input w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.2em] text-[var(--editor-ink-muted)] mb-1">
                  Skill Guidance
                </label>
                <textarea
                  value={skillGuidance}
                  onChange={(e) => setSkillGuidance(e.target.value)}
                  placeholder="Give the agent a clear structure, tone rules, and output format."
                  rows={5}
                  className="editor-input w-full text-sm resize-none"
                />
              </div>

              {skillError && (
                <p className="text-xs text-red-600">{skillError}</p>
              )}
              {skillSuccess && (
                <p className="text-xs text-[var(--editor-accent-strong)]">{skillSuccess}</p>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={saveCustomSkill}
                  disabled={skillSaving}
                  className="editor-button text-xs px-4 py-2"
                >
                  {skillSaving ? 'Saving...' : 'Save Skill'}
                </button>
                <button
                  onClick={() => {
                    setSkillBuilderOpen(false)
                    resetSkillBuilder()
                  }}
                  className="editor-button-ghost text-xs px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
              Positioning
            </p>
            <a
              href="/studio/pitches"
              className="text-[11px] text-[var(--editor-ink-muted)] underline underline-offset-4"
            >
              Manage
            </a>
          </div>
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
          {pitches.length === 0 ? (
            <p className="text-xs text-[var(--editor-ink-muted)] mt-2">
              No positioning yet. Add one to guide the agent&apos;s angle.
            </p>
          ) : (
            <p className="text-xs text-[var(--editor-ink-muted)] mt-2">
              Choose an angle/positioning you want the agent to follow.
            </p>
          )}
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

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
              Research
            </p>
            <a
              href="/studio/research"
              className="text-[11px] text-[var(--editor-ink-muted)] underline underline-offset-4"
            >
              Open
            </a>
          </div>

          <div className="space-y-2">
            {researchItems.length === 0 ? (
              <p className="text-xs text-[var(--editor-ink-muted)]">
                No research yet. Add some in the Research tab.
              </p>
            ) : (
              researchItems.map((item) => {
                const selected = researchIds.includes(item.id)
                return (
                  <button
                    key={item.id}
                    onClick={() =>
                      setThreadContext((prev) => ({
                        ...prev,
                        research_ids: selected
                          ? (Array.isArray(prev.research_ids) ? prev.research_ids : []).filter(
                              (id) => id !== item.id
                            )
                          : [...(Array.isArray(prev.research_ids) ? prev.research_ids : []), item.id],
                      }))
                    }
                    className={`w-full text-left rounded-2xl border px-3 py-2 text-xs transition-colors ${
                      selected
                        ? 'border-[var(--editor-accent)] text-[var(--editor-ink)] bg-[var(--editor-accent-soft)]'
                        : 'border-[var(--editor-border)] text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {item.title || 'Untitled research'}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--editor-ink-muted)]">
                        {selected ? 'Attached' : 'Add'}
                      </span>
                    </div>
                    {item.summary && (
                      <p className="text-[11px] text-[var(--editor-ink-muted)] mt-1 line-clamp-2">
                        {item.summary}
                      </p>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    )

    setContextDrawerExtra(node)
    return () => setContextDrawerExtra(null)
  }, [
    setContextDrawerExtra,
    skill,
    skillOptions,
    skillsLoaded,
    skillBuilderOpen,
    skillName,
    skillDescription,
    skillGuidance,
    skillSaving,
    skillError,
    skillSuccess,
    versions,
    avatarIds,
    avatarQuery,
    positioningId,
    activeSwipeId,
    avatars,
    pitches,
    swipes,
    activeSwipe,
    researchItems,
    researchIds,
    saveCustomSkill,
    resetSkillBuilder,
  ])

  function clearSelection() {
    if (activeSelectionId) {
      setSelectionQueue((prev) => {
        const current = prev.find((item) => item.id === activeSelectionId)
        if (current && !current.note.trim()) {
          return prev.filter((item) => item.id !== activeSelectionId)
        }
        return prev
      })
    }
    setSelectionText('')
    setSelectionNote('')
    setActiveSelectionId(null)
  }

  function removeSelectionNote(id: string) {
    setSelectionQueue((prev) => prev.filter((item) => item.id !== id))
    setQueueExpanded((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (activeSelectionId === id) {
      setActiveSelectionId(null)
      setSelectionNote('')
    }
  }

  function toggleQueueItem(id: string) {
    setQueueExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function updateQueuedNote(id: string, note: string) {
    setSelectionQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, note } : item))
    )
    if (activeSelectionId === id) {
      setSelectionNote(note)
    }
  }

  function handleSelectionNoteChange(value: string) {
    setSelectionNote(value)
    const text = selectionText.trim()
    if (!text) return

    if (!activeSelectionId) {
      if (!value.trim()) return
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setActiveSelectionId(id)
      setSelectionQueue((prev) => [...prev, { id, text, note: value }])
      return
    }

    setSelectionQueue((prev) => {
      const exists = prev.some((item) => item.id === activeSelectionId)
      if (!exists && value.trim()) {
        return [...prev, { id: activeSelectionId, text, note: value }]
      }
      return prev.map((item) =>
        item.id === activeSelectionId ? { ...item, text, note: value } : item
      )
    })
  }

  function resetEditorState() {
    setThreadId(null)
    setThreadContext({})
    setMessages([])
    setCanvasTabs([''])
    setActiveTab(0)
    setDraftSavedAt(null)
    setComposer('')
    setSelectionText('')
    setSelectionNote('')
    setSelectionQueue([])
    setActiveSelectionId(null)
    setQueueExpanded({})
    setPendingAutoApply(false)
    pendingAutoApplyRef.current = false
    setHighlightState(null)
    setFlashActive(false)
    setDraftVisibility({})
    setPromptPreviewOpen(false)
    setPromptPreview(null)
    setConversationOpen(false)
    setThreadHydrating(false)
    historyRef.current = {}
    setHistoryVersion((v) => v + 1)
  }

  function exitAssetView() {
    if (storageKey) {
      localStorage.removeItem(storageKey)
    }
    const params = new URLSearchParams(window.location.search)
    params.delete('thread')
    window.history.replaceState(null, '', `/studio?${params.toString()}`)
    resetEditorState()
  }

  function triggerCanvasHighlight(tabIndex: number, oldText: string, newText: string) {
    const diff = computeDiffRange(oldText, newText)
    if (!diff) return
    setHighlightState({ tab: tabIndex, ...diff })
    setFlashActive(true)
  }

  function applyDraftAuto(draft: string) {
    const split = splitDraftVersions(draft, versions)
    const targetTab = Math.min(activeTab, split.length - 1)
    const oldText = canvasTabs[targetTab] || ''
    const newText = split[targetTab] || ''
    setCanvasTabs(split)
    setActiveTab(targetTab)
    triggerCanvasHighlight(targetTab, oldText, newText)
  }

  function undoCanvas() {
    const history = historyRef.current[activeTab]
    if (!history || history.index <= 0) return
    historyLockRef.current = true
    const nextIndex = history.index - 1
    history.index = nextIndex
    const nextValue = history.entries[nextIndex] ?? ''
    setCanvasTabs((prev) => {
      const next = [...prev]
      next[activeTab] = nextValue
      return next
    })
    setHistoryVersion((v) => v + 1)
    requestAnimationFrame(() => {
      historyLockRef.current = false
    })
  }

  function redoCanvas() {
    const history = historyRef.current[activeTab]
    if (!history || history.index >= history.entries.length - 1) return
    historyLockRef.current = true
    const nextIndex = history.index + 1
    history.index = nextIndex
    const nextValue = history.entries[nextIndex] ?? ''
    setCanvasTabs((prev) => {
      const next = [...prev]
      next[activeTab] = nextValue
      return next
    })
    setHistoryVersion((v) => v + 1)
    requestAnimationFrame(() => {
      historyLockRef.current = false
    })
  }

  async function sendMessage() {
    if (!threadId || sending) return
    const text = composer.trim()
    const queuedNotes = selectionQueue.filter(
      (item) => item.text.trim().length > 0 && item.note.trim().length > 0
    )
    const hasQueuedNotes = queuedNotes.length > 0
    if (!text && !hasQueuedNotes) return
    setPendingAutoApply(hasQueuedNotes)
    pendingAutoApplyRef.current = hasQueuedNotes

    const notePayload = hasQueuedNotes
      ? queuedNotes
          .map((item, idx) => {
            return `Selection ${idx + 1}:\nText:\n${item.text}\nComment:\n${item.note}`
          })
          .join('\n\n')
      : ''

    const fullMessage = [
      text,
      notePayload ? '---\nEdit notes based on selected text:\n' + notePayload : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    setSending(true)
    setComposer('')
    setSelectionQueue([])
    setQueueExpanded({})
    setActiveSelectionId(null)
    clearSelection()
    setMessages((prev) => [...prev, { role: 'user', content: fullMessage }])
    setPromptPreviewOpen(false)
    if (text) {
      const derived = deriveThreadTitleFromMessage(text)
      if (derived) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId && !t.draft_title && !t.title ? { ...t, title: derived } : t
          )
        )
      }
    }

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
        body: JSON.stringify({ thread_id: threadId, message: fullMessage }),
      })
      const contentType = res.headers.get('content-type') || ''
      let data: any = null
      let rawText = ''
      if (contentType.includes('application/json')) {
        data = await res.json().catch(() => null)
      } else {
        rawText = await res.text().catch(() => '')
      }
      if (!res.ok) {
        const errorText = data?.error || rawText?.slice(0, 200) || 'Agent chat failed'
        throw new Error(errorText)
      }
      if (!data) {
        throw new Error('Unexpected response from server')
      }

      const assistantMessage = data.assistant_message
      const draft = extractDraftBlock(assistantMessage)
      const canvasEmpty = canvasRef.current.every((t) => !t.trim())
      const shouldAutoApply = pendingAutoApplyRef.current
      pendingAutoApplyRef.current = false
      setPendingAutoApply(false)

      setThreadContext((prev) => ({ ...prev, ...(data.thread_context || {}) }))
      setMessages((prev) => [...prev, { role: 'assistant', content: assistantMessage }])

      if (draft) {
        if (shouldAutoApply) {
          applyDraftAuto(draft)
        } else if (canvasEmpty) {
          insertDraftIntoCanvas(draft, 'replace')
        }
      }
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send'
      setMessages((prev) => [...prev, { role: 'tool', content: msg }])
    } finally {
      pendingAutoApplyRef.current = false
      setPendingAutoApply(false)
      setSending(false)
    }
  }

  async function handleNewAsset() {
    if (!selectedProduct) return
    const seedContext = threadContext || {}
    const newThread = await createThread(seedContext)
    if (!newThread) return
    setThreads((prev) => [newThread, ...prev])
    await loadThreadById(newThread.id)
  }

  async function handleDeleteThread(id: string) {
    if (!id) return
    if (!confirm('Delete this asset? This cannot be undone.')) return

    const res = await fetch(`/api/agent/threads/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data?.error || 'Failed to delete asset')
      return
    }

    const nextThreads = threads.filter((t) => t.id !== id)
    setThreads(nextThreads)

    if (id === threadId) {
      if (storageKey) {
        localStorage.removeItem(storageKey)
      }
      const params = new URLSearchParams(window.location.search)
      params.delete('thread')
      window.history.replaceState(null, '', `/studio?${params.toString()}`)

      if (nextThreads[0]) {
        await loadThreadById(nextThreads[0].id)
      } else {
        resetEditorState()
      }
    }
  }

  async function handleSelectThread(id: string) {
    if (!id || id === threadId) return
    await loadThreadById(id)
  }

  async function handleSaveDraft() {
    if (!threadId) return
    const payload = serializeDraftTabs(canvasTabs)
    const draftTitle = deriveDraftTitle(canvasTabs)
    setDraftSaving(true)
    await fetch(`/api/agent/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft_content: payload,
        draft_title: draftTitle,
      }),
    }).catch(() => {})
    const updatedAt = new Date().toISOString()
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, draft_title: draftTitle, draft_content: payload, updated_at: updatedAt }
          : t
      )
    )
    setDraftSaving(false)
    setDraftSavedAt(updatedAt)
  }

  function insertDraftIntoCanvas(draft: string, mode: 'replace' | 'append' = 'replace') {
    const split = splitDraftVersions(draft, versions)
    if (mode === 'replace') {
      setCanvasTabs(split)
      setActiveTab(0)
      return
    }

    setCanvasTabs((prev) => {
      const next = [...prev]
      if (versions === 1) {
        const base = next[activeTab] || ''
        const addition = split[0] || ''
        next[activeTab] = [base, addition].filter(Boolean).join('\n\n').trim()
        return next
      }

      split.forEach((chunk, idx) => {
        if (!chunk) return
        const base = next[idx] || ''
        next[idx] = [base, chunk].filter(Boolean).join('\n\n').trim()
      })
      return next
    })
  }

  function handleCanvasSelect(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    if (suppressSelectionRef.current) return
    const target = e.currentTarget
    const start = target.selectionStart || 0
    const end = target.selectionEnd || 0
    if (start === end) {
      setSelectionText('')
      setSelectionNote('')
      setActiveSelectionId(null)
      return
    }
    const text = target.value.slice(start, end).trim()
    if (!text) {
      setSelectionText('')
      setSelectionNote('')
      setActiveSelectionId(null)
      return
    }
    if (text !== selectionText) {
      setSelectionNote('')
      setActiveSelectionId(null)
    }
    setSelectionText(text)
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

  const promptModal = promptPreviewOpen && (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => setPromptPreviewOpen(false)}
      />
      <div className="absolute right-6 top-20 w-[620px] max-w-[92vw] max-h-[80vh] bg-[var(--editor-panel)] border border-[var(--editor-border)] rounded-2xl shadow-[0_24px_60px_-40px_var(--editor-shadow)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--editor-border)] flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
              Agent Prompt
            </p>
            <p className="text-sm font-semibold">Compiled context</p>
          </div>
          <button
            onClick={() => setPromptPreviewOpen(false)}
            className="editor-button-ghost text-xs"
          >
            Close
          </button>
        </div>
        <div className="p-4 overflow-auto max-h-[calc(80vh-3.5rem)]">
          {promptPreview ? (
            <pre className="whitespace-pre-wrap text-[12px] leading-5 text-[var(--editor-ink)]">
              {promptPreview}
            </pre>
          ) : (
            <p className="text-xs text-[var(--editor-ink-muted)]">No prompt preview available.</p>
          )}
        </div>
      </div>
    </div>
  )

  const conversationModal = conversationOpen && (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => setConversationOpen(false)}
      />
      <div className="absolute left-6 bottom-24 w-[620px] max-w-[92vw] max-h-[70vh] bg-[var(--editor-panel)] border border-[var(--editor-border)] rounded-2xl shadow-[0_24px_60px_-40px_var(--editor-shadow)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--editor-border)] flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
              Conversation
            </p>
            <p className="text-sm font-semibold">Full agent thread</p>
          </div>
          <button
            onClick={() => setConversationOpen(false)}
            className="editor-button-ghost text-xs"
          >
            Close
          </button>
        </div>
        <div className="p-4 overflow-auto max-h-[calc(70vh-3.5rem)] space-y-3">
          {messages.length === 0 ? (
            <p className="text-xs text-[var(--editor-ink-muted)]">No messages yet.</p>
          ) : (
            messages.map((m, idx) => (
              <div key={`${m.id || idx}`} className="rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-panel-muted)] p-3">
                <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--editor-ink-muted)]">
                  {m.role}
                </p>
                <pre className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-[var(--editor-ink)]">
                  {m.content}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )

  if (!threadId && !threadHydrating) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        {promptModal}
        {conversationModal}
        <div className="editor-panel w-full max-w-2xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
                Studio
              </p>
              <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
                Start a new asset or jump back into a recent one.
              </p>
            </div>
            <button onClick={handleNewAsset} className="editor-button">
              New Asset
            </button>
          </div>

          <div className="mt-6">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
              Recent Assets
            </p>
            <div className="mt-3 space-y-2 max-h-72 overflow-auto pr-1">
              {threadsLoading ? (
                <p className="text-[11px] text-[var(--editor-ink-muted)]">Loading...</p>
              ) : recentThreads.length === 0 ? (
                <p className="text-[11px] text-[var(--editor-ink-muted)]">
                  No assets yet. Create a new one to get started.
                </p>
              ) : (
                recentThreads.map((t) => {
                  const label = t.draft_title || t.title || 'Untitled draft'
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleSelectThread(t.id)}
                      className="w-full text-left rounded-full border border-[var(--editor-border)] px-3 py-2 text-[12px] text-[var(--editor-ink)] hover:border-[var(--editor-ink)] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">{label}</span>
                        <span className="text-[10px] text-[var(--editor-ink-muted)] whitespace-nowrap">
                          {t.updated_at ? new Date(t.updated_at).toLocaleDateString() : ''}
                        </span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      {promptModal}
      {conversationModal}
      <div className="flex-1 min-h-0 h-full grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 p-5 overflow-hidden">
        {/* Chat */}
        <section className="editor-panel flex flex-col overflow-hidden min-h-0">
          <div className="px-4 py-3 border-b border-[var(--editor-border)] bg-[var(--editor-panel)]/70">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button onClick={handleNewAsset} className="editor-button-ghost text-xs">
                  New Asset
                </button>
                {threadId && (
                  <button
                    onClick={() => handleDeleteThread(threadId)}
                    className="editor-button-ghost text-xs text-red-300"
                  >
                    Delete
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeSwipe && activeSwipe.status !== 'ready' && (
                  <span className="chat-chip chat-chip--muted">
                    Swipe {activeSwipe.status === 'failed' ? 'Failed' : 'Transcribing'}
                  </span>
                )}
                <button
                  onClick={exitAssetView}
                  className="editor-button-ghost text-xs"
                  aria-label="Close asset"
                >
                  X
                </button>
              </div>
            </div>
          </div>

          {!threadId ? (
            <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
              <p className="font-medium text-[var(--editor-ink)]">
                {threadHydrating ? 'Loading asset...' : 'No asset selected.'}
              </p>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-3">
                {messages.length === 0 ? null : (
                  messages.map((m, idx) => {
                    const isUser = m.role === 'user'
                    const isTool = m.role === 'tool'
                    const messageKey = m.id || `${idx}`
                    const draftParts = m.role === 'assistant' ? splitDraftMessage(m.content) : { before: m.content, draft: null, after: '' }
                    const draft = draftParts.draft
                    const showDraft = Boolean(draft) && Boolean(draftVisibility[messageKey])

                    return (
                      <div key={messageKey} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[88%] rounded-2xl px-4 py-3 ${
                            isUser
                              ? 'bg-[#353a36] text-[#f5f3ef]'
                              : isTool
                                ? 'bg-[var(--editor-panel-muted)] text-[var(--editor-ink)]'
                                : 'bg-[var(--editor-panel)] text-[var(--editor-ink)]'
                          }`}
                        >
                          {draftParts.before && (
                            <div className="editor-message">
                              {renderMarkdownBlocks(draftParts.before)}
                            </div>
                          )}

                          {draft && (
                            <div className="mt-3 rounded-2xl bg-[var(--editor-panel-muted)] p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[11px] font-semibold text-[var(--editor-ink)]">
                                  Draft captured
                                </div>
                                <button
                                  onClick={() =>
                                    setDraftVisibility((prev) => ({
                                      ...prev,
                                      [messageKey]: !prev[messageKey],
                                    }))
                                  }
                                  className="text-[11px] text-[var(--editor-ink-muted)] underline underline-offset-4"
                                >
                                  {showDraft ? 'Hide' : 'View'}
                                </button>
                              </div>

                              {showDraft && (
                                <div className="editor-message mt-2">
                                  {renderMarkdownBlocks(draft)}
                                </div>
                              )}

                              <div className="mt-3 flex items-center gap-2">
                                <button
                                  onClick={() => insertDraftIntoCanvas(draft, 'append')}
                                  className="editor-button-ghost text-xs"
                                >
                                  Insert
                                </button>
                                {canvasHasContent && (
                                  <button
                                    onClick={() => insertDraftIntoCanvas(draft, 'replace')}
                                    className="editor-button-ghost text-xs"
                                  >
                                    Replace
                                  </button>
                                )}
                                {versions > 1 && (
                                  <span className="text-[11px] text-[var(--editor-ink-muted)]">
                                    Splits by &quot;## Version N&quot;
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {draftParts.after && (
                            <div className="editor-message mt-3">
                              {renderMarkdownBlocks(draftParts.after)}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="p-4 border-t border-[var(--editor-border)] bg-[var(--editor-panel)]/70">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    sendMessage()
                  }}
                  className="flex flex-col gap-3"
                >
                  <div>
                    {selectionText && (
                      <div className="mb-3 rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-panel-muted)] p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-[var(--editor-ink)]">
                            Selected text
                          </span>
                          <button
                            type="button"
                            onClick={clearSelection}
                            className="text-[11px] text-[var(--editor-ink-muted)] underline underline-offset-4"
                          >
                            Clear
                          </button>
                        </div>
                        <div className="text-[12px] text-[var(--editor-ink)] leading-5 max-h-20 overflow-auto whitespace-pre-wrap">
                          {selectionText}
                        </div>
                        <textarea
                          value={selectionNote}
                          onChange={(e) => handleSelectionNoteChange(e.target.value)}
                          placeholder="Add a note about what to change..."
                          rows={2}
                          className="editor-input w-full text-[12px] leading-5 resize-none"
                        />
                        <span className="text-[10px] text-[var(--editor-ink-muted)]">
                          Autosaved to queued edits.
                        </span>
                      </div>
                    )}

                    {selectionQueue.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--editor-ink-muted)]">
                          Queued edits ({selectionQueue.length})
                        </p>
                        <div className="mt-2 space-y-2 max-h-44 overflow-auto pr-1">
                          {selectionQueue.map((item, idx) => {
                            const expanded = Boolean(queueExpanded[item.id])
                            const preview = item.note.trim() || item.text.trim() || `Edit ${idx + 1}`
                            const secondary = item.note.trim() ? item.text : 'Add a note'
                            return (
                              <div
                                key={item.id}
                                className="rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-panel-muted)]"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleQueueItem(item.id)}
                                  className="w-full flex items-start justify-between gap-3 px-3 py-2 text-left"
                                  aria-expanded={expanded}
                                >
                                  <div className="min-w-0">
                                    <p className="text-[12px] font-semibold text-[var(--editor-ink)] truncate">
                                      {preview}
                                    </p>
                                    <p className="text-[11px] text-[var(--editor-ink-muted)] truncate">
                                      {secondary}
                                    </p>
                                  </div>
                                  <span className="text-[11px] text-[var(--editor-ink-muted)] underline underline-offset-4 whitespace-nowrap">
                                    {expanded ? 'Collapse' : 'Edit'}
                                  </span>
                                </button>

                                {expanded && (
                                  <div className="px-3 pb-3 space-y-2">
                                    <div className="text-[12px] text-[var(--editor-ink)] leading-5 max-h-24 overflow-auto whitespace-pre-wrap">
                                      {item.text}
                                    </div>
                                    <textarea
                                      value={item.note}
                                      onChange={(e) => updateQueuedNote(item.id, e.target.value)}
                                      placeholder="Add a note about what to change..."
                                      rows={2}
                                      className="editor-input w-full text-[12px] leading-5 resize-none"
                                    />
                                    <div className="flex items-center justify-between">
                                      <button
                                        type="button"
                                        onClick={() => removeSelectionNote(item.id)}
                                        className="text-[11px] text-red-300 underline underline-offset-4"
                                      >
                                        Delete
                                      </button>
                                      <span className="text-[10px] text-[var(--editor-ink-muted)]">
                                        Autosaved
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <textarea
                      value={composer}
                      onChange={(e) => setComposer(e.target.value)}
                      placeholder="Message the agent..."
                      rows={2}
                      className="editor-input w-full text-[13px] leading-5 resize-none"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setConversationOpen(true)}
                      className="editor-icon-ghost"
                      aria-label="View conversation"
                      title="View conversation"
                    >
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
                        <path
                          d="M4 5h12a3 3 0 013 3v8a3 3 0 01-3 3H9l-5 4V8a3 3 0 013-3z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="submit"
                      className="editor-icon-button"
                      disabled={!threadId || sending || (!composer.trim() && !hasQueuedNotes)}
                      aria-label={pendingAutoApply ? 'Send queued edits' : 'Send message'}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M12 4l6 6-1.4 1.4-3.6-3.6V20h-2V7.8L7.4 11.4 6 10l6-6z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  </div>
                </form>
              </div>
            </>
          )}
        </section>

        {/* Draft Canvas */}
        <section className="editor-panel flex flex-col overflow-hidden min-h-0">
          <div className="flex-1 overflow-auto p-6">
            <textarea
              ref={canvasTextareaRef}
              value={canvasTabs[activeTab] || ''}
              onChange={(e) => {
                const val = e.target.value
                setCanvasTabs((prev) => {
                  const next = [...prev]
                  next[activeTab] = val
                  return next
                })
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
                  e.preventDefault()
                  if (e.shiftKey) {
                    redoCanvas()
                  } else {
                    undoCanvas()
                  }
                }
              }}
              onSelect={handleCanvasSelect}
              onMouseUp={handleCanvasSelect}
              placeholder={
                threadId
                  ? 'Your draft lives here. Ask the agent for a draft, then insert it.'
                  : 'Create an asset to start drafting.'
              }
              disabled={!threadId}
              className={`w-full h-full min-h-[520px] p-5 rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-canvas)] text-[13px] leading-6 text-[var(--editor-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--editor-accent)] resize-none ${
                flashActive && highlightState?.tab === activeTab ? 'editor-flash' : ''
              }`}
            />
          </div>

          <div className="px-6 py-4 border-t border-[var(--editor-border)] flex items-center justify-between gap-3">
            {versions > 1 ? (
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
            ) : (
              <span className="text-[11px] text-[var(--editor-ink-muted)]">Draft</span>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={undoCanvas}
                disabled={!canUndo}
                className="editor-icon-ghost"
                aria-label="Undo"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M7.8 7H4l4-4 4 4H8.8c4.4 0 7.2 1.2 9.2 3.2C19.7 11.9 21 14.5 21 18h-2c0-3-1-5-2.4-6.4C15.1 10.1 12.8 9 8.8 9H7.8V7z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                onClick={redoCanvas}
                disabled={!canRedo}
                className="editor-icon-ghost"
                aria-label="Redo"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M16.2 7H20l-4-4-4 4h3.2v2h-1c-4 0-6.3 1.1-7.8 2.6C4.9 13 4 15 4 18h2c0-3 0.8-5 2-6.4C9.2 10 11.1 9 14.2 9h1V7z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              {draftSavedAt && (
                <span className="text-[11px] text-[var(--editor-ink-muted)]">
                  Saved {new Date(draftSavedAt).toLocaleTimeString()}
                </span>
              )}
              <button onClick={handleSaveDraft} disabled={!threadId || draftSaving} className="editor-button text-xs">
                {draftSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
