import { sql } from '@/lib/db'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'

export type ThreadContext = {
  skill?: string
  versions?: number
  avatar_ids?: string[]
  positioning_id?: string | null
  active_swipe_id?: string | null
  research_ids?: string[]
}

export type PromptBlockRow = {
  id: string
  type: string
  content: string
  metadata?: { key?: string }
}

type PromptBlockSource = 'db' | 'default' | 'missing'

export type PromptBlockResolution = {
  key: string
  source: PromptBlockSource
  block_id: string | null
  type: string | null
  length: number
  content: string
}

export type PromptSectionInfo = {
  name: string
  length: number
}

export type BuiltSystemPrompt = {
  prompt: string
  promptBlocks: PromptBlockResolution[]
  sections: PromptSectionInfo[]
}

export type AgentHistoryRow = {
  role: string
  content: string
}

export type AgentContextMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AgentContextMessageInfo = {
  role: 'user' | 'assistant'
  original_chars: number
  used_chars: number
  clipped: boolean
  preview: string
}

export type AgentContextWindowDebug = {
  total_candidate_messages: number
  total_candidate_chars: number
  selected_messages: number
  selected_chars: number
  dropped_messages: number
  clipped_messages: number
  max_messages: number
  max_chars: number
  max_chars_per_message: number
  items: AgentContextMessageInfo[]
}

export type AgentContextWindow = {
  messages: AgentContextMessage[]
  debug: AgentContextWindowDebug
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

export const AGENT_CONTEXT_DEFAULTS = {
  maxMessages: positiveIntFromEnv('AGENT_CONTEXT_MAX_MESSAGES', 14),
  maxChars: positiveIntFromEnv('AGENT_CONTEXT_MAX_CHARS', 24_000),
  maxCharsPerMessage: positiveIntFromEnv('AGENT_CONTEXT_MAX_CHARS_PER_MESSAGE', 6_000),
  previewChars: 220,
}

function normalizeKey(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim()
}

function getBlockKey(row: PromptBlockRow): string {
  const metadataKey = normalizeKey((row.metadata as { key?: string } | undefined)?.key)
  if (metadataKey) return metadataKey
  return normalizeKey(row.type)
}

function resolvePromptBlock(blocks: Map<string, PromptBlockRow>, key: string): PromptBlockResolution {
  const dbBlock = blocks.get(key)
  if (dbBlock && typeof dbBlock.content === 'string' && dbBlock.content.length > 0) {
    return {
      key,
      source: 'db',
      block_id: dbBlock.id || null,
      type: dbBlock.type || null,
      length: dbBlock.content.length,
      content: dbBlock.content,
    }
  }

  const fallback = (DEFAULT_PROMPT_BLOCKS as any)[key]?.content
  if (typeof fallback === 'string' && fallback.length > 0) {
    return {
      key,
      source: 'default',
      block_id: null,
      type: 'default',
      length: fallback.length,
      content: fallback,
    }
  }

  return {
    key,
    source: 'missing',
    block_id: null,
    type: null,
    length: 0,
    content: '',
  }
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clipWithMarker(value: string, maxChars: number): { text: string; clipped: boolean } {
  if (maxChars <= 0) {
    return { text: '', clipped: value.length > 0 }
  }
  if (value.length <= maxChars) {
    return { text: value, clipped: false }
  }
  if (maxChars <= 20) {
    return { text: value.slice(0, maxChars), clipped: true }
  }
  const marker = '\n[truncated]'
  const limit = Math.max(1, maxChars - marker.length)
  return { text: `${value.slice(0, limit)}${marker}`, clipped: true }
}

function toSection(name: string, text: string): PromptSectionInfo | null {
  const cleaned = text.trim()
  if (!cleaned) return null
  return { name, length: cleaned.length }
}

export async function loadGlobalPromptBlocks(): Promise<Map<string, PromptBlockRow>> {
  const blocks = (await sql`
    SELECT id, type, content, metadata
    FROM prompt_blocks
    WHERE is_active = true
      AND scope = 'global'
    ORDER BY updated_at DESC NULLS LAST, version DESC, created_at DESC
  `) as PromptBlockRow[]

  const map = new Map<string, PromptBlockRow>()
  for (const block of blocks || []) {
    const key = getBlockKey(block)
    if (!key) continue
    if (!map.has(key)) {
      map.set(key, block)
    }
  }
  return map
}

export function buildSystemPrompt(args: {
  skill: string
  versions: number
  preferredVersions?: number[]
  product: { name: string; content: string; brandName?: string | null; brandVoice?: string | null }
  avatars: Array<{ id: string; name: string; content: string }>
  positioning?: { name: string; content: string } | null
  swipe?: {
    id: string
    status: string
    title?: string | null
    summary?: string | null
    transcript?: string | null
    source_url?: string | null
  } | null
  research?: Array<{ id: string; title?: string | null; summary?: string | null; content?: string | null }>
  blocks: Map<string, PromptBlockRow>
}): BuiltSystemPrompt {
  const { skill, versions, preferredVersions, product, avatars, positioning, swipe, blocks } = args

  const agentSystemSource = resolvePromptBlock(blocks, 'agent_system')
  const skillSource = resolvePromptBlock(blocks, skill)
  const writingRulesSource = resolvePromptBlock(blocks, 'writing_rules')

  const agentSystem = agentSystemSource.content.replace(/{{\s*versions\s*}}/gi, () =>
    String(versions)
  )
  const skillGuidance = skillSource.content
  const writingRules = writingRulesSource.content
  const outputContract = `## OUTPUT CONTRACT

**CRITICAL RULES:**
1. **Single draft block only**: Use exactly ONE \`\`\`draft block per response. NEVER create multiple draft blocks.
2. **No wrapper text**: When writing drafts, output ONLY the \`\`\`draft block. Nothing before it, nothing after it.
3. **Never write content in chat**: ALL copy, headlines, scripts, or creative output must be inside the \`\`\`draft block. Never write creative content directly in chat responses.
4. **Non-writing replies**: For questions, confirmations, or clarifications, use one short sentence OR 1-2 bullets. Never use \`\`\`draft for these.

**VERSION RULES:**
- Total versions available: ${versions}
- All versions must be in the SAME \`\`\`draft block using headings: \`## Version 1\`, \`## Version 2\`, etc.
- Use exact heading format only. Do not use "Option 1", "Variation 1", "V1", or any other format.
- If specific versions requested, output only those version sections.
- If all versions requested, include headings through ## Version ${versions}.

**DRAFT CONTENT:**
- Keep meta commentary outside drafts. Draft body should be final, production-ready content only.
- No explanations, notes, or instructions inside the draft block.`

  const sections: string[] = []
  const sectionDebug: PromptSectionInfo[] = []

  const pushSection = (name: string, text: string) => {
    const cleaned = text.trim()
    if (!cleaned) return
    sections.push(cleaned)
    const entry = toSection(name, cleaned)
    if (entry) sectionDebug.push(entry)
  }

  pushSection('agent_system', agentSystem)
  pushSection('current_skill', `## CURRENT SKILL\n${skill}`)
  if (skillGuidance) pushSection('skill_guidance', `## SKILL GUIDANCE\n${skillGuidance}`)
  if (writingRules) pushSection('writing_rules', `## WRITING RULES\n${writingRules}`)
  pushSection('output_contract', outputContract)

  // Version targeting context
  if (versions > 1) {
    const targetInfo =
      preferredVersions && preferredVersions.length > 0
        ? `Requested versions: ${preferredVersions.join(', ')}`
        : `Default: write to ALL ${versions} versions (use ## Version 1 through ## Version ${versions})`
    pushSection('version_targeting', `## VERSION TARGETING\n${targetInfo}\n- If user asks for specific versions only, output only those version sections\n- Otherwise, include all ${versions} versions in a single \`\`\`draft block`)
  }

  pushSection(
    'product',
    `## PRODUCT\nName: ${product.name}\n\nContext:\n${product.content || '(none)'}\n`
  )
  if (product.brandName || product.brandVoice) {
    pushSection(
      'brand',
      `## BRAND\nName: ${product.brandName || '(unknown)'}\n\nVoice guidelines:\n${product.brandVoice || '(none)'}`
    )
  }

  if (positioning) {
    pushSection('positioning', `## POSITIONING\n${positioning.name}\n\n${positioning.content}`)
  }

  if (avatars.length > 0) {
    const avatarLines: string[] = []
    avatarLines.push(`## AVATARS (${avatars.length})`)
    for (const avatar of avatars) {
      avatarLines.push(`\n### ${avatar.name}\n${avatar.content}`)
    }
    pushSection('avatars', avatarLines.join('\n'))
  } else {
    pushSection('avatars', '## AVATARS\n(none selected)')
  }

  if (swipe) {
    const transcript =
      swipe.status === 'ready' && swipe.transcript ? swipe.transcript.slice(0, 7000) : null
    pushSection(
      'active_swipe',
      `## ACTIVE SWIPE\nStatus: ${swipe.status}\nURL: ${swipe.source_url || ''}\nTitle: ${swipe.title || ''}\nSummary: ${swipe.summary || ''}\n\nTranscript:\n${transcript || '(not ready yet)'}\n`
    )
  }

  if (args.research && args.research.length > 0) {
    const lines: string[] = []
    lines.push(`## RESEARCH CONTEXT (${args.research.length})`)
    for (const item of args.research) {
      const excerpt = item.content ? item.content.slice(0, 1200) : ''
      lines.push(
        `\n### ${item.title || 'Untitled research'}\n${item.summary || ''}\n${excerpt ? `\nExcerpt:\n${excerpt}` : ''}`.trim()
      )
    }
    pushSection('research', lines.join('\n'))
  }

  return {
    prompt: sections.join('\n\n---\n\n'),
    promptBlocks: [agentSystemSource, skillSource, writingRulesSource],
    sections: sectionDebug,
  }
}

export function buildAgentContextMessages(
  historyRows: AgentHistoryRow[],
  options?: {
    maxMessages?: number
    maxChars?: number
    maxCharsPerMessage?: number
    previewChars?: number
  }
): AgentContextWindow {
  const maxMessages = Math.max(
    1,
    Number.isFinite(options?.maxMessages) ? Number(options?.maxMessages) : AGENT_CONTEXT_DEFAULTS.maxMessages
  )
  const maxChars = Math.max(
    1,
    Number.isFinite(options?.maxChars) ? Number(options?.maxChars) : AGENT_CONTEXT_DEFAULTS.maxChars
  )
  const maxCharsPerMessage = Math.max(
    1,
    Number.isFinite(options?.maxCharsPerMessage)
      ? Number(options?.maxCharsPerMessage)
      : AGENT_CONTEXT_DEFAULTS.maxCharsPerMessage
  )
  const previewChars = Math.max(
    20,
    Number.isFinite(options?.previewChars)
      ? Number(options?.previewChars)
      : AGENT_CONTEXT_DEFAULTS.previewChars
  )

  const normalized = (historyRows || [])
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => {
      const content = String(row.content || '').trim()
      const role: AgentContextMessage['role'] = row.role === 'assistant' ? 'assistant' : 'user'
      return { role, content }
    })
    .filter((row) => row.content.length > 0)

  const totalCandidateChars = normalized.reduce((sum, row) => sum + row.content.length, 0)

  const reversedMessages: AgentContextMessage[] = []
  const reversedDebug: AgentContextMessageInfo[] = []
  let charBudget = 0
  let clippedCount = 0

  for (let idx = normalized.length - 1; idx >= 0; idx -= 1) {
    if (reversedMessages.length >= maxMessages) break
    if (charBudget >= maxChars) break

    const row = normalized[idx]
    const originalChars = row.content.length
    let clipped = false

    const isNewestCandidate = reversedMessages.length === 0
    const perMessageLimit =
      isNewestCandidate && row.role === 'user'
        ? Math.max(maxCharsPerMessage, row.content.length)
        : maxCharsPerMessage

    const clippedPerMessage = clipWithMarker(row.content, perMessageLimit)
    let nextContent = clippedPerMessage.text
    if (clippedPerMessage.clipped) clipped = true

    const remaining = maxChars - charBudget
    if (nextContent.length > remaining) {
      const clippedRemaining = clipWithMarker(nextContent, remaining)
      nextContent = clippedRemaining.text
      if (clippedRemaining.clipped) clipped = true
    }

    const usedChars = nextContent.length
    if (usedChars <= 0) {
      continue
    }

    if (clipped) clippedCount += 1
    charBudget += usedChars

    reversedMessages.push({ role: row.role, content: nextContent })
    reversedDebug.push({
      role: row.role,
      original_chars: originalChars,
      used_chars: usedChars,
      clipped,
      preview: compactWhitespace(nextContent).slice(0, previewChars),
    })
  }

  const messages = reversedMessages.reverse()
  const items = reversedDebug.reverse()

  return {
    messages,
    debug: {
      total_candidate_messages: normalized.length,
      total_candidate_chars: totalCandidateChars,
      selected_messages: messages.length,
      selected_chars: charBudget,
      dropped_messages: Math.max(0, normalized.length - messages.length),
      clipped_messages: clippedCount,
      max_messages: maxMessages,
      max_chars: maxChars,
      max_chars_per_message: maxCharsPerMessage,
      items,
    },
  }
}
