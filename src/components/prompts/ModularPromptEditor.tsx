'use client'

import { useState, useEffect } from 'react'
import { fetchPromptModules, savePromptModule, type PromptModule } from '@/lib/services/prompt-manager'

interface ModularPromptEditorProps {
  activeContentType: string
  onModuleChange?: (key: string, content: string, isTemporary: boolean) => void
  temporaryOverrides?: Map<string, string>
}

export function ModularPromptEditor({
  activeContentType,
  onModuleChange,
  temporaryOverrides = new Map()
}: ModularPromptEditorProps) {
  const [modules, setModules] = useState<PromptModule[]>([])
  const [loading, setLoading] = useState(true)
  const [editingModule, setEditingModule] = useState<PromptModule | null>(null)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadModules()
  }, [])

  async function loadModules() {
    setLoading(true)
    const data = await fetchPromptModules()
    setModules(data)
    setLoading(false)
  }

  // Get the active content type module
  const contentTypeModule = modules.find(m => m.key === activeContentType)

  // Get the output format module for the active content type
  const outputFormatKey = `output_format_${activeContentType}`
  const outputFormatModule = modules.find(m => m.key === outputFormatKey)

  // Only show writing_rules in shared (output format is shown separately)
  const sharedModules = modules.filter(m => m.category === 'shared' && m.key === 'writing_rules')
  const targetingModules = modules.filter(m => m.category === 'targeting')

  function getModuleContent(key: string): string {
    if (temporaryOverrides.has(key)) {
      return temporaryOverrides.get(key)!
    }
    const mod = modules.find(m => m.key === key)
    return mod?.content || ''
  }

  function startEditing(mod: PromptModule) {
    setEditingModule(mod)
    setEditContent(getModuleContent(mod.key))
  }

  async function handleSave(saveAsDefault: boolean) {
    if (!editingModule) return
    setSaving(true)

    if (saveAsDefault) {
      const result = await savePromptModule(editingModule.key, editContent, true)
      if (result.success) {
        await loadModules()
      } else {
        console.error('Failed to save prompt module:', result.error)
        alert(`Failed to save: ${result.error}`)
        setSaving(false)
        return
      }
    }

    onModuleChange?.(editingModule.key, editContent, !saveAsDefault)
    setEditingModule(null)
    setSaving(false)
  }

  function cancelEdit() {
    setEditingModule(null)
    setEditContent('')
  }

  if (loading) {
    return <div className="p-4 text-[var(--editor-ink-muted)] text-sm">Loading...</div>
  }

  return (
    <>
      <div className="border-t border-[var(--editor-border)]">
        <div className="px-4 py-3 border-b border-[var(--editor-border)] bg-[var(--editor-panel-muted)]/60">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">Prompt Modules</h3>
        </div>

        <div className="p-3 space-y-3">
          {/* Content Template */}
          {contentTypeModule && (
            <div>
              <span className="text-[10px] text-[var(--editor-ink-muted)] uppercase tracking-[0.3em]">Template</span>
              <button
                onClick={() => startEditing(contentTypeModule)}
                className={`mt-1 w-full text-left px-3 py-2 rounded-2xl border text-sm transition-all ${
                  temporaryOverrides.has(contentTypeModule.key)
                    ? 'border-[var(--editor-warning)] bg-[rgba(244,163,64,0.12)] text-[var(--editor-ink)]'
                    : 'border-[var(--editor-border)] bg-[var(--editor-panel)] hover:border-[var(--editor-ink)] text-[var(--editor-ink)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{contentTypeModule.name}</span>
                  {temporaryOverrides.has(contentTypeModule.key) && (
                    <span className="text-[10px] text-[var(--editor-warning)] uppercase tracking-[0.2em]">modified</span>
                  )}
                </div>
              </button>
            </div>
          )}

          {/* Output Format + Shared Rules */}
          <div>
            <span className="text-[10px] text-[var(--editor-ink-muted)] uppercase tracking-[0.3em]">Format & Rules</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {outputFormatModule && (
                <button
                  onClick={() => startEditing(outputFormatModule)}
                  className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.2em] border transition-all ${
                    temporaryOverrides.has(outputFormatModule.key)
                      ? 'bg-[rgba(244,163,64,0.18)] text-[var(--editor-ink)] border-[var(--editor-warning)]'
                      : 'bg-transparent text-[var(--editor-ink-muted)] border-[var(--editor-border)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)]'
                  }`}
                >
                  Output Format
                </button>
              )}
              {sharedModules.map(mod => (
                <button
                  key={mod.key}
                  onClick={() => startEditing(mod)}
                  className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.2em] border transition-all ${
                    temporaryOverrides.has(mod.key)
                      ? 'bg-[rgba(244,163,64,0.18)] text-[var(--editor-ink)] border-[var(--editor-warning)]'
                      : 'bg-transparent text-[var(--editor-ink-muted)] border-[var(--editor-border)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)]'
                  }`}
                >
                  {mod.name}
                </button>
              ))}
            </div>
          </div>

          {/* Targeting */}
          <div>
            <span className="text-[10px] text-[var(--editor-ink-muted)] uppercase tracking-[0.3em]">Targeting</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {targetingModules.map(mod => (
                <button
                  key={mod.key}
                  onClick={() => startEditing(mod)}
                  className="px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.2em] border border-[var(--editor-border)] text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)] transition-all"
                >
                  {mod.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingModule && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="editor-panel w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-[var(--editor-border)] flex items-center justify-between">
              <div>
                <h3 className="font-serif text-lg text-[var(--editor-ink)]">{editingModule.name}</h3>
                <p className="text-sm text-[var(--editor-ink-muted)] mt-0.5">{editingModule.description}</p>
              </div>
              <button
                onClick={cancelEdit}
                className="text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)] text-xl p-1"
              >
                ×
              </button>
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-hidden p-5">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-full min-h-[300px] p-4 border border-[var(--editor-border)] rounded-2xl font-mono text-sm text-[var(--editor-ink)] bg-[var(--editor-panel)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--editor-accent)]"
                placeholder="Enter prompt content..."
              />
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-5 border-t border-[var(--editor-border)]">
              <div className="flex items-center gap-3">
                <button
                  onClick={cancelEdit}
                  className="editor-button-ghost"
                >
                  Cancel
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => handleSave(false)}
                  disabled={saving}
                  className="editor-button-ghost"
                >
                  Use once
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  className="editor-button"
                >
                  {saving ? 'Saving...' : 'Save as default'}
                </button>
              </div>
              <p className="text-xs text-[var(--editor-ink-muted)] mt-3 text-center">
                "Use once" applies to this generation only. "Save as default" updates the template permanently.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
