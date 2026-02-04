import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

const DEFAULT_THREAD_CONTEXT = {
  skill: 'ugc_video_scripts',
  versions: 1,
  avatar_ids: [],
  positioning_id: null,
  active_swipe_id: null,
  research_ids: [],
}

export async function GET(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const productId = String(searchParams.get('product_id') || '').trim()
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') || 50)))

  if (!productId) {
    return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
  }

  try {
    const rows = await sql`
      SELECT id, title, draft_title, draft_content, context, updated_at, created_at
      FROM agent_threads
      WHERE product_id = ${productId}
        AND user_id = ${user.id}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `
    return NextResponse.json(rows)
  } catch (error) {
    console.error('List threads error:', error)
    return NextResponse.json({ error: 'Failed to list threads' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const productId = String(body.product_id || '').trim()
    const reuseLatest = Boolean(body.reuse_latest)
    const providedContext = body.context && typeof body.context === 'object' ? body.context : null
    if (!productId) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
    }

    if (reuseLatest) {
      const existingRows = await sql`
        SELECT *
        FROM agent_threads
        WHERE product_id = ${productId}
          AND user_id = ${user.id}
        ORDER BY updated_at DESC
        LIMIT 1
      `
      const existing = existingRows[0]
      if (existing) {
        return NextResponse.json(existing)
      }
    }

    const context = providedContext || DEFAULT_THREAD_CONTEXT
    const rows = await sql`
      INSERT INTO agent_threads (product_id, user_id, title, context)
      VALUES (${productId}, ${user.id}, ${null}, ${context})
      RETURNING *
    `
    const thread = rows[0]
    return NextResponse.json(thread)
  } catch (error) {
    console.error('Create thread error:', error)
    return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 })
  }
}
