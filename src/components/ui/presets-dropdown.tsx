'use client'

import { useEffect, useRef, useState } from 'react'

type HistoryEntry = {
  id: string
  content: string
  version: number
  updated_at: string
  metadata?: Record<string, any> | string
}

type PresetsDropdownProps = {
  metadataKey: string
  scope: string
  onRestore: (content: string) => void
  disabled?: boolean
}

function parseMeta(raw: any): Record<string, any> | null {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  if (typeof raw === 'object' && raw) return raw
  return null
}

export function PresetsDropdown({ metadataKey, scope, onRestore, disabled }: PresetsDropdownProps) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirmDeleteId(null)
        setRenamingId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  async function fetchHistory() {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/prompt-blocks?scope=${scope}&include_history=true&active_only=false&user_override=true&metadata_key=${encodeURIComponent(metadataKey)}`
      )
      const data = await res.json()
      if (!Array.isArray(data)) {
        setEntries([])
        return
      }
      const inactive = data
        .filter((row: any) => !row.is_active)
        .slice(0, 10)
      setEntries(inactive)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  async function deleteEntry(id: string) {
    try {
      const res = await fetch(`/api/prompt-blocks/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id))
      }
    } catch { /* ignore */ }
    setConfirmDeleteId(null)
  }

  async function renameEntry(entry: HistoryEntry, newName: string) {
    const meta = parseMeta(entry.metadata) || {}
    const updatedMeta = { ...meta, preset_name: newName.trim() || undefined }
    if (!newName.trim()) delete updatedMeta.preset_name
    try {
      const res = await fetch(`/api/prompt-blocks/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: updatedMeta }),
      })
      if (res.ok) {
        setEntries((prev) =>
          prev.map((e) => e.id === entry.id ? { ...e, metadata: updatedMeta } : e)
        )
      }
    } catch { /* ignore */ }
    setRenamingId(null)
  }

  function handleToggle() {
    if (open) {
      setOpen(false)
      setConfirmDeleteId(null)
      setRenamingId(null)
    } else {
      setOpen(true)
      fetchHistory()
    }
  }

  function formatDate(dateStr: string) {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return ''
    }
  }

  function getPresetName(entry: HistoryEntry) {
    const meta = parseMeta(entry.metadata)
    return meta?.preset_name || null
  }

  function startRename(entry: HistoryEntry) {
    setRenamingId(entry.id)
    setRenameValue(getPresetName(entry) || `Version ${entry.version}`)
    setConfirmDeleteId(null)
  }

  const presets = entries.filter((e) => getPresetName(e))
  const unnamed = entries.filter((e) => !getPresetName(e))

  function renderEntry(entry: HistoryEntry, label: string) {
    const isConfirming = confirmDeleteId === entry.id
    const isRenaming = renamingId === entry.id

    if (isConfirming) {
      return (
        <div
          key={entry.id}
          className="flex items-center justify-between px-3 py-2 text-xs border-b border-[var(--editor-border)] last:border-b-0 bg-[rgba(181,56,56,0.06)]"
        >
          <span className="text-[var(--editor-ink)]">Delete this version?</span>
          <div className="flex items-center gap-1.5 ml-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); deleteEntry(entry.id) }}
              className="text-red-400 hover:text-red-300 font-medium"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }}
              className="text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)]"
            >
              No
            </button>
          </div>
        </div>
      )
    }

    if (isRenaming) {
      return (
        <div
          key={entry.id}
          className="px-3 py-2 text-xs border-b border-[var(--editor-border)] last:border-b-0"
        >
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') renameEntry(entry, renameValue)
              if (e.key === 'Escape') setRenamingId(null)
            }}
            onBlur={() => renameEntry(entry, renameValue)}
            className="editor-input w-full text-xs"
            autoFocus
          />
        </div>
      )
    }

    return (
      <div
        key={entry.id}
        className="group flex items-center justify-between px-3 py-2 text-xs border-b border-[var(--editor-border)] last:border-b-0 hover:bg-[var(--editor-accent-soft)] transition-colors"
      >
        <button
          type="button"
          onClick={() => {
            onRestore(entry.content)
            setOpen(false)
          }}
          className="flex-1 text-left min-w-0"
        >
          <div className="font-medium text-[var(--editor-ink)] truncate">{label}</div>
          <div className="text-[var(--editor-ink-muted)]">{formatDate(entry.updated_at)}</div>
        </button>
        <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); startRename(entry) }}
            className="text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)]"
            title="Rename"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(entry.id); setRenamingId(null) }}
            className="text-[var(--editor-ink-muted)] hover:text-red-400"
            title="Delete"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className="editor-button-ghost text-xs"
      >
        History
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-[var(--editor-border)] bg-[var(--editor-panel)] shadow-[0_12px_32px_-8px_var(--editor-shadow)] overflow-hidden">
          {loading ? (
            <div className="p-3 text-xs text-[var(--editor-ink-muted)]">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="p-3 text-xs text-[var(--editor-ink-muted)]">No version history</div>
          ) : (
            <div className="max-h-64 overflow-auto">
              {presets.map((entry) => renderEntry(entry, getPresetName(entry)!))}
              {presets.length > 0 && unnamed.length > 0 && (
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--editor-ink-muted)] bg-[var(--editor-panel-muted)]">
                  Previous versions
                </div>
              )}
              {unnamed.map((entry) => renderEntry(entry, `Version ${entry.version}`))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
