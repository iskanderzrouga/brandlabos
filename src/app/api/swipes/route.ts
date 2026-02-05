import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { getOrgApiKey } from '@/lib/api-keys'

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

async function generateSwipeTitle(args: {
  productName: string
  brandName?: string | null
  avatarName?: string | null
  positioningName?: string | null
  transcript: string
  orgId?: string | null
}) {
  const { productName, brandName, avatarName, positioningName, transcript, orgId } = args
  const excerpt = transcript.slice(0, 280)
  const key = await getOrgApiKey('anthropic', orgId || null)
  if (!key) {
    return normalizeSlug(excerpt || `${brandName || productName} swipe`)
  }
  const anthropic = new Anthropic({ apiKey: key })
  const prompt = `Generate a 3-5 word, lower-case, hyphen-separated title for a marketing swipe.\nReturn ONLY the slug, no punctuation besides hyphens.\n\nBrand: ${brandName || '(none)'}\nProduct: ${productName}\nAvatar: ${avatarName || '(none)'}\nAngle: ${positioningName || '(none)'}\nTranscript excerpt: ${excerpt}`
  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-opus-4-5-20251101',
    max_tokens: 60,
    temperature: 0.2,
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
          id, product_id, source, source_url, status, title, summary, created_at, updated_at,
          (
            SELECT mj.status
            FROM media_jobs mj
            WHERE mj.input->>'swipe_id' = swipes.id::text
            ORDER BY mj.created_at DESC
            LIMIT 1
          ) AS job_status
        FROM swipes
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
        id, product_id, source, source_url, status, title, summary, created_at, updated_at,
        (
          SELECT mj.status
          FROM media_jobs mj
          WHERE mj.input->>'swipe_id' = swipes.id::text
          ORDER BY mj.created_at DESC
          LIMIT 1
        ) AS job_status
      FROM swipes
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

    let title = titleInput
    if (!title) {
      title = await generateSwipeTitle({
        productName: product.name,
        brandName: product.brand_name || null,
        avatarName,
        positioningName,
        transcript,
        orgId: product.organization_id || null,
      })
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
