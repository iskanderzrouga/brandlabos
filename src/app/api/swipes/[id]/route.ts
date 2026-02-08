import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { deleteR2Object } from '@/lib/r2'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const full = searchParams.get('full') === '1'
  const { id } = await context.params

  try {
    const rows = await sql`
      SELECT
        swipes.*,
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
      WHERE swipes.id = ${id}
      LIMIT 1
    `
    const swipe = rows[0]
    if (!swipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!full && typeof swipe.transcript === 'string' && swipe.transcript.length > 4000) {
      swipe.transcript = swipe.transcript.slice(0, 4000) + '\n\n...(truncated)'
      swipe.transcript_truncated = true
    }

    return NextResponse.json(swipe)
  } catch (error) {
    console.error('Get swipe error:', error)
    return NextResponse.json({ error: 'Failed to fetch swipe' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  try {
    const rows = await sql`
      SELECT id, r2_video_key, r2_image_key
      FROM swipes
      WHERE id = ${id}
      LIMIT 1
    `
    const swipe = rows[0]
    if (!swipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await sql`
      DELETE FROM swipes
      WHERE id = ${id}
    `

    if (swipe.r2_video_key) {
      try {
        await deleteR2Object(swipe.r2_video_key)
      } catch (err) {
        console.warn('Failed to delete swipe video from R2:', err)
      }
    }

    if (swipe.r2_image_key) {
      try {
        await deleteR2Object(swipe.r2_image_key)
      } catch (err) {
        console.warn('Failed to delete swipe image from R2:', err)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete swipe error:', error)
    return NextResponse.json({ error: 'Failed to delete swipe' }, { status: 500 })
  }
}
