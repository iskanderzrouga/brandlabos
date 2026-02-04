import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import type { Json } from '@/types/database'

type Params = { params: Promise<{ id: string }> }

// GET /api/assets/[id] - Get single asset
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const rows = await sql`
      SELECT
        assets.*,
        jsonb_build_object(
          'product_id', generation_runs.product_id,
          'feature_type', generation_runs.feature_type,
          'config', generation_runs.config
        ) AS generation_runs
      FROM assets
      JOIN generation_runs ON generation_runs.id = assets.generation_run_id
      WHERE assets.id = ${id}
      LIMIT 1
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/assets/[id] - Update asset content or metadata
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await request.json()

    // Only allow updating content and metadata
    const updateData: { content?: Json; metadata?: Json } = {}
    if (body.content !== undefined) {
      updateData.content = body.content
    }
    if (body.metadata !== undefined) {
      updateData.metadata = body.metadata
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const content = updateData.content ?? null
    const metadata = updateData.metadata ?? null

    const rows = await sql`
      UPDATE assets
      SET
        content = COALESCE(${content}, content),
        metadata = COALESCE(${metadata}, metadata)
      WHERE id = ${id}
      RETURNING *
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/assets/[id] - Delete asset
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const rows = await sql`
      DELETE FROM assets
      WHERE id = ${id}
      RETURNING id
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
