import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'

type ThreadContext = {
  skill?: string
  versions?: number
  avatar_ids?: string[]
  positioning_id?: string | null
  active_swipe_id?: string | null
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
  ` as PromptBlockRow[]

  const map = new Map<string, PromptBlockRow>()
  for (const b of blocks || []) {
    const key = (b.metadata as { key?: string } | undefined)?.key || b.type
    map.set(key, b)
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

  const sections: string[] = []

  sections.push(`# BrandLab Agent\n\nYou are a senior direct-response copywriter and creative strategist.\n\nYou work inside BrandLab Studio. You can use tools to look up saved swipes (Meta ads), and to ingest new Meta Ad Library URLs.\n\nIMPORTANT:\n- If you suggest changing settings (avatars, skill, versions, swipe), ask the user to confirm.\n- When the user asks you to write, output the draft in a \`\`\`draft\n...\n\`\`\` code block.\n- Default drafts count = ${versions}. If versions > 1, format inside the draft block as:\n  - \"## Version 1\"\n  - \"## Version 2\" ...\n- Keep output concise, skimmable, and human.`)

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

  return sections.join('\n\n---\n\n')
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
      blocks,
    })

    const historyRows = await sql`
      SELECT role, content
      FROM agent_messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC
      LIMIT 40
    `

    // Convert persisted messages to Anthropic messages
    const messages: any[] = historyRows.map((m: any) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user'
      const content = m.role === 'tool' ? `[tool] ${m.content}` : m.content
      return { role, content }
    })

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey })

    const model = process.env.ANTHROPIC_AGENT_MODEL || 'claude-opus-4-5-20251101'

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

    // Agent loop with tool calling.
    const maxSteps = 6
    let assistantText = ''
    let workingMessages: any[] = messages

    for (let step = 0; step < maxSteps; step += 1) {
      const resp = await anthropic.messages.create({
        model,
        max_tokens: 2200,
        system,
        messages: workingMessages,
        tools,
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

      if (toolUses.length === 0) break

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
