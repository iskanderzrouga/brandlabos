import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { getOrgApiKey } from '@/lib/api-keys'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'

const AGENT_MODEL = 'claude-opus-4-6'

type PromptBlockRow = {
  id: string
  type: string
  content: string
  metadata?: { key?: string }
}

function normalizeSlug(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').filter(Boolean)
  const trimmed = words.slice(0, 5)
  while (trimmed.length < 3) trimmed.push('swipe')
  return trimmed.join('-').slice(0, 64)
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

function applyTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_, key) => {
    const val = vars[key.toLowerCase()] ?? ''
    return val
  })
}

async function generateSwipeTitle(args: {
  productName: string
  brandName?: string | null
  avatarName?: string | null
  positioningName?: string | null
  transcript: string
  orgId?: string | null
  blocks: Map<string, PromptBlockRow>
}) {
  const { productName, brandName, avatarName, positioningName, transcript, orgId, blocks } = args
  const excerpt = transcript.slice(0, 600)
  const key = await getOrgApiKey('anthropic', orgId || null)
  if (!key) {
    return normalizeSlug(excerpt || `${brandName || productName} swipe`)
  }
  const anthropic = new Anthropic({ apiKey: key })
  const system = getPromptBlockContent(blocks, 'swipe_namer_system')
  const template = getPromptBlockContent(blocks, 'swipe_namer_prompt')
  const prompt = applyTemplate(template, {
    brand: brandName || '',
    product: productName,
    avatar: avatarName || '',
    angle: positioningName || '',
    excerpt,
  })
  const response = await anthropic.messages.create({
    model: AGENT_MODEL,
    max_tokens: 60,
    temperature: 0.2,
    system: system || undefined,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = response.content
    .map((b) => (typeof b === 'string' ? b : (b as any).text))
    .join(' ')
  return normalizeSlug(text)
}

export async function GET(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const productId = String(searchParams.get('product_id') || '').trim()
  const q = String(searchParams.get('q') || '').trim()

  if (!productId) {
    return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
  }

  try {
    if (q) {
      const like = `%${q}%`
      const rows = await sql`
        SELECT
          swipes.id,
          swipes.product_id,
          swipes.source,
          swipes.source_url,
          swipes.status,
          swipes.title,
          swipes.summary,
          swipes.headline,
          swipes.ad_copy,
          swipes.cta,
          swipes.created_at,
          swipes.updated_at,
          mj.id AS job_id,
          mj.status AS job_status,
          mj.error_message AS job_error_message,
          mj.updated_at AS job_updated_at,
          mj.attempts AS job_attempts
        FROM swipes
        LEFT JOIN LATERAL (
          SELECT id, status, error_message, updated_at, attempts
          FROM media_jobs
          WHERE input->>'swipe_id' = swipes.id::text
          ORDER BY created_at DESC
          LIMIT 1
        ) mj ON true
        WHERE product_id = ${productId}
          AND (
            title ILIKE ${like}
            OR summary ILIKE ${like}
            OR source_url ILIKE ${like}
          )
        ORDER BY created_at DESC
        LIMIT 200
      `
      return NextResponse.json(rows)
    }

    const rows = await sql`
      SELECT
        swipes.id,
        swipes.product_id,
        swipes.source,
        swipes.source_url,
        swipes.status,
        swipes.title,
        swipes.summary,
        swipes.headline,
        swipes.ad_copy,
        swipes.cta,
        swipes.created_at,
        swipes.updated_at,
        mj.id AS job_id,
        mj.status AS job_status,
        mj.error_message AS job_error_message,
        mj.updated_at AS job_updated_at,
        mj.attempts AS job_attempts
      FROM swipes
      LEFT JOIN LATERAL (
        SELECT id, status, error_message, updated_at, attempts
        FROM media_jobs
        WHERE input->>'swipe_id' = swipes.id::text
        ORDER BY created_at DESC
        LIMIT 1
      ) mj ON true
      WHERE product_id = ${productId}
      ORDER BY created_at DESC
      LIMIT 200
    `
    return NextResponse.json(rows)
  } catch (error) {
    console.error('List swipes error:', error)
    return NextResponse.json({ error: 'Failed to list swipes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const productId = String(body.product_id || '').trim()
    const transcript = String(body.transcript || '').trim()
    const titleInput = String(body.title || '').trim()
    const avatarId = body.avatar_id ? String(body.avatar_id) : null
    const positioningId = body.positioning_id ? String(body.positioning_id) : null

    if (!productId || !transcript) {
      return NextResponse.json({ error: 'product_id and transcript are required' }, { status: 400 })
    }

    const productRows = await sql`
      SELECT products.id, products.name, brands.name AS brand_name, brands.organization_id AS organization_id
      FROM products
      LEFT JOIN brands ON brands.id = products.brand_id
      WHERE products.id = ${productId}
      LIMIT 1
    `
    const product = productRows[0]
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    let avatarName: string | null = null
    if (avatarId) {
      const rows = await sql`SELECT name FROM avatars WHERE id = ${avatarId} LIMIT 1`
      avatarName = rows[0]?.name || null
    }

    let positioningName: string | null = null
    if (positioningId) {
      const rows = await sql`SELECT name FROM pitches WHERE id = ${positioningId} LIMIT 1`
      positioningName = rows[0]?.name || null
    }

    const blocks = await loadGlobalPromptBlocks()
    let title = titleInput
    const autoNamed = !title
    if (!title) {
      title = await generateSwipeTitle({
        productName: product.name,
        brandName: product.brand_name || null,
        avatarName,
        positioningName,
        transcript,
        orgId: product.organization_id || null,
        blocks,
      })
    }

    if (autoNamed) {
      const base = title.slice(0, 58)
      let candidate = title
      for (let i = 2; i <= 6; i += 1) {
        const rows = await sql`
          SELECT 1
          FROM swipes
          WHERE product_id = ${productId}
            AND title = ${candidate}
          LIMIT 1
        `
        if (rows.length === 0) break
        candidate = `${base}-${i}`
      }
      title = candidate
    }

    const manualId = crypto.randomUUID()
    const sourceUrl = `manual:${manualId}`

    const rows = await sql`
      INSERT INTO swipes (
        product_id,
        source,
        source_url,
        status,
        title,
        transcript,
        metadata,
        created_by
      )
      VALUES (
        ${productId},
        'manual',
        ${sourceUrl},
        'ready',
        ${title},
        ${transcript},
        ${{ avatar_id: avatarId, positioning_id: positioningId }},
        ${user.id}
      )
      RETURNING *
    `
    return NextResponse.json(rows[0])
  } catch (error) {
    console.error('Create swipe error:', error)
    return NextResponse.json({ error: 'Failed to create swipe' }, { status: 500 })
  }
}
