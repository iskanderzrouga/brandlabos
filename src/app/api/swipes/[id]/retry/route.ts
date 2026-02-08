import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

const STALE_MS = 10 * 60 * 1000

type Params = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: Params) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const swipeRows = await sql`
      SELECT id, product_id, source, source_url, status, updated_at, created_at
      FROM swipes
      WHERE id = ${id}
      LIMIT 1
    `
    const swipe = swipeRows[0]
    if (!swipe) return NextResponse.json({ error: 'Swipe not found' }, { status: 404 })

    if (!swipe.source_url) {
      return NextResponse.json({ error: 'Retry is only available for URL-based swipes' }, { status: 400 })
    }

    const jobRows = await sql`
      SELECT id, status, updated_at
      FROM media_jobs
      WHERE type = 'ingest_meta_ad'
        AND input->>'swipe_id' = ${id}
      ORDER BY created_at DESC
      LIMIT 1
    `
    const job = jobRows[0]

    const referenceTime = job?.updated_at
      ? new Date(job.updated_at).getTime()
      : swipe.updated_at
        ? new Date(swipe.updated_at).getTime()
        : swipe.created_at
          ? new Date(swipe.created_at).getTime()
          : 0
    const stale = referenceTime > 0 && Date.now() - referenceTime > STALE_MS

    const canRetry =
      swipe.status === 'failed' || (swipe.status === 'processing' && stale)

    if (!canRetry) {
      return NextResponse.json(
        { error: 'Retry is only available for failed or stale processing swipes' },
        { status: 400 }
      )
    }

    if (job && (job.status === 'queued' || job.status === 'running')) {
      await sql`
        UPDATE media_jobs
        SET status = 'failed',
            error_message = 'manual_retry',
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
        WHERE id = ${job.id}
      `
    }

    await sql`
      UPDATE swipes
      SET status = 'processing',
          error_message = NULL,
          updated_at = NOW()
      WHERE id = ${id}
    `

    const createdJobs = await sql`
      INSERT INTO media_jobs (type, status, input)
      VALUES (
        'ingest_meta_ad',
        'queued',
        ${{
          swipe_id: swipe.id,
          product_id: swipe.product_id,
          url: swipe.source_url,
          user_id: user.id,
        }}
      )
      RETURNING id
    `

    return NextResponse.json({
      success: true,
      swipe_id: swipe.id,
      job_id: createdJobs[0]?.id || null,
      status: 'processing',
    })
  } catch (error) {
    console.error('Retry swipe error:', error)
    return NextResponse.json({ error: 'Failed to retry swipe' }, { status: 500 })
  }
}
