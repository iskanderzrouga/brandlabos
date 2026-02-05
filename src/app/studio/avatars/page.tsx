'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAppContext } from '@/components/app-shell'
import { ConfirmDialog, FeedbackNotice } from '@/components/ui/feedback'

interface Avatar {
  id: string
  name: string
  content: string
  is_active: boolean
}

function getPreview(content: string | undefined): string {
  if (!content) return 'No content'
  const lines = content
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#') && !line.startsWith('---'))
  return lines.join(' ').slice(0, 160) || 'No preview'
}

export default function AvatarsPage() {
  const { selectedProduct, openContextDrawer } = useAppContext()
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'info' | 'success' | 'error'; message: string } | null>(null)
  const [avatarToDelete, setAvatarToDelete] = useState<string | null>(null)
  const [deletingAvatar, setDeletingAvatar] = useState(false)

  const sortedAvatars = useMemo(() => {
    return [...avatars].sort((a, b) => Number(b.is_active) - Number(a.is_active))
  }, [avatars])

  useEffect(() => {
    let active = true
    const load = async () => {
      if (!selectedProduct) {
        if (active) {
          setAvatars([])
          setLoading(false)
        }
        return
      }
      setLoading(true)
      try {
        const res = await fetch(`/api/avatars?product_id=${selectedProduct}`)
        const data = await res.json().catch(() => [])
        if (!active) return
        setAvatars(Array.isArray(data) ? data : [])
      } catch {
        if (!active) return
        setAvatars([])
        setFeedback({ tone: 'error', message: 'Failed to load avatars.' })
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [selectedProduct])

  async function toggleActive(id: string, currentState: boolean) {
    const res = await fetch(`/api/avatars/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !currentState }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setFeedback({ tone: 'error', message: data?.error || 'Failed to update avatar' })
      return
    }
    setAvatars((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: !currentState } : a)))
    setFeedback({ tone: 'success', message: 'Avatar updated.' })
  }

  async function deleteAvatar(id: string) {
    if (deletingAvatar) return
    setDeletingAvatar(true)
    try {
      const res = await fetch(`/api/avatars/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFeedback({ tone: 'error', message: data?.error || 'Failed to delete avatar' })
        return
      }
      setAvatars((prev) => prev.filter((a) => a.id !== id))
      setFeedback({ tone: 'success', message: 'Avatar deleted.' })
    } catch {
      setFeedback({ tone: 'error', message: 'Failed to delete avatar' })
    } finally {
      setDeletingAvatar(false)
    }
  }

  if (!selectedProduct) {
    return (
      <div className="h-full flex items-center justify-center p-10">
        <div className="editor-panel p-8 max-w-lg w-full text-center">
          <p className="font-serif text-2xl">Select a product</p>
          <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
            Avatars are managed per product.
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

        <div className="flex items-center justify-between mb-6 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
              Audience
            </p>
            <h1 className="font-serif text-3xl leading-tight">Avatars</h1>
          </div>
          <Link href="/studio/avatars/new" className="editor-button text-sm">
            New Avatar
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--editor-ink-muted)]">Loading...</p>
        ) : sortedAvatars.length === 0 ? (
          <div className="editor-panel-soft p-8 text-center">
            <p className="text-sm text-[var(--editor-ink-muted)] mb-3">No avatars yet.</p>
            <Link href="/studio/avatars/new" className="editor-button-ghost text-xs">
              Create First Avatar
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {sortedAvatars.map((avatar) => (
              <div key={avatar.id} className="editor-panel p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[var(--editor-ink)]">{avatar.name}</h3>
                  <button
                    onClick={() => toggleActive(avatar.id, avatar.is_active)}
                    className={`chat-chip ${avatar.is_active ? 'chat-chip--accent' : 'chat-chip--muted'}`}
                  >
                    {avatar.is_active ? 'Active' : 'Inactive'}
                  </button>
                </div>

                <p className="text-sm text-[var(--editor-ink-muted)] mt-3 leading-6">
                  {getPreview(avatar.content)}
                </p>

                <div className="mt-4 flex items-center gap-2">
                  <Link href={`/studio/avatars/${avatar.id}`} className="editor-button-ghost text-xs">
                    Edit
                  </Link>
                  <button
                    onClick={() => setAvatarToDelete(avatar.id)}
                    className="editor-button-ghost text-xs text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(avatarToDelete)}
        title="Delete this avatar?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={deletingAvatar}
        onCancel={() => setAvatarToDelete(null)}
        onConfirm={() => {
          if (!avatarToDelete) return
          void deleteAvatar(avatarToDelete).then(() => setAvatarToDelete(null))
        }}
      />
    </div>
  )
}
