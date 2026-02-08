'use client'

import { useState } from 'react'

type ResetPresetModalProps = {
  open: boolean
  blockLabel: string
  onReset: (presetName: string | null) => void
  onCancel: () => void
  busy?: boolean
}

export function ResetPresetModal({
  open,
  blockLabel,
  onReset,
  onCancel,
  busy = false,
}: ResetPresetModalProps) {
  const [savePreset, setSavePreset] = useState(false)
  const [presetName, setPresetName] = useState('')

  if (!open) return null

  const defaultName = `Backup — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={onCancel} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-panel)] p-5 shadow-[0_24px_56px_-28px_var(--editor-shadow)]">
          <h2 className="text-base font-semibold text-[var(--editor-ink)]">Reset to Default</h2>
          <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
            This will replace your current content for <strong>{blockLabel}</strong> with the built-in default.
          </p>

          <label className="flex items-center gap-2 mt-4 cursor-pointer text-sm text-[var(--editor-ink)]">
            <input
              type="checkbox"
              checked={savePreset}
              onChange={(e) => setSavePreset(e.target.checked)}
              className="accent-[var(--editor-accent)]"
            />
            Save current version as a preset
          </label>

          {savePreset && (
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder={defaultName}
              className="editor-input w-full text-sm mt-3"
              autoFocus
            />
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" onClick={onCancel} className="editor-button-ghost text-xs">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onReset(savePreset ? (presetName.trim() || defaultName) : null)}
              disabled={busy}
              className="editor-button text-xs bg-[rgb(166,47,47)] hover:bg-[rgb(146,40,40)]"
            >
              {busy ? 'Resetting...' : 'Reset to Default'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
