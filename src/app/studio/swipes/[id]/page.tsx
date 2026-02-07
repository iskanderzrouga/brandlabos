'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ConfirmDialog, FeedbackNotice } from '@/components/ui/feedback'

const STALE_MS = 10 * 60 * 1000

type SwipeRow = {
  id: string
  status: 'processing' | 'ready' | 'failed'
  title?: string | null
  summary?: string | null
  transcript?: string | null
  source_url?: string | null
  error_message?: string | null
  headline?: string | null
  ad_copy?: string | null
  cta?: string | null
  media_type?: string | null
  created_at?: string
  updated_at?: string
  job_id?: string | null
  job_status?: 'queued' | 'running' | 'completed' | 'failed' | null
  job_error_message?: string | null
  job_updated_at?: string | null
}

function toMillis(value?: string | null) {
  if (!value) return 0
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

export default function SwipeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = String((params as any)?.id || '')

  const [loading, setLoading] = useState(true)
  const [swipe, setSwipe] = useState<SwipeRow | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [showTranscript, setShowTranscript] = useState(true)
  const [feedback, setFeedback] = useState<{ tone: 'info' | 'success' | 'error'; message: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const stale = useMemo(() => {
    if (!swipe || swipe.status !== 'processing') return false
    const referenceMs =
      toMillis(swipe.job_updated_at) || toMillis(swipe.updated_at) || toMillis(swipe.created_at)
    if (!referenceMs) return false
    return Date.now() - referenceMs > STALE_MS
  }, [swipe])

  const statusLabel = useMemo(() => {
    if (!swipe) return ''
    if (swipe.status === 'ready') return 'Ready'
    if (swipe.status === 'failed') return 'Failed'
    if (stale) return 'Stuck'
    if (swipe.job_status === 'queued') return 'Queued'
    if (swipe.job_status === 'running') return 'Running'
    return 'Processing'
  }, [stale, swipe])

  const canRetry = Boolean(swipe && swipe.status !== 'ready')

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/swipes/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFeedback({ tone: 'error', message: data?.error || 'Failed to delete swipe' })
        return
      }
      router.push('/studio/swipes')
    } catch {
      setFeedback({ tone: 'error', message: 'Failed to delete swipe' })
    } finally {
      setDeleting(false)
    }
  }

  async function handleRetry() {
    if (!id || retrying) return
    setRetrying(true)
    try {
      const res = await fetch(`/api/swipes/${id}/retry`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to retry swipe')
      setFeedback({ tone: 'success', message: 'Swipe re-queued.' })
      const refreshed = await fetch(`/api/swipes/${id}?full=1`)
      const refreshedData = await refreshed.json().catch(() => null)
      if (refreshed.ok && refreshedData) setSwipe(refreshedData)
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to retry swipe',
      })
    } finally {
      setRetrying(false)
    }
  }

  useEffect(() => {
    let active = true
    const run = async () => {
      if (!loading) {
        // Silent refresh — don't flash loading state
      } else {
        setVideoUrl(null)
        setLoadError(null)
      }
      try {
        const res = await fetch(`/api/swipes/${id}?full=1`)
        const data = await res.json().catch(() => ({}))
        if (!active) return
        if (!res.ok) throw new Error(data?.error || 'Failed')
        setSwipe(data)
      } catch (error) {
        if (!active) return
        if (loading) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load swipe')
          setSwipe(null)
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    if (id) run()

    // Auto-poll every 5s while not ready
    const interval = setInterval(() => {
      if (active && id) run()
    }, 5000)

    return () => {
      active = false
      clearInterval(interval)
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
          <p className="font-serif text-xl">
            {loadError ? 'Could not load swipe' : 'Swipe not found'}
          </p>
          {loadError && (
            <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
              {loadError}
            </p>
          )}
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
        {feedback && (
          <FeedbackNotice
            message={feedback.message}
            tone={feedback.tone}
            onDismiss={() => setFeedback(null)}
          />
        )}
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
            {canRetry && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="editor-button-ghost text-xs text-[var(--editor-accent)]"
              >
                {retrying ? 'Retrying...' : 'Retry'}
              </button>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              className="editor-button-ghost text-xs text-red-300"
            >
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

        {(swipe.headline || swipe.ad_copy || swipe.cta) && (
          <div className="editor-panel p-5 space-y-4">
            <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--editor-ink-muted)]">
              Ad Copy
            </p>
            {swipe.headline && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
                  Headline
                </p>
                <p className="text-sm font-semibold leading-6 mt-1">{swipe.headline}</p>
              </div>
            )}
            {swipe.ad_copy && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
                  Body
                </p>
                <p className="text-sm leading-6 mt-1 whitespace-pre-wrap">{swipe.ad_copy}</p>
              </div>
            )}
            {swipe.cta && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
                  CTA
                </p>
                <span className="inline-block mt-1 text-xs font-medium px-3 py-1.5 rounded-full border border-[var(--editor-border)] text-[var(--editor-ink)]">
                  {swipe.cta}
                </span>
              </div>
            )}
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
              {stale ? 'Processing appears stuck. Use Retry to re-queue this swipe.' : 'Processing... video will appear when ready.'}
            </p>
          ) : swipe.status === 'failed' ? (
            <p className="text-sm text-red-700 mt-3">
              Failed: {swipe.job_error_message || swipe.error_message || 'Unknown error'}
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
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this swipe?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          void handleDelete().then(() => setConfirmDelete(false))
        }}
      />
    </div>
  )
}
