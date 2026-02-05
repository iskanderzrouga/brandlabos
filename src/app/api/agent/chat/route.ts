import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'
import { getOrgApiKey } from '@/lib/api-keys'

type ThreadContext = {
  skill?: string
  versions?: number
  avatar_ids?: string[]
  positioning_id?: string | null
  active_swipe_id?: string | null
  research_ids?: string[]
}

type PromptBlockRow = {
  id: string
  type: string
  content: string
  metadata?: { key?: string }
}

type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

const AGENT_MODEL = 'claude-opus-4-6'
const CONTEXT_MAX_MESSAGES = 14
const CONTEXT_MAX_CHARS = 24000
const AGENT_MAX_STEPS = 3
const AGENT_MAX_TOKENS = 1400
const AGENT_CALL_TIMEOUT_MS = 18000

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as any).type === 'tool_use' &&
    typeof (block as any).id === 'string' &&
    typeof (block as any).name === 'string'
  )
}

function extractMetaAdLibraryUrls(text: string): string[] {
  const regex = /(https?:\/\/[^\s]+?facebook\.com\/ads\/library\/[^\s]*)/gi
  const matches = text.match(regex) || []
  return matches
    .map((m) => m.replace(/[),.;!?]+$/g, ''))
    .filter(Boolean)
}

function isMetaAdLibraryUrl(url: string) {
  try {
    const u = new URL(url)
    return u.hostname.includes('facebook.com') && u.pathname.includes('/ads/library')
  } catch {
    return false
  }
}

async function loadGlobalPromptBlocks(): Promise<Map<string, PromptBlockRow>> {
  const blocks = await sql`
    SELECT id, type, content, metadata
    FROM prompt_blocks
    WHERE is_active = true
      AND scope = 'global'
    ORDER BY updated_at DESC NULLS LAST, version DESC, created_at DESC
  ` as PromptBlockRow[]

  const map = new Map<string, PromptBlockRow>()
  for (const b of blocks || []) {
    const key = (b.metadata as { key?: string } | undefined)?.key || b.type
    if (!map.has(key)) {
      map.set(key, b)
    }
  }
  return map
}

function getPromptBlockContent(blocks: Map<string, PromptBlockRow>, key: string): string {
  const db = blocks.get(key)?.content
  if (db) return db
  const fallback = (DEFAULT_PROMPT_BLOCKS as any)[key]?.content
  return typeof fallback === 'string' ? fallback : ''
}

function buildSystemPrompt(args: {
  skill: string
  versions: number
  product: { name: string; content: string; brandName?: string | null; brandVoice?: string | null }
  avatars: Array<{ id: string; name: string; content: string }>
  positioning?: { name: string; content: string } | null
  swipe?: { id: string; status: string; title?: string | null; summary?: string | null; transcript?: string | null; source_url?: string | null } | null
  research?: Array<{ id: string; title?: string | null; summary?: string | null; content?: string | null }>
  blocks: Map<string, PromptBlockRow>
}) {
  const {
    skill,
    versions,
    product,
    avatars,
    positioning,
    swipe,
    blocks,
  } = args

  const writingRules = getPromptBlockContent(blocks, 'writing_rules')
  const skillGuidance = getPromptBlockContent(blocks, skill)
  const agentSystemTemplate = getPromptBlockContent(blocks, 'agent_system')
  const agentSystem = agentSystemTemplate.replace(/{{\s*versions\s*}}/gi, () => String(versions))

  const sections: string[] = []

  if (agentSystem.trim()) sections.push(agentSystem)

  sections.push(`## CURRENT SKILL\n${skill}`)
  if (skillGuidance) sections.push(`## SKILL GUIDANCE\n${skillGuidance}`)
  if (writingRules) sections.push(`## WRITING RULES\n${writingRules}`)

  sections.push(`## PRODUCT\nName: ${product.name}\n\nContext:\n${product.content || '(none)'}\n`)
  if (product.brandName || product.brandVoice) {
    sections.push(`## BRAND\nName: ${product.brandName || '(unknown)'}\n\nVoice guidelines:\n${product.brandVoice || '(none)'}`)
  }

  if (positioning) {
    sections.push(`## POSITIONING\n${positioning.name}\n\n${positioning.content}`)
  }

  if (avatars.length > 0) {
    const lines: string[] = []
    lines.push(`## AVATARS (${avatars.length})`)
    for (const a of avatars) {
      lines.push(`\n### ${a.name}\n${a.content}`)
    }
    sections.push(lines.join('\n'))
  } else {
    sections.push(`## AVATARS\n(none selected)`)
  }

  if (swipe) {
    const transcript =
      swipe.status === 'ready' && swipe.transcript
        ? swipe.transcript.slice(0, 7000)
        : null
    sections.push(`## ACTIVE SWIPE\nStatus: ${swipe.status}\nURL: ${swipe.source_url || ''}\nTitle: ${swipe.title || ''}\nSummary: ${swipe.summary || ''}\n\nTranscript:\n${transcript || '(not ready yet)'}\n`)
  }

  if (args.research && args.research.length > 0) {
    const lines: string[] = []
    lines.push(`## RESEARCH CONTEXT (${args.research.length})`)
    for (const item of args.research) {
      const excerpt = item.content ? item.content.slice(0, 1200) : ''
      lines.push(`\n### ${item.title || 'Untitled research'}\n${item.summary || ''}\n${excerpt ? `\nExcerpt:\n${excerpt}` : ''}`.trim())
    }
    sections.push(lines.join('\n'))
  }

  return sections.join('\n\n---\n\n')
}

function deriveThreadTitle(message: string) {
  const clean = message.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const sentence = clean.split(/[.!?\n]/)[0]
  const clipped = sentence.length > 80 ? sentence.slice(0, 80).trim() : sentence
  return clipped || null
}

function buildAgentContextMessages(historyRows: Array<{ role: string; content: string }>) {
  const normalized = historyRows
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: String(row.content || '').trim(),
    }))
    .filter((row) => row.content.length > 0)

  const recent: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let charBudget = 0

  // Build from latest backwards to keep the freshest turns under a hard budget.
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    const row = normalized[i]
    if (recent.length >= CONTEXT_MAX_MESSAGES) break
    if (recent.length > 0 && charBudget + row.content.length > CONTEXT_MAX_CHARS) break
    recent.push({ role: row.role as 'user' | 'assistant', content: row.content })
    charBudget += row.content.length
  }

  return recent.reverse()
}

function shouldEnableTools(messageText: string, threadContext: ThreadContext) {
  if (threadContext.active_swipe_id) return true
  if (Array.isArray(threadContext.research_ids) && threadContext.research_ids.length > 0) return true
  const text = messageText.toLowerCase()
  return (
    text.includes('facebook.com/ads/library') ||
    text.includes('meta ad') ||
    text.includes('ad library') ||
    text.includes('swipe') ||
    text.includes('transcript') ||
    text.includes('ingest')
  )
}

async function ingestMetaSwipe(args: { productId: string; url: string; userId: string }) {
  const { productId, url, userId } = args

  const swipeRows = await sql`
    INSERT INTO swipes (product_id, source, source_url, status, created_by)
    VALUES (${productId}, 'meta_ad_library', ${url}, 'processing', ${userId})
    ON CONFLICT (product_id, source, source_url) DO UPDATE SET
      updated_at = NOW(),
      status = CASE WHEN swipes.status = 'failed' THEN 'processing' ELSE swipes.status END,
      error_message = CASE WHEN swipes.status = 'failed' THEN NULL ELSE swipes.error_message END
    RETURNING *
  `
  const swipe = swipeRows[0]
  if (!swipe) throw new Error('Failed to create swipe')

  if (swipe.status === 'ready') {
    return { swipe, job: null }
  }

  const existingJobRows = await sql`
    SELECT id, status
    FROM media_jobs
    WHERE type = 'ingest_meta_ad'
      AND status IN ('queued', 'running')
      AND input->>'swipe_id' = ${swipe.id}
    ORDER BY created_at DESC
    LIMIT 1
  `
  const existingJob = existingJobRows[0]
  if (existingJob) return { swipe, job: existingJob }

  const jobRows = await sql`
    INSERT INTO media_jobs (type, status, input)
    VALUES (
      'ingest_meta_ad',
      'queued',
      ${{
        swipe_id: swipe.id,
        product_id: productId,
        url,
        user_id: userId,
      }}
    )
    RETURNING *
  `
  return { swipe, job: jobRows[0] ?? null }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const authedUser = user

  try {
    const body = await request.json()
    const threadId = String(body.thread_id || '').trim()
    const messageText = String(body.message || '').trim()

    if (!threadId || !messageText) {
      return NextResponse.json({ error: 'thread_id and message are required' }, { status: 400 })
    }

    const threadRows = await sql`
      SELECT *
      FROM agent_threads
      WHERE id = ${threadId}
        AND user_id = ${authedUser.id}
      LIMIT 1
    `
    const thread = threadRows[0]
    if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

    const threadContext: ThreadContext = (thread.context || {}) as ThreadContext

    // Persist user message
    await sql`
      INSERT INTO agent_messages (thread_id, role, content)
      VALUES (${threadId}, 'user', ${messageText})
    `

    if (!thread.title) {
      const derived = deriveThreadTitle(messageText)
      if (derived) {
        await sql`
          UPDATE agent_threads
          SET title = ${derived}, updated_at = NOW()
          WHERE id = ${threadId}
        `
      }
    }

    // Auto-ingest Meta Ad Library URL(s) if present
    const urls = extractMetaAdLibraryUrls(messageText).filter(isMetaAdLibraryUrl)
    let maybeSwipe: any = null
    if (urls.length > 0) {
      const url = urls[0]
      const ingest = await ingestMetaSwipe({ productId: thread.product_id, url, userId: authedUser.id })
      maybeSwipe = ingest.swipe

      // Update thread context with active swipe
      threadContext.active_swipe_id = ingest.swipe.id
      await sql`
        UPDATE agent_threads
        SET context = ${threadContext}, updated_at = NOW()
        WHERE id = ${threadId}
      `

      await sql`
        INSERT INTO agent_messages (thread_id, role, content, metadata)
        VALUES (
          ${threadId},
          'tool',
          ${`Ingest started: ${url}`},
          ${{ swipe_id: ingest.swipe.id, job_id: ingest.job?.id || null, status: ingest.swipe.status }}
        )
      `
    }

    // Load product + context for system prompt
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

    const skill = String(threadContext.skill || 'ugc_video_scripts')
    const versions = Math.min(6, Math.max(1, Number(threadContext.versions || 1)))

    // Load selected avatars (if any)
    const avatarIds = Array.isArray(threadContext.avatar_ids) ? threadContext.avatar_ids : []
    const avatars: Array<{ id: string; name: string; content: string }> = []
    for (const id of avatarIds) {
      const rows = await sql`SELECT id, name, content FROM avatars WHERE id = ${id} LIMIT 1`
      const row = rows[0] as { id: string; name: string; content: string } | undefined
      if (row) {
        avatars.push({ id: row.id, name: row.name, content: row.content })
      }
    }

    // Load positioning (pitches) if selected
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

    // Load active swipe if selected
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

    // Load attached research items if any
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

    const blocks = await loadGlobalPromptBlocks()
    const system = buildSystemPrompt({
      skill,
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

    const historyRows = await sql`
      SELECT role, content
      FROM agent_messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at DESC
      LIMIT 80
    `

    // Context is thread-scoped, but we keep only a lean recent window to avoid token waste.
    const messages: any[] = buildAgentContextMessages(
      (historyRows as Array<{ role: string; content: string }>).reverse()
    )

    const anthropicKey = await getOrgApiKey('anthropic', productRow.organization_id || null)
    if (!anthropicKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
    }

    const anthropic = new Anthropic({
      apiKey: anthropicKey,
      timeout: AGENT_CALL_TIMEOUT_MS,
      maxRetries: 1,
    })

    const model = AGENT_MODEL

    const tools: any[] = [
      {
        name: 'ingest_meta_ad_url',
        description:
          'Ingest a Meta Ad Library URL: create a swipe record and enqueue a transcription job. Returns swipe_id and status.',
        input_schema: {
          type: 'object',
          properties: {
            product_id: { type: 'string' },
            url: { type: 'string' },
          },
          required: ['product_id', 'url'],
        },
      },
      {
        name: 'list_swipes',
        description: 'List swipes for the current product (optionally filter by query).',
        input_schema: {
          type: 'object',
          properties: {
            product_id: { type: 'string' },
            query: { type: 'string' },
          },
          required: ['product_id'],
        },
      },
      {
        name: 'get_swipe',
        description: 'Fetch a swipe by id. Optionally include transcript.',
        input_schema: {
          type: 'object',
          properties: {
            swipe_id: { type: 'string' },
            include_transcript: { type: 'boolean' },
          },
          required: ['swipe_id'],
        },
      },
    ]

    async function runTool(toolUse: any) {
      if (!toolUse?.name) throw new Error('Invalid tool use')

      if (toolUse.name === 'ingest_meta_ad_url') {
        const url = String(toolUse.input?.url || '').trim()
        const productId = thread.product_id
        if (!url || !isMetaAdLibraryUrl(url)) {
          return { error: 'Invalid Meta Ad Library URL' }
        }
        const ingest = await ingestMetaSwipe({ productId, url, userId: authedUser.id })

        // Keep active swipe pinned to the newly ingested one.
        threadContext.active_swipe_id = ingest.swipe.id
        await sql`
          UPDATE agent_threads
          SET context = ${threadContext}, updated_at = NOW()
          WHERE id = ${threadId}
        `

        return {
          swipe_id: ingest.swipe.id,
          status: ingest.swipe.status,
          job_id: ingest.job?.id || null,
        }
      }

      if (toolUse.name === 'list_swipes') {
        const productId = thread.product_id
        const query = String(toolUse.input?.query || '').trim()
        if (query) {
          const like = `%${query}%`
          const rows = await sql`
            SELECT id, status, title, summary, source_url, created_at
            FROM swipes
            WHERE product_id = ${productId}
              AND (
                title ILIKE ${like}
                OR summary ILIKE ${like}
                OR source_url ILIKE ${like}
              )
            ORDER BY created_at DESC
            LIMIT 50
          `
          return { swipes: rows }
        }
        const rows = await sql`
          SELECT id, status, title, summary, source_url, created_at
          FROM swipes
          WHERE product_id = ${productId}
          ORDER BY created_at DESC
          LIMIT 50
        `
        return { swipes: rows }
      }

      if (toolUse.name === 'get_swipe') {
        const swipeId = String(toolUse.input?.swipe_id || '').trim()
        const includeTranscript = Boolean(toolUse.input?.include_transcript)
        if (!swipeId) return { error: 'swipe_id is required' }

        const rows = await sql`
          SELECT id, product_id, status, title, summary, transcript, source_url, metadata, created_at
          FROM swipes
          WHERE id = ${swipeId}
          LIMIT 1
        `
        const row = rows[0]
        if (!row) return { error: 'Not found' }
        if (row.product_id !== thread.product_id) return { error: 'Forbidden' }

        if (!includeTranscript) {
          delete row.transcript
        }
        return row
      }

      return { error: `Unknown tool: ${toolUse.name}` }
    }

    const activeTools = shouldEnableTools(messageText, threadContext) ? tools : undefined

    const loopStartedAt = Date.now()

    // Agent loop with tool calling.
    const maxSteps = activeTools ? AGENT_MAX_STEPS : 1
    let assistantText = ''
    let workingMessages: any[] = messages

    for (let step = 0; step < maxSteps; step += 1) {
      if (Date.now() - loopStartedAt > AGENT_CALL_TIMEOUT_MS) {
        console.warn('Agent loop budget exceeded', { threadId, step, model })
        break
      }

      const resp = await anthropic.messages.create({
        model,
        max_tokens: AGENT_MAX_TOKENS,
        system,
        messages: workingMessages,
        ...(activeTools ? { tools: activeTools } : {}),
      })

      const content = resp.content || []
      const toolUses = content.filter(isToolUseBlock)
      const textParts = content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
      if (textParts.length > 0) {
        assistantText = textParts.join('\n\n').trim()
      }

      // Always append the assistant content (including tool_use blocks) so the next
      // call has the proper tool_use ids in context.
      workingMessages = workingMessages.concat([{ role: 'assistant', content }])

      if (!activeTools || toolUses.length === 0) break

      for (const tu of toolUses) {
        const result = await runTool(tu)
        workingMessages = workingMessages.concat([
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: tu.id,
                content: JSON.stringify(result),
              },
            ],
          },
        ])
      }
    }

    if (!assistantText) {
      assistantText = 'I can help. What are you trying to write?'
    }

    // Persist assistant reply
    await sql`
      INSERT INTO agent_messages (thread_id, role, content)
      VALUES (${threadId}, 'assistant', ${assistantText})
    `

    return NextResponse.json({
      assistant_message: assistantText,
      thread_context: threadContext,
      maybe_swipe_status: maybeSwipe
        ? { swipe_id: maybeSwipe.id, status: maybeSwipe.status }
        : null,
    })
  } catch (error) {
    console.error('Agent chat error:', error)
    return NextResponse.json({ error: 'Agent chat failed' }, { status: 500 })
  }
}
