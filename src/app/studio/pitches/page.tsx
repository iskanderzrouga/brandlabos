'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/components/app-shell'
import { ConfirmDialog, FeedbackNotice } from '@/components/ui/feedback'

interface Pitch {
  id: string
  name: string
  content: string
  is_active: boolean
  created_at: string
}

export default function PitchesPage() {
  const { selectedProduct, openContextDrawer } = useAppContext()
  const [pitches, setPitches] = useState<Pitch[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'info' | 'success' | 'error'; message: string } | null>(null)
  const [pitchToDelete, setPitchToDelete] = useState<string | null>(null)
  const [deletingPitch, setDeletingPitch] = useState(false)

  const sortedPitches = useMemo(() => {
    return [...pitches].sort((a, b) => Number(b.is_active) - Number(a.is_active))
  }, [pitches])

  useEffect(() => {
    let active = true
    const run = async () => {
      if (!selectedProduct) {
        if (active) {
          setPitches([])
          setLoading(false)
        }
        return
      }

      setLoading(true)
      try {
        const res = await fetch(`/api/pitches?product_id=${selectedProduct}`)
        const data = await res.json().catch(() => [])
        if (!active) return
        setPitches(Array.isArray(data) ? data : [])
      } catch {
        if (!active) return
        setPitches([])
        setFeedback({ tone: 'error', message: 'Failed to load positioning.' })
      } finally {
        if (active) setLoading(false)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [selectedProduct])

  function resetForm() {
    setName('')
    setContent('')
  }

  function loadPitchIntoForm(pitch: Pitch) {
    setName(pitch.name)
    setContent(pitch.content)
  }

  async function handleCreate() {
    if (!selectedProduct || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/pitches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          name,
          content,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to create positioning')

      setPitches((prev) => [data, ...prev])
      setCreating(false)
      resetForm()
      setFeedback({ tone: 'success', message: 'Positioning created.' })
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to create positioning',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate() {
    if (!editingId || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/pitches/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      })
      const updated = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(updated?.error || 'Failed to update positioning')
      setPitches((prev) => prev.map((p) => (p.id === editingId ? updated : p)))
      setEditingId(null)
      resetForm()
      setFeedback({ tone: 'success', message: 'Positioning updated.' })
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to update positioning',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (deletingPitch) return
    setDeletingPitch(true)
    try {
      const res = await fetch(`/api/pitches/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to delete positioning')
      }
      setPitches((prev) => prev.filter((p) => p.id !== id))
      setFeedback({ tone: 'success', message: 'Positioning deleted.' })
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete positioning',
      })
    } finally {
      setDeletingPitch(false)
    }
  }

  async function handleToggleActive(pitch: Pitch) {
    const res = await fetch(`/api/pitches/${pitch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !pitch.is_active }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setFeedback({ tone: 'error', message: data?.error || 'Failed to update positioning' })
      return
    }
    const updated = await res.json()
    setPitches((prev) => prev.map((p) => (p.id === pitch.id ? updated : p)))
  }

  if (!selectedProduct) {
    return (
      <div className="h-full flex items-center justify-center p-10">
        <div className="editor-panel p-8 max-w-lg w-full text-center">
          <p className="font-serif text-2xl">Select a product</p>
          <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
            Positioning is managed per product.
          </p>
          <button onClick={openContextDrawer} className="editor-button mt-6">
            Open Context
          </button>
        </div>
      </div>
    )
  }

  const isFormOpen = creating || Boolean(editingId)

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
              Strategy
            </p>
            <h1 className="font-serif text-3xl leading-tight">Positioning</h1>
            <p className="text-sm text-[var(--editor-ink-muted)] mt-1">
              Define angles and value propositions for the agent.
            </p>
          </div>
          {!isFormOpen && (
            <button
              onClick={() => {
                resetForm()
                setCreating(true)
              }}
              className="editor-button text-sm"
            >
              New Positioning
            </button>
          )}
        </div>

        {isFormOpen && (
          <div className="editor-panel p-5 mb-6 space-y-4">
            <h2 className="text-sm font-semibold text-[var(--editor-ink)]">
              {creating ? 'New Positioning' : 'Edit Positioning'}
            </h2>
            <div>
              <label className="block text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)] mb-2">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Prevent stains before they start"
                className="editor-input w-full text-sm"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)] mb-2">
                Positioning Content
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={7}
                className="editor-input w-full text-sm resize-none"
                placeholder="Describe the angle, mechanism, and emotional promise."
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={creating ? handleCreate : handleUpdate}
                disabled={saving || !name.trim() || !content.trim()}
                className="editor-button text-xs"
              >
                {saving ? 'Saving...' : creating ? 'Create' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setCreating(false)
                  setEditingId(null)
                  resetForm()
                }}
                className="editor-button-ghost text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[var(--editor-ink-muted)]">Loading...</p>
        ) : sortedPitches.length === 0 ? (
          <div className="editor-panel-soft p-8 text-center">
            <p className="text-sm text-[var(--editor-ink-muted)]">
              No positioning yet. Create one to guide the agent.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {sortedPitches.map((pitch) => (
              <div key={pitch.id} className="editor-panel p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[var(--editor-ink)]">{pitch.name}</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(pitch)}
                      className={`chat-chip ${pitch.is_active ? 'chat-chip--accent' : 'chat-chip--muted'}`}
                    >
                      {pitch.is_active ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(pitch.id)
                        setCreating(false)
                        loadPitchIntoForm(pitch)
                      }}
                      className="editor-button-ghost text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setPitchToDelete(pitch.id)}
                      className="editor-button-ghost text-xs text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-sm text-[var(--editor-ink-muted)] leading-6 mt-3 whitespace-pre-wrap">
                  {pitch.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pitchToDelete)}
        title="Delete this positioning?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={deletingPitch}
        onCancel={() => setPitchToDelete(null)}
        onConfirm={() => {
          if (!pitchToDelete) return
          void handleDelete(pitchToDelete).then(() => setPitchToDelete(null))
        }}
      />
    </div>
  )
}
