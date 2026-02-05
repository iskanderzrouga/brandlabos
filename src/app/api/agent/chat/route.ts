import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { getOrgApiKey } from '@/lib/api-keys'
import {
  AGENT_CONTEXT_DEFAULTS,
  buildAgentContextMessages,
  buildSystemPrompt,
  loadGlobalPromptBlocks,
  type ThreadContext,
} from '@/lib/agent/compiled-context'
export const maxDuration = 30

type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

const AGENT_MODEL = 'claude-opus-4-6'
const CONTEXT_MAX_MESSAGES = AGENT_CONTEXT_DEFAULTS.maxMessages
const CONTEXT_MAX_CHARS = AGENT_CONTEXT_DEFAULTS.maxChars
const CONTEXT_MAX_CHARS_PER_MESSAGE = AGENT_CONTEXT_DEFAULTS.maxCharsPerMessage
const AGENT_MAX_STEPS = 2
const AGENT_MAX_TOKENS = 1000
const AGENT_CALL_TIMEOUT_MS = 9000

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

function deriveThreadTitle(message: string) {
  const clean = message.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const sentence = clean.split(/[.!?\n]/)[0]
  const clipped = sentence.length > 80 ? sentence.slice(0, 80).trim() : sentence
  return clipped || null
}

function shouldEnableTools(messageText: string, threadContext: ThreadContext) {
  if (threadContext.active_swipe_id) return true
  if (Array.isArray(threadContext.research_ids) && threadContext.research_ids.length > 0) return true
  const text = messageText.toLowerCase()
  if (text.includes('facebook.com/ads/library')) return true

  return (
    text.includes('ingest meta') ||
    text.includes('ad library') ||
    text.includes('list swipes') ||
    text.includes('get swipe') ||
    text.includes('show swipe') ||
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
    const includeDebug = Boolean(body.debug || body.include_debug || body.debug_context)

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
    const systemBuild = buildSystemPrompt({
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
    const system = systemBuild.prompt

    const historyRows = await sql`
      SELECT role, content
      FROM agent_messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at DESC
      LIMIT 80
    `

    // Context is thread-scoped, but we keep only a lean recent window to avoid token waste.
    const contextWindow = buildAgentContextMessages(
      (historyRows as Array<{ role: string; content: string }>).reverse(),
      {
        maxMessages: CONTEXT_MAX_MESSAGES,
        maxChars: CONTEXT_MAX_CHARS,
        maxCharsPerMessage: CONTEXT_MAX_CHARS_PER_MESSAGE,
      }
    )
    const messages: any[] = contextWindow.messages

    const anthropicKey = await getOrgApiKey('anthropic', productRow.organization_id || null)
    if (!anthropicKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
    }

    const anthropic = new Anthropic({
      apiKey: anthropicKey,
      timeout: AGENT_CALL_TIMEOUT_MS,
      maxRetries: 0,
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

    const responsePayload: any = {
      assistant_message: assistantText,
      thread_context: threadContext,
      maybe_swipe_status: maybeSwipe
        ? { swipe_id: maybeSwipe.id, status: maybeSwipe.status }
        : null,
    }

    if (includeDebug) {
      responsePayload.debug = {
        model,
        prompt: system,
        prompt_blocks: systemBuild.promptBlocks,
        prompt_sections: systemBuild.sections,
        context_window: contextWindow.debug,
        context_messages: contextWindow.messages,
        request_message_chars: messageText.length,
        runtime_limits: {
          context_max_messages: CONTEXT_MAX_MESSAGES,
          context_max_chars: CONTEXT_MAX_CHARS,
          context_max_chars_per_message: CONTEXT_MAX_CHARS_PER_MESSAGE,
          max_steps: maxSteps,
          max_tokens: AGENT_MAX_TOKENS,
          call_timeout_ms: AGENT_CALL_TIMEOUT_MS,
        },
        tools_enabled: Boolean(activeTools),
      }
    }

    return NextResponse.json(responsePayload)
  } catch (error) {
    console.error('Agent chat error:', error)
    return NextResponse.json({ error: 'Agent chat failed' }, { status: 500 })
  }
}
