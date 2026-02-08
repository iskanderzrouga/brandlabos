'use client'

import { useEffect, useMemo, useState } from 'react'
import { CONTENT_TYPES } from '@/lib/content-types'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'
import { useAppContext } from '@/components/app-shell'
import { ResetPresetModal } from '@/components/ui/reset-preset-modal'
import { PresetsDropdown } from '@/components/ui/presets-dropdown'

type PromptBlock = {
  id: string
  type: string
  content: string
  user_id?: string | null
  metadata?: { key?: string; label?: string; description?: string }
}

type SkillMeta = {
  key: string
  label: string
  description: string
  type: 'skill' | 'rule'
}

const DEFAULT_RULES: SkillMeta[] = [
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

function makeRuleKey(name: string) {
  const base = slugify(name)
  if (!base) return `custom_rule_${Date.now()}`
  return `custom_rule_${base}`
}

export default function SkillsPage() {
  const { user } = useAppContext()
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
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    loadBlocks()
  }, [])

  async function loadBlocks() {
    setLoading(true)
    try {
      const res = await fetch('/api/prompt-blocks?scope=global&active_only=true&user_override=true')
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

  const ruleList = useMemo<SkillMeta[]>(() => {
    const customRules = blocks
      .filter((b) => b.type === 'global_rules' && b.metadata?.key !== 'writing_rules')
      .map((b) => ({
        key: b.metadata?.key || b.id,
        label: b.metadata?.label || b.metadata?.key || b.id,
        description: b.metadata?.description || 'Custom rule',
        type: 'rule' as const,
      }))
    return [...DEFAULT_RULES, ...customRules]
  }, [blocks])

  const coreSkillKeys = useMemo(() => new Set(CONTENT_TYPES.map((ct) => ct.id)), [])

  const activeMeta = useMemo(() => {
    const list = tab === 'skills' ? skillList : ruleList
    return list.find((item) => item.key === activeKey) || null
  }, [tab, skillList, ruleList, activeKey])

  function getBlockForKey(key: string) {
    return blocks.find((b) => b.metadata?.key === key) || null
  }

  const activeBlock = activeKey ? getBlockForKey(activeKey) : null
  const isCustomSkill = Boolean(activeKey && tab === 'skills' && !coreSkillKeys.has(activeKey))
  const isUserOverride = Boolean(activeBlock?.user_id)

  function isBlockUserOverride(key: string) {
    const block = blocks.find((b) => b.metadata?.key === key)
    return Boolean(block?.user_id)
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
      user_id: user?.id || null,
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
          body: JSON.stringify({ content: editContent, user_id: user?.id || null }),
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

  async function handleResetConfirm(presetName: string | null) {
    if (!activeKey) return
    const block = getBlockForKey(activeKey)
    if (!block) return
    setResetting(true)
    try {
      const res = await fetch(`/api/prompt-blocks/${block.id}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset_name: presetName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to reset')
      await loadBlocks()
      const fallback = DEFAULT_PROMPT_BLOCKS[activeKey as keyof typeof DEFAULT_PROMPT_BLOCKS]?.content || ''
      setEditContent(fallback)
      setMessage('Reset to default.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to reset')
    } finally {
      setResetting(false)
      setResetOpen(false)
    }
  }

  async function deleteCustomSkill() {
    if (!activeKey) return
    const block = getBlockForKey(activeKey)
    if (!block) return
    if (!confirm('Delete this custom skill? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/prompt-blocks/${block.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to delete')
      await loadBlocks()
      setActiveKey(null)
      setEditContent('')
      setMessage('Deleted.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to delete')
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
      user_id: user?.id || null,
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

  async function createRule() {
    if (!newName.trim()) return
    const key = makeRuleKey(newName.trim())
    setSaving(true)
    setMessage(null)
    const payload = {
      name: newName.trim(),
      type: 'global_rules' as const,
      scope: 'global' as const,
      content: editContent || '',
      user_id: user?.id || null,
      metadata: {
        key,
        label: newName.trim(),
        description: newDescription.trim() || 'Custom rule',
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

  const isCustomRule = Boolean(activeKey && tab === 'rules' && activeKey !== 'writing_rules')

  async function deleteCustomRule() {
    if (!activeKey) return
    const block = getBlockForKey(activeKey)
    if (!block) return
    if (!confirm('Delete this custom rule? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/prompt-blocks/${block.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to delete')
      await loadBlocks()
      setActiveKey(null)
      setEditContent('')
      setMessage('Deleted.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  useEffect(() => {
    if (!activeKey) {
      const list = tab === 'skills' ? skillList : ruleList
      if (list[0]) loadEditor(list[0].key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, skillList, ruleList])

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
          ) : (tab === 'skills' ? skillList : ruleList).map((item) => (
            <button
              key={item.key}
              onClick={() => loadEditor(item.key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeKey === item.key
                  ? 'bg-[var(--editor-accent-soft)] text-[var(--editor-ink)]'
                  : 'text-[var(--editor-ink-muted)] hover:bg-black/5'
              }`}
            >
              <div className="font-medium flex items-center gap-1.5">
                {item.label}
                {isBlockUserOverride(item.key) && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--editor-accent-soft)] text-[var(--editor-accent,#7c6bff)]">yours</span>
                )}
              </div>
              <div className="text-xs text-[var(--editor-ink-muted)]">{item.description}</div>
            </button>
          ))}
        </div>

        {(tab === 'skills' || tab === 'rules') && (
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
              {tab === 'skills' ? 'New Skill' : 'New Rule'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col bg-[var(--editor-panel-muted)]">
        <div className="bg-[var(--editor-panel)] border-b border-[var(--editor-border)] p-5 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-[var(--editor-ink)]">
              {creating ? (tab === 'rules' ? 'New Rule' : 'New Skill') : activeMeta?.label || 'Editor'}
            </h2>
            <p className="text-sm text-[var(--editor-ink-muted)] mt-1">
              {creating
                ? (tab === 'rules' ? 'Define a new rule for the agent.' : 'Define a new skill for the agent.')
                : isUserOverride
                  ? 'Your personal override (resets to default on delete)'
                  : activeMeta?.description || ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!creating && (
              <>
                {activeKey && (
                  <PresetsDropdown
                    metadataKey={activeKey}
                    scope="global"
                    onRestore={(content) => setEditContent(content)}
                  />
                )}
                <button
                  onClick={saveBlock}
                  disabled={saving}
                  className="editor-button text-xs"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                {activeBlock && !isCustomSkill && !isCustomRule && (
                  <button onClick={() => setResetOpen(true)} className="editor-button-ghost text-xs">
                    Reset
                  </button>
                )}
                {activeBlock && isCustomSkill && (
                  <button onClick={deleteCustomSkill} className="editor-button-ghost text-xs text-red-300">
                    Delete
                  </button>
                )}
                {activeBlock && isCustomRule && (
                  <button onClick={deleteCustomRule} className="editor-button-ghost text-xs text-red-300">
                    Delete
                  </button>
                )}
              </>
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
                  placeholder={tab === 'rules' ? 'e.g., Tone of Voice' : 'e.g., High-Intent UGC Hooks'}
                  className="editor-input w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--editor-ink-muted)] mb-1">Description</label>
                <input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder={tab === 'rules' ? 'Short description for this rule.' : 'Short description for this skill.'}
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
                onClick={tab === 'rules' ? createRule : createSkill}
                disabled={saving || !newName.trim()}
                className="editor-button text-xs"
              >
                {saving ? 'Saving...' : tab === 'rules' ? 'Create Rule' : 'Create Skill'}
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

      <ResetPresetModal
        open={resetOpen}
        blockLabel={activeMeta?.label || activeKey || ''}
        onReset={handleResetConfirm}
        onCancel={() => setResetOpen(false)}
        busy={resetting}
      />
    </div>
  )
}
