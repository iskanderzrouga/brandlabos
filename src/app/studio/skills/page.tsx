'use client'

import { useEffect, useMemo, useState } from 'react'
import { CONTENT_TYPES } from '@/lib/content-types'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'

type PromptBlock = {
  id: string
  type: string
  content: string
  metadata?: { key?: string; label?: string; description?: string }
}

type SkillMeta = {
  key: string
  label: string
  description: string
  type: 'skill' | 'rule'
}

const RULES: SkillMeta[] = [
  { key: 'writing_rules', label: 'Writing Rules', description: 'Global writing style guidelines', type: 'rule' },
]

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

export default function SkillsPage() {
  const [blocks, setBlocks] = useState<PromptBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'skills' | 'rules'>('skills')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')

  useEffect(() => {
    loadBlocks()
  }, [])

  async function loadBlocks() {
    setLoading(true)
    try {
      const res = await fetch('/api/prompt-blocks?scope=global&active_only=true')
      const data = await res.json()
      setBlocks(Array.isArray(data) ? data : [])
    } catch {
      setBlocks([])
    } finally {
      setLoading(false)
    }
  }

  const skillList = useMemo<SkillMeta[]>(() => {
    const core = CONTENT_TYPES.map((ct) => ({
      key: ct.id,
      label: ct.label,
      description: ct.description,
      type: 'skill' as const,
    }))

    const custom = blocks
      .filter((b) => b.type === 'feature_template')
      .map((b) => ({
        key: b.metadata?.key || b.id,
        label: b.metadata?.label || b.metadata?.key || b.id,
        description: b.metadata?.description || 'Custom skill',
        type: 'skill' as const,
      }))
      .filter((b) => !core.some((c) => c.key === b.key))

    return [...core, ...custom]
  }, [blocks])

  const activeMeta = useMemo(() => {
    const list = tab === 'skills' ? skillList : RULES
    return list.find((item) => item.key === activeKey) || null
  }, [tab, skillList, activeKey])

  function getBlockForKey(key: string) {
    return blocks.find((b) => b.metadata?.key === key) || null
  }

  function loadEditor(key: string) {
    setActiveKey(key)
    setCreating(false)
    setMessage(null)
    const block = getBlockForKey(key)
    const fallback = DEFAULT_PROMPT_BLOCKS[key as keyof typeof DEFAULT_PROMPT_BLOCKS]?.content || ''
    setEditContent(block?.content || fallback)
  }

  async function saveBlock() {
    if (!activeKey) return
    setSaving(true)
    setMessage(null)
    const block = getBlockForKey(activeKey)

    const payload = {
      name: activeMeta?.label || activeKey,
      type: tab === 'skills' ? 'feature_template' : activeKey.startsWith('output_format') ? 'output_format' : 'global_rules',
      scope: 'global',
      content: editContent,
      metadata: {
        key: activeKey,
        label: activeMeta?.label || activeKey,
        description: activeMeta?.description || '',
      },
    }

    try {
      if (block) {
        const res = await fetch(`/api/prompt-blocks/${block.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editContent }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Failed to update')
      } else {
        const res = await fetch('/api/prompt-blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Failed to create')
      }
      await loadBlocks()
      setMessage('Saved.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function createSkill() {
    if (!newName.trim()) return
    const key = makeSkillKey(newName.trim())
    setSaving(true)
    setMessage(null)
    const payload = {
      name: newName.trim(),
      type: 'feature_template',
      scope: 'global',
      content: editContent || '',
      metadata: {
        key,
        label: newName.trim(),
        description: newDescription.trim() || 'Custom skill',
      },
    }
    try {
      const res = await fetch('/api/prompt-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to create')
      await loadBlocks()
      setCreating(false)
      setActiveKey(key)
      setEditContent(payload.content)
      setMessage('Saved.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!activeKey) {
      const list = tab === 'skills' ? skillList : RULES
      if (list[0]) loadEditor(list[0].key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, skillList])

  return (
    <div className="h-full flex">
      <div className="w-72 border-r border-[var(--editor-border)] bg-[var(--editor-panel)] flex flex-col">
        <div className="p-4 border-b border-[var(--editor-border)]">
          <h1 className="text-lg font-semibold text-[var(--editor-ink)]">Skills</h1>
          <p className="text-xs text-[var(--editor-ink-muted)] mt-1">
            Manage skills and rules the agent uses.
          </p>
        </div>

        <div className="p-2 border-b border-[var(--editor-border)] space-y-2">
          <button
            onClick={() => setTab('skills')}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              tab === 'skills'
                ? 'bg-[var(--editor-accent-soft)] text-[var(--editor-ink)]'
                : 'text-[var(--editor-ink-muted)] hover:bg-black/5'
            }`}
          >
            Skills
          </button>
          <button
            onClick={() => setTab('rules')}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              tab === 'rules'
                ? 'bg-[var(--editor-accent-soft)] text-[var(--editor-ink)]'
                : 'text-[var(--editor-ink-muted)] hover:bg-black/5'
            }`}
          >
            Rules
          </button>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-1">
          {loading ? (
            <div className="p-4 text-[var(--editor-ink-muted)] text-sm">Loading...</div>
          ) : (tab === 'skills' ? skillList : RULES).map((item) => (
            <button
              key={item.key}
              onClick={() => loadEditor(item.key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeKey === item.key
                  ? 'bg-[var(--editor-accent-soft)] text-[var(--editor-ink)]'
                  : 'text-[var(--editor-ink-muted)] hover:bg-black/5'
              }`}
            >
              <div className="font-medium">{item.label}</div>
              <div className="text-xs text-[var(--editor-ink-muted)]">{item.description}</div>
            </button>
          ))}
        </div>

        {tab === 'skills' && (
          <div className="p-4 border-t border-[var(--editor-border)]">
            <button
              onClick={() => {
                setCreating(true)
                setActiveKey(null)
                setEditContent('')
                setNewName('')
                setNewDescription('')
              }}
              className="editor-button w-full text-xs"
            >
              New Skill
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col bg-[var(--editor-panel-muted)]">
        <div className="bg-[var(--editor-panel)] border-b border-[var(--editor-border)] p-5 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-[var(--editor-ink)]">
              {creating ? 'New Skill' : activeMeta?.label || 'Editor'}
            </h2>
            <p className="text-sm text-[var(--editor-ink-muted)] mt-1">
              {creating ? 'Define a new skill for the agent.' : activeMeta?.description || ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!creating && (
              <button
                onClick={saveBlock}
                disabled={saving}
                className="editor-button text-xs"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          {creating && (
            <div className="editor-panel p-5 space-y-4 max-w-2xl">
              <div>
                <label className="block text-xs text-[var(--editor-ink-muted)] mb-1">Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., High-Intent UGC Hooks"
                  className="editor-input w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--editor-ink-muted)] mb-1">Description</label>
                <input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Short description for this skill."
                  className="editor-input w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--editor-ink-muted)] mb-1">Guidance</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={8}
                  className="editor-input w-full text-sm resize-none"
                />
              </div>
              <button
                onClick={createSkill}
                disabled={saving || !newName.trim()}
                className="editor-button text-xs"
              >
                {saving ? 'Saving...' : 'Create Skill'}
              </button>
            </div>
          )}

          {!creating && activeKey && (
            <div className="editor-panel p-5 max-w-3xl">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={18}
                className="editor-input w-full text-sm resize-none"
              />
              {message && (
                <p className="text-xs text-[var(--editor-ink-muted)] mt-3">{message}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
