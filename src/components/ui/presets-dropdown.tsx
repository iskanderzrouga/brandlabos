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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
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
  }

  function handleToggle() {
    if (open) {
      setOpen(false)
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

  const presets = entries.filter((e) => getPresetName(e))
  const unnamed = entries.filter((e) => !getPresetName(e))

  function renderEntry(entry: HistoryEntry, label: string) {
    return (
      <div
        key={entry.id}
        className="flex items-center justify-between px-3 py-2 text-xs border-b border-[var(--editor-border)] last:border-b-0 hover:bg-[var(--editor-accent-soft)] transition-colors"
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
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            deleteEntry(entry.id)
          }}
          className="ml-2 text-[var(--editor-ink-muted)] hover:text-red-400 shrink-0"
          title="Delete"
        >
          &times;
        </button>
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
