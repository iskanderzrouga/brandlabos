import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'
import { getOrgApiKey } from '@/lib/api-keys'

type PromptBlockRow = {
  id: string
  type: string
  content: string
  metadata?: { key?: string }
}

type ExtractFlags = {
  avatars: boolean
  positioning: boolean
  quotes: boolean
  awareness: boolean
}

type SynthesisProposals = {
  avatars: Array<{ name: string; content: string }>
  positionings: Array<{ name: string; content: string }>
  quotes: Array<{ quote: string; source?: string; note?: string }>
  awareness_insights: Array<{ name: string; summary: string; application?: string }>
}

const DEFAULT_EXTRACT: ExtractFlags = {
  avatars: true,
  positioning: true,
  quotes: true,
  awareness: true,
}

function parseJsonPayload(text: string) {
  const cleaned = (text.match(/```json\s*([\s\S]*?)\s*```/) || [null, text])[1].trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

function normalizeExtract(value: any): ExtractFlags {
  return {
    avatars: value?.avatars !== false,
    positioning: value?.positioning !== false,
    quotes: value?.quotes !== false,
    awareness: value?.awareness !== false,
  }
}

function compact(value: unknown, max = 4000) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function normalizeProposals(value: any): SynthesisProposals {
  const avatars = Array.isArray(value?.avatars)
    ? value.avatars
        .map((row: any) => ({
          name: compact(row?.name, 100),
          content: compact(row?.content, 4000),
        }))
        .filter((row: any) => row.name && row.content)
        .slice(0, 6)
    : []

  const positionings = Array.isArray(value?.positionings)
    ? value.positionings
        .map((row: any) => ({
          name: compact(row?.name, 100),
          content: compact(row?.content, 4000),
        }))
        .filter((row: any) => row.name && row.content)
        .slice(0, 6)
    : []

  const quotes = Array.isArray(value?.quotes)
    ? value.quotes
        .map((row: any) => ({
          quote: compact(row?.quote, 1200),
          source: compact(row?.source, 200),
          note: compact(row?.note, 600),
        }))
        .filter((row: any) => row.quote)
        .slice(0, 10)
    : []

  const awarenessInsights = Array.isArray(value?.awareness_insights)
    ? value.awareness_insights
        .map((row: any) => ({
          name: compact(row?.name, 100),
          summary: compact(row?.summary, 1000),
          application: compact(row?.application, 700),
        }))
        .filter((row: any) => row.name && row.summary)
        .slice(0, 8)
    : []

  return {
    avatars,
    positionings,
    quotes,
    awareness_insights: awarenessInsights,
  }
}

async function loadGlobalPromptBlocks(): Promise<Map<string, PromptBlockRow>> {
  const blocks = (await sql`
    SELECT id, type, content, metadata
    FROM prompt_blocks
    WHERE is_active = true
      AND scope = 'global'
    ORDER BY updated_at DESC NULLS LAST, version DESC, created_at DESC
  `) as PromptBlockRow[]

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

function applyTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_, key) => {
    const val = vars[key.toLowerCase()] ?? ''
    return val
  })
}

async function ensureInsightsCategory(productId: string, userId: string): Promise<string> {
  const existing = await sql`
    SELECT id
    FROM research_categories
    WHERE product_id = ${productId}
      AND LOWER(name) = LOWER('Insights')
    ORDER BY created_at ASC
    LIMIT 1
  `
  if (existing[0]?.id) return existing[0].id as string

  const created = await sql`
    INSERT INTO research_categories (product_id, name, description, created_by)
    VALUES (
      ${productId},
      'Insights',
      'Synthesized strategic insights from research.',
      ${userId}
    )
    RETURNING id
  `
  return created[0].id as string
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const productId = String(body.product_id || '').trim()
    const apply = Boolean(body.apply)
    const itemIds = Array.isArray(body.item_ids)
      ? body.item_ids.map((id: any) => String(id || '').trim()).filter(Boolean)
      : []
    const extract = normalizeExtract(body.extract || DEFAULT_EXTRACT)
    const threadId = body.thread_id ? String(body.thread_id).trim() : ''

    if (!productId) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
    }

    if (!extract.avatars && !extract.positioning && !extract.quotes && !extract.awareness) {
      return NextResponse.json({ error: 'At least one extract flag must be enabled' }, { status: 400 })
    }

    const whereParams: any[] = [productId]
    let idClause = ''
    if (itemIds.length > 0) {
      whereParams.push(itemIds)
      idClause = 'AND id = ANY($2)'
    }

    const items = await sql.query(
      `
      SELECT id, title, summary, content
      FROM research_items
      WHERE product_id = $1
      ${idClause}
      ORDER BY created_at DESC
      LIMIT 40
    `,
      whereParams
    )

    if (!items || items.length === 0) {
      return NextResponse.json({
        avatars: [],
        positionings: [],
        quotes: [],
        awareness_insights: [],
      })
    }

    const orgRows = await sql`
      SELECT brands.organization_id AS organization_id
      FROM products
      LEFT JOIN brands ON brands.id = products.brand_id
      WHERE products.id = ${productId}
      LIMIT 1
    `
    const orgId = orgRows[0]?.organization_id as string | undefined

    const provided = normalizeProposals(body.proposals)
    const shouldGenerate =
      !apply ||
      (
        provided.avatars.length === 0 &&
        provided.positionings.length === 0 &&
        provided.quotes.length === 0 &&
        provided.awareness_insights.length === 0
      )

    let proposals = provided
    if (shouldGenerate) {
      const anthropicKey = await getOrgApiKey('anthropic', orgId || null)
      if (!anthropicKey) {
        return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
      }

      const itemsText = items
        .map(
          (item: any, idx: number) =>
            `${idx + 1}. ID: ${item.id}\nTitle: ${item.title || '(none)'}\nSummary: ${item.summary || ''}\nExcerpt: ${(item.content || '').slice(0, 1200)}`
        )
        .join('\n\n')

      const extractText = [
        `avatars=${extract.avatars}`,
        `positioning=${extract.positioning}`,
        `quotes=${extract.quotes}`,
        `awareness=${extract.awareness}`,
      ].join(', ')

      const blocks = await loadGlobalPromptBlocks()
      const system = getPromptBlockContent(blocks, 'research_synthesis_system')
      const template = getPromptBlockContent(blocks, 'research_synthesis_prompt')
      const prompt = applyTemplate(template, { items: itemsText, extract: extractText })

      const anthropic = new Anthropic({ apiKey: anthropicKey })
      const model = process.env.ANTHROPIC_SYNTHESIZE_MODEL || process.env.ANTHROPIC_ORGANIZE_MODEL || 'claude-3-5-haiku-latest'

      const message = await anthropic.messages.create({
        model,
        max_tokens: 1600,
        system: system || undefined,
        messages: [{ role: 'user', content: prompt }],
      })

      const text = (message.content as any[]).find((c) => c.type === 'text')?.text || ''
      const parsed = parseJsonPayload(text)
      if (!parsed) {
        return NextResponse.json({ error: 'Failed to parse synthesis output' }, { status: 500 })
      }
      proposals = normalizeProposals(parsed)
    }

    if (!apply) {
      return NextResponse.json(proposals)
    }

    const created = {
      avatar_ids: [] as string[],
      pitch_ids: [] as string[],
      research_item_ids: [] as string[],
    }

    for (const avatar of proposals.avatars) {
      const rows = await sql`
        INSERT INTO avatars (product_id, name, content, is_active)
        VALUES (${productId}, ${avatar.name}, ${avatar.content}, false)
        RETURNING id
      `
      if (rows[0]?.id) created.avatar_ids.push(rows[0].id)
    }

    for (const positioning of proposals.positionings) {
      const rows = await sql`
        INSERT INTO pitches (product_id, name, content, type, is_active)
        VALUES (
          ${productId},
          ${positioning.name},
          ${positioning.content},
          'research_synthesis',
          false
        )
        RETURNING id
      `
      if (rows[0]?.id) created.pitch_ids.push(rows[0].id)
    }

    const hasInsightNotes =
      proposals.quotes.length > 0 || proposals.awareness_insights.length > 0
    let insightsCategoryId: string | null = null
    if (hasInsightNotes) {
      insightsCategoryId = await ensureInsightsCategory(productId, user.id)
    }

    if (insightsCategoryId) {
      for (const quote of proposals.quotes) {
        const title = quote.quote.slice(0, 90)
        const content = [
          `Quote: ${quote.quote}`,
          quote.source ? `Source: ${quote.source}` : '',
          quote.note ? `Note: ${quote.note}` : '',
        ]
          .filter(Boolean)
          .join('\n')
        const rows = await sql`
          INSERT INTO research_items (
            product_id, category_id, type, title, summary, content, status, created_by
          ) VALUES (
            ${productId},
            ${insightsCategoryId},
            'text',
            ${title},
            ${quote.note || null},
            ${content},
            'organized',
            ${user.id}
          )
          RETURNING id
        `
        if (rows[0]?.id) created.research_item_ids.push(rows[0].id)
      }

      for (const insight of proposals.awareness_insights) {
        const content = [
          insight.summary,
          insight.application ? `Application: ${insight.application}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')
        const rows = await sql`
          INSERT INTO research_items (
            product_id, category_id, type, title, summary, content, status, created_by
          ) VALUES (
            ${productId},
            ${insightsCategoryId},
            'text',
            ${insight.name},
            ${insight.summary.slice(0, 320)},
            ${content},
            'organized',
            ${user.id}
          )
          RETURNING id
        `
        if (rows[0]?.id) created.research_item_ids.push(rows[0].id)
      }
    }

    let attachedToThread = false
    if (threadId && created.research_item_ids.length > 0) {
      const threadRows = await sql`
        SELECT id, context
        FROM agent_threads
        WHERE id = ${threadId}
          AND product_id = ${productId}
        LIMIT 1
      `
      const thread = threadRows[0]
      if (thread?.id) {
        const context = (thread.context || {}) as { research_ids?: string[] }
        const existing = Array.isArray(context.research_ids) ? context.research_ids : []
        context.research_ids = Array.from(new Set([...existing, ...created.research_item_ids]))
        await sql`
          UPDATE agent_threads
          SET context = ${context}, updated_at = NOW()
          WHERE id = ${thread.id}
        `
        attachedToThread = true
      }
    }

    return NextResponse.json({ created, attached_to_thread: attachedToThread })
  } catch (error) {
    console.error('Synthesize research error:', error)
    return NextResponse.json({ error: 'Failed to synthesize research' }, { status: 500 })
  }
}
