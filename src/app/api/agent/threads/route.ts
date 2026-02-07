import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

const DEFAULT_THREAD_CONTEXT = {
  skill: 'ugc_video_scripts',
  skills: ['ugc_video_scripts'],
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

    // Clean up empty untitled threads (no title, no draft, no messages)
    await sql`
      DELETE FROM agent_threads
      WHERE user_id = ${user.id}
        AND product_id = ${productId}
        AND title IS NULL
        AND (draft_title IS NULL OR draft_title = '')
        AND (draft_content IS NULL OR draft_content = '')
        AND NOT EXISTS (
          SELECT 1 FROM agent_messages WHERE thread_id = agent_threads.id
        )
        AND id != ${thread.id}
    `

    return NextResponse.json(thread)
  } catch (error) {
    console.error('Create thread error:', error)
    return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const ids = Array.isArray(body?.ids)
      ? body.ids
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean)
      : []

    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 })
    }

    const uniqueIds = Array.from(new Set(ids)).slice(0, 200)

    const rows = await sql`
      DELETE FROM agent_threads
      WHERE user_id = ${user.id}
        AND id = ANY(${uniqueIds})
      RETURNING id
    `

    const deletedIds = rows.map((row: any) => String(row.id))

    return NextResponse.json({
      success: true,
      requested: uniqueIds.length,
      deleted: deletedIds.length,
      deleted_ids: deletedIds,
    })
  } catch (error) {
    console.error('Bulk delete threads error:', error)
    return NextResponse.json({ error: 'Failed to delete threads' }, { status: 500 })
  }
}
