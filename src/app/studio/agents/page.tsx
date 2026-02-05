'use client'

import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'

type PromptBlock = {
  id: string
  content: string
  metadata?: { key?: string }
  name?: string
  type?: string
}

type AgentBlock = {
  key: string
  label: string
  description: string
  helper?: string
}

type AgentConfig = {
  id: string
  label: string
  description: string
  blocks: AgentBlock[]
}

const AGENTS: AgentConfig[] = [
  {
    id: 'writer',
    label: 'Writer Agent',
    description: 'System prompt that powers the main writing agent.',
    blocks: [
      {
        key: 'agent_system',
        label: 'System Prompt',
        description: 'Core behavior and output rules for the writer.',
        helper: 'Tokens: {{versions}}',
      },
    ],
  },
  {
    id: 'research',
    label: 'Research Organizer',
    description: 'Turns inbox research into categories and assignments.',
    blocks: [
      {
        key: 'research_organizer_system',
        label: 'System Prompt',
        description: 'Strict JSON output behavior for the organizer.',
      },
      {
        key: 'research_organizer_prompt',
        label: 'User Prompt',
        description: 'Instructions + item list template.',
        helper: 'Tokens: {{items}}',
      },
    ],
  },
  {
    id: 'swipe-namer',
    label: 'Swipe Namer',
    description: 'Generates short hyphenated titles for manual swipes.',
    blocks: [
      {
        key: 'swipe_namer_system',
        label: 'System Prompt',
        description: 'Forces 3-5 word slug output.',
      },
      {
        key: 'swipe_namer_prompt',
        label: 'User Prompt',
        description: 'Template with brand + transcript excerpt.',
        helper: 'Tokens: {{brand}}, {{product}}, {{avatar}}, {{angle}}, {{excerpt}}',
      },
    ],
  },
  {
    id: 'swipe',
    label: 'Swipe Summarizer',
    description: 'Summarizes Meta ad swipes into titles and summaries.',
    blocks: [
      {
        key: 'swipe_summarizer_system',
        label: 'System Prompt',
        description: 'Controls summary tone + JSON discipline.',
      },
      {
        key: 'swipe_summarizer_prompt',
        label: 'User Prompt',
        description: 'Template for passing URL + transcript.',
        helper: 'Tokens: {{url}}, {{transcript}}',
      },
    ],
  },
  {
    id: 'research-summary',
    label: 'Research Summarizer',
    description: 'Summarizes uploaded research files into briefs.',
    blocks: [
      {
        key: 'research_summarizer_system',
        label: 'System Prompt',
        description: 'Controls summary tone + JSON discipline.',
      },
      {
        key: 'research_summarizer_prompt',
        label: 'User Prompt',
        description: 'Template for passing title + text.',
        helper: 'Tokens: {{title}}, {{text}}',
      },
    ],
  },
]

const ALL_KEYS = AGENTS.flatMap((agent) => agent.blocks.map((b) => b.key))

function getDefaultContent(key: string) {
  return (DEFAULT_PROMPT_BLOCKS as any)[key]?.content || ''
}

export default function AgentsPage() {
  const [blocks, setBlocks] = useState<PromptBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [activeAgentId, setActiveAgentId] = useState(AGENTS[0].id)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [messages, setMessages] = useState<Record<string, string | null>>({})

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

  useEffect(() => {
    loadBlocks()
  }, [])

  const activeAgent = useMemo(
    () => AGENTS.find((agent) => agent.id === activeAgentId) || AGENTS[0],
    [activeAgentId]
  )

  function getBlockForKey(key: string) {
    return blocks.find((b) => b.metadata?.key === key) || null
  }

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const key of ALL_KEYS) {
        if (next[key] === undefined) {
          const block = getBlockForKey(key)
          next[key] = block?.content || getDefaultContent(key)
        }
      }
      return next
    })
  }, [blocks])

  async function saveBlock(key: string) {
    const content = drafts[key] || ''
    setSaving((prev) => ({ ...prev, [key]: true }))
    setMessages((prev) => ({ ...prev, [key]: null }))

    const existing = getBlockForKey(key)
    const defaultName = (DEFAULT_PROMPT_BLOCKS as any)[key]?.name || key

    try {
      if (existing) {
        const res = await fetch(`/api/prompt-blocks/${existing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Failed to update')
      } else {
        const res = await fetch('/api/prompt-blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: defaultName,
            type: 'custom',
            scope: 'global',
            content,
            metadata: { key },
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Failed to create')
      }
      await loadBlocks()
      setMessages((prev) => ({ ...prev, [key]: 'Saved.' }))
    } catch (err) {
      setMessages((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : 'Failed to save' }))
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }))
    }
  }

  async function resetBlock(key: string) {
    const existing = getBlockForKey(key)
    if (!existing) return
    if (!confirm('Reset this prompt to default?')) return

    try {
      const res = await fetch(`/api/prompt-blocks/${existing.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to reset')
      await loadBlocks()
      setDrafts((prev) => ({ ...prev, [key]: getDefaultContent(key) }))
      setMessages((prev) => ({ ...prev, [key]: 'Reset to default.' }))
    } catch (err) {
      setMessages((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : 'Failed to reset' }))
    }
  }

  return (
    <div className="h-full flex">
      <div className="w-72 border-r border-[var(--editor-border)] bg-[var(--editor-panel)] flex flex-col">
        <div className="p-4 border-b border-[var(--editor-border)]">
          <h1 className="text-lg font-semibold text-[var(--editor-ink)]">Agents</h1>
          <p className="text-xs text-[var(--editor-ink-muted)] mt-1">
            Edit the system prompts that power your agents.
          </p>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-1">
          {AGENTS.map((agent) => {
            const active = agent.id === activeAgentId
            return (
              <button
                key={agent.id}
                onClick={() => setActiveAgentId(agent.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-[var(--editor-accent-soft)] text-[var(--editor-ink)]'
                    : 'text-[var(--editor-ink-muted)] hover:bg-black/5'
                }`}
              >
                <div className="font-medium">{agent.label}</div>
                <div className="text-xs text-[var(--editor-ink-muted)]">{agent.description}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-[var(--editor-panel-muted)]">
        <div className="bg-[var(--editor-panel)] border-b border-[var(--editor-border)] p-5">
          <h2 className="font-semibold text-[var(--editor-ink)]">{activeAgent.label}</h2>
          <p className="text-sm text-[var(--editor-ink-muted)] mt-1">
            {activeAgent.description}
          </p>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {loading ? (
            <div className="text-sm text-[var(--editor-ink-muted)]">Loading...</div>
          ) : (
            activeAgent.blocks.map((block) => {
              const overridden = Boolean(getBlockForKey(block.key))
              return (
                <div key={block.key} className="editor-panel p-5 max-w-4xl">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
                        {block.label}
                      </p>
                      <p className="text-sm text-[var(--editor-ink)] mt-2 font-medium">
                        {block.description}
                      </p>
                      {block.helper && (
                        <p className="text-xs text-[var(--editor-ink-muted)] mt-2">{block.helper}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {overridden && (
                        <span className="chat-chip chat-chip--muted">Customized</span>
                      )}
                      <button
                        onClick={() => saveBlock(block.key)}
                        disabled={saving[block.key]}
                        className="editor-button text-xs"
                      >
                        {saving[block.key] ? 'Saving...' : 'Save'}
                      </button>
                      {overridden && (
                        <button
                          onClick={() => resetBlock(block.key)}
                          className="editor-button-ghost text-xs"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>

                  <textarea
                    value={drafts[block.key] || ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [block.key]: e.target.value }))
                    }
                    rows={12}
                    className="editor-input w-full text-sm resize-none mt-4"
                  />

                  {messages[block.key] && (
                    <p className="text-xs text-[var(--editor-ink-muted)] mt-3">
                      {messages[block.key]}
                    </p>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
