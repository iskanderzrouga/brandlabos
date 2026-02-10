import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import {
  AGENT_CONTEXT_DEFAULTS,
  buildAgentContextMessages,
  buildSystemPrompt,
  loadGlobalPromptBlocks,
  type ThreadContext,
} from '@/lib/agent/compiled-context'

/**
 * Lightweight version of the chat route's summarizeDraftForContext.
 * Replaces large ```draft blocks with a short placeholder so the preview
 * matches the context the AI actually receives.
 */
function summarizeDraftForPreview(content: string): string {
  const match = content.match(/```draft\s*([\s\S]*?)\s*```/i)
  if (!match) return content
  if (content.length < 1800) return content
  const draftBody = match[1].trim()
  const headings = draftBody.match(/^##\s*Version\s*(\d+)/gim)
  const versionText = headings
    ? headings.map((h) => h.match(/(\d+)/)?.[1]).filter(Boolean).join(', ')
    : 'none'
  return `[previous draft omitted for context]\nversions: ${versionText}\ndraft_chars: ${draftBody.length}`
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

const CONTEXT_MAX_MESSAGES = AGENT_CONTEXT_DEFAULTS.maxMessages
const CONTEXT_MAX_CHARS = AGENT_CONTEXT_DEFAULTS.maxChars
const CONTEXT_MAX_CHARS_PER_MESSAGE = AGENT_CONTEXT_DEFAULTS.maxCharsPerMessage
const AGENT_HISTORY_LIMIT = positiveIntFromEnv('AGENT_HISTORY_LIMIT', 40)

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: threadId } = await ctx.params
  if (!threadId) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  const includeDebug = request.nextUrl.searchParams.get('debug') === '1'

  const threadRows = await sql`
    SELECT *
    FROM agent_threads
    WHERE id = ${threadId}
      AND user_id = ${user.id}
    LIMIT 1
  `
  const thread = threadRows[0]
  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  const threadContext: ThreadContext = (thread.context || {}) as ThreadContext

  const productRows = await sql`
    SELECT
      products.id,
      products.name,
      products.context,
      brands.organization_id AS organization_id,
      brands.name AS brand_name,
      brands.voice_guidelines AS brand_voice_guidelines
    FROM products
    LEFT JOIN brands ON brands.id = products.brand_id
    WHERE products.id = ${thread.product_id}
    LIMIT 1
  `
  const productRow = productRows[0]
  if (!productRow) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const skills = Array.isArray(threadContext.skills) && threadContext.skills.length > 0
    ? threadContext.skills.map(String)
    : null
  const skill = String(threadContext.skill || (skills ? skills[0] : 'ugc_video_scripts'))
  const versions = Math.min(6, Math.max(1, Number(threadContext.versions || 1)))

  const avatarIds = Array.isArray(threadContext.avatar_ids) ? threadContext.avatar_ids : []
  let avatars: Array<{ id: string; name: string; content: string }> = []
  if (avatarIds.length > 0) {
    const rows = (await sql`
      SELECT id, name, content
      FROM avatars
      WHERE id = ANY(${avatarIds})
    `) as Array<{ id: string; name: string; content: string }>
    const order = new Map(avatarIds.map((id, idx) => [id, idx]))
    avatars = (rows || []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  }

  let positioning: { name: string; content: string } | null = null
  if (threadContext.positioning_id) {
    const rows = await sql`
      SELECT name, content
      FROM pitches
      WHERE id = ${threadContext.positioning_id}
      LIMIT 1
    `
    const row = rows[0] as { name: string; content: string } | undefined
    if (row) positioning = { name: row.name, content: row.content }
  }

  let swipe: any = null
  if (threadContext.active_swipe_id) {
    const rows = await sql`
      SELECT id, status, title, summary, transcript, source_url
      FROM swipes
      WHERE id = ${threadContext.active_swipe_id}
        AND product_id = ${thread.product_id}
      LIMIT 1
    `
    swipe = rows[0] ?? null
  }

  let research: Array<{ id: string; title?: string | null; summary?: string | null; content?: string | null }> = []
  const researchIds = Array.isArray(threadContext.research_ids) ? threadContext.research_ids : []
  if (researchIds.length > 0) {
    const rows = (await sql`
      SELECT id, title, summary, content
      FROM research_items
      WHERE id = ANY(${researchIds})
        AND product_id = ${thread.product_id}
    `) as Array<{ id: string; title?: string | null; summary?: string | null; content?: string | null }>
    const order = new Map(researchIds.map((id, idx) => [id, idx]))
    research = (rows || []).sort((a: any, b: any) => {
      const ai = order.get(a.id) ?? 0
      const bi = order.get(b.id) ?? 0
      return ai - bi
    })
  }

  const blocks = await loadGlobalPromptBlocks(user.id)
  const systemBuild = buildSystemPrompt({
    skill,
    skills: skills || undefined,
    versions,
    product: {
      name: productRow.name,
      content: productRow.context?.content || '',
      brandName: productRow.brand_name || null,
      brandVoice: productRow.brand_voice_guidelines || null,
    },
    avatars,
    positioning,
    swipe,
    research,
    blocks,
  })
  const system = systemBuild.prompt

  const payload: any = { prompt: system }

  if (includeDebug) {
    const historyRows = await sql`
      SELECT role, content
      FROM agent_messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at DESC
      LIMIT ${AGENT_HISTORY_LIMIT}
    `
    // Apply the same draft summarization the chat route uses so the preview
    // matches what the AI actually sees (large ```draft blocks get replaced
    // with a short placeholder to save context budget).
    const contextHistoryRows = (
      (historyRows as Array<{ role: string; content: string }>).reverse()
    ).map((row) => {
      if (row.role !== 'assistant') return row
      return { ...row, content: summarizeDraftForPreview(String(row.content || '')) }
    })
    const contextWindow = buildAgentContextMessages(
      contextHistoryRows,
      {
        maxMessages: CONTEXT_MAX_MESSAGES,
        maxChars: CONTEXT_MAX_CHARS,
        maxCharsPerMessage: CONTEXT_MAX_CHARS_PER_MESSAGE,
      }
    )

    payload.debug = {
      thread_context: threadContext,
      prompt_blocks: systemBuild.promptBlocks,
      prompt_sections: systemBuild.sections,
      context_window: contextWindow.debug,
      context_messages: contextWindow.messages,
      runtime_limits: {
        history_limit: AGENT_HISTORY_LIMIT,
        context_max_messages: CONTEXT_MAX_MESSAGES,
        context_max_chars: CONTEXT_MAX_CHARS,
        context_max_chars_per_message: CONTEXT_MAX_CHARS_PER_MESSAGE,
      },
    }
  }

  return NextResponse.json(payload)
}
