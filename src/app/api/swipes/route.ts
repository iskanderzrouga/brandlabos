import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

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
