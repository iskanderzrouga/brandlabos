import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

function isMetaAdLibraryUrl(url: string) {
  try {
    const u = new URL(url)
    return u.hostname.includes('facebook.com') && u.pathname.includes('/ads/library')
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const productId = String(body.product_id || '').trim()
    const sourceUrl = String(body.url || '').trim()

    if (!productId || !sourceUrl) {
      return NextResponse.json({ error: 'product_id and url are required' }, { status: 400 })
    }

    if (!isMetaAdLibraryUrl(sourceUrl)) {
      return NextResponse.json({ error: 'Only Meta Ad Library URLs are supported in v1' }, { status: 400 })
    }

    // Create or reuse swipe for this product + URL
    const swipeRows = await sql`
      INSERT INTO swipes (product_id, source, source_url, status, created_by)
      VALUES (${productId}, 'meta_ad_library', ${sourceUrl}, 'processing', ${user.id})
      ON CONFLICT (product_id, source, source_url) DO UPDATE SET
        updated_at = NOW(),
        status = CASE WHEN swipes.status = 'failed' THEN 'processing' ELSE swipes.status END,
        error_message = CASE WHEN swipes.status = 'failed' THEN NULL ELSE swipes.error_message END
      RETURNING *
    `
    const swipe = swipeRows[0]
    if (!swipe) {
      return NextResponse.json({ error: 'Failed to create swipe' }, { status: 500 })
    }

    // If already ready, no need to enqueue
    if (swipe.status === 'ready') {
      return NextResponse.json({ swipe_id: swipe.id, job_id: null, status: swipe.status })
    }

    // Check for existing queued/running job for this swipe
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

    if (existingJob) {
      return NextResponse.json({ swipe_id: swipe.id, job_id: existingJob.id, status: swipe.status })
    }

    const jobRows = await sql`
      INSERT INTO media_jobs (type, status, input)
      VALUES (
        'ingest_meta_ad',
        'queued',
        ${{
          swipe_id: swipe.id,
          product_id: productId,
          url: sourceUrl,
          user_id: user.id,
        }}
      )
      RETURNING *
    `
    const job = jobRows[0]

    return NextResponse.json({
      swipe_id: swipe.id,
      job_id: job?.id ?? null,
      status: swipe.status,
    })
  } catch (error) {
    console.error('Ingest meta swipe error:', error)
    return NextResponse.json({ error: 'Failed to ingest swipe' }, { status: 500 })
  }
}

