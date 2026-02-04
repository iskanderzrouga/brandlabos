'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

type SwipeRow = {
  id: string
  status: 'processing' | 'ready' | 'failed'
  title?: string | null
  summary?: string | null
  transcript?: string | null
  source_url?: string | null
  error_message?: string | null
  created_at?: string
}

export default function SwipeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = String((params as any)?.id || '')

  const [loading, setLoading] = useState(true)
  const [swipe, setSwipe] = useState<SwipeRow | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)

  const statusLabel = useMemo(() => {
    if (!swipe) return ''
    if (swipe.status === 'ready') return 'Ready'
    if (swipe.status === 'failed') return 'Failed'
    return 'Processing'
  }, [swipe])

  async function handleDelete() {
    if (!confirm('Delete this swipe? This cannot be undone.')) return
    const res = await fetch(`/api/swipes/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data?.error || 'Failed to delete swipe')
      return
    }
    router.push('/studio/swipes')
  }

  useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true)
      setVideoUrl(null)
      try {
        const res = await fetch(`/api/swipes/${id}?full=1`)
        const data = await res.json()
        if (!active) return
        if (!res.ok) throw new Error(data?.error || 'Failed')
        setSwipe(data)
      } catch {
        setSwipe(null)
      } finally {
        if (active) setLoading(false)
      }
    }
    if (id) run()
    return () => {
      active = false
    }
  }, [id])

  useEffect(() => {
    let active = true
    const run = async () => {
      if (!swipe || swipe.status !== 'ready') return
      try {
        const res = await fetch(`/api/swipes/${swipe.id}/video-url`)
        const data = await res.json()
        if (!active) return
        if (res.ok && data?.url) setVideoUrl(data.url)
      } catch {
        // ignore
      }
    }
    run()
    return () => {
      active = false
    }
  }, [swipe])

  if (loading) {
    return (
      <div className="h-full p-6">
        <p className="text-sm text-[var(--editor-ink-muted)]">Loading...</p>
      </div>
    )
  }

  if (!swipe) {
    return (
      <div className="h-full p-6">
        <div className="editor-panel p-6 max-w-xl">
          <p className="font-serif text-xl">Swipe not found</p>
          <Link href="/studio/swipes" className="text-sm text-[var(--editor-accent)] mt-3 inline-block">
            Back to swipes
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
              Swipe
            </p>
            <h1 className="font-serif text-3xl leading-tight truncate">
              {swipe.title || 'Untitled swipe'}
            </h1>
            {swipe.source_url && (
              <a
                href={swipe.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[var(--editor-ink-muted)] underline mt-2 inline-block truncate max-w-full"
              >
                {swipe.source_url}
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`editor-tag ${
                swipe.status === 'ready' ? 'editor-tag--note' : 'editor-tag--warning'
              }`}
            >
              {statusLabel}
            </span>
            <button onClick={handleDelete} className="editor-button-ghost text-xs text-red-300">
              Delete
            </button>
            <Link href={`/studio?swipe=${swipe.id}`} className="editor-button-ghost text-xs">
              Use in Generate
            </Link>
            <Link href="/studio/swipes" className="editor-button-ghost text-xs">
              Back
            </Link>
          </div>
        </div>

        {swipe.summary && (
          <div className="editor-panel p-5">
            <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
              Summary
            </p>
            <p className="text-sm leading-7 mt-2">{swipe.summary}</p>
          </div>
        )}

        <div className="editor-panel p-5">
          <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
            Video
          </p>

          {swipe.status === 'ready' && videoUrl ? (
            <div className="mt-3">
              <video src={videoUrl} controls className="w-full rounded-2xl border border-[var(--editor-border)]" />
            </div>
          ) : swipe.status === 'processing' ? (
            <p className="text-sm text-[var(--editor-ink-muted)] mt-3">
              Processing... video will appear when ready.
            </p>
          ) : swipe.status === 'failed' ? (
            <p className="text-sm text-red-700 mt-3">
              Failed: {swipe.error_message || 'Unknown error'}
            </p>
          ) : (
            <p className="text-sm text-[var(--editor-ink-muted)] mt-3">
              Video not available yet.
            </p>
          )}
        </div>

        <div className="editor-panel p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
                Transcript
              </p>
              <p className="text-xs text-[var(--editor-ink-muted)] mt-1">
                Hidden by default so you can skim the swipe first.
              </p>
            </div>
            <button onClick={() => setShowTranscript((v) => !v)} className="editor-button-ghost text-xs">
              {showTranscript ? 'Hide' : 'Show'}
            </button>
          </div>

          {showTranscript && (
            <pre className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[var(--editor-ink)] bg-[var(--editor-panel-muted)] border border-[var(--editor-border)] rounded-2xl p-4 overflow-auto">
              {swipe.transcript || '(no transcript yet)'}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
