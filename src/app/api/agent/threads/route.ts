import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

const DEFAULT_THREAD_CONTEXT = {
  skill: 'ugc_video_scripts',
  versions: 1,
  avatar_ids: [],
  positioning_id: null,
  active_swipe_id: null,
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const productId = String(body.product_id || '').trim()
    if (!productId) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
    }

    // Reuse the most recent thread for this user+product.
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

    const rows = await sql`
      INSERT INTO agent_threads (product_id, user_id, title, context)
      VALUES (${productId}, ${user.id}, ${null}, ${DEFAULT_THREAD_CONTEXT})
      RETURNING *
    `
    const thread = rows[0]
    return NextResponse.json(thread)
  } catch (error) {
    console.error('Create thread error:', error)
    return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 })
  }
}

