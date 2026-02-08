'use client'

import { useEffect, useRef, useState } from 'react'

type HistoryEntry = {
  id: string
  content: string
  version: number
  updated_at: string
  metadata?: { preset_name?: string; key?: string }
}

type PresetsDropdownProps = {
  metadataKey: string
  scope: string
  onRestore: (content: string) => void
  disabled?: boolean
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
        `/api/prompt-blocks?scope=${scope}&include_history=true&active_only=false&metadata_key=${encodeURIComponent(metadataKey)}`
      )
      const data = await res.json()
      if (!Array.isArray(data)) {
        setEntries([])
        return
      }
      // Filter to inactive entries only (history, not current active)
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
    const meta = typeof entry.metadata === 'object' && entry.metadata ? entry.metadata : null
    return meta?.preset_name || null
  }

  const presets = entries.filter((e) => getPresetName(e))
  const unnamed = entries.filter((e) => !getPresetName(e))

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
              {presets.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    onRestore(entry.content)
                    setOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--editor-accent-soft)] transition-colors border-b border-[var(--editor-border)] last:border-b-0"
                >
                  <div className="font-medium text-[var(--editor-ink)]">{getPresetName(entry)}</div>
                  <div className="text-[var(--editor-ink-muted)]">{formatDate(entry.updated_at)}</div>
                </button>
              ))}
              {presets.length > 0 && unnamed.length > 0 && (
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--editor-ink-muted)] bg-[var(--editor-panel-muted)]">
                  Previous versions
                </div>
              )}
              {unnamed.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    onRestore(entry.content)
                    setOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--editor-accent-soft)] transition-colors border-b border-[var(--editor-border)] last:border-b-0"
                >
                  <div className="font-medium text-[var(--editor-ink)]">
                    Version {entry.version}
                  </div>
                  <div className="text-[var(--editor-ink-muted)]">{formatDate(entry.updated_at)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
