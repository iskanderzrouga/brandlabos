import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

// GET /api/generation-runs/[id] - Get single generation run with assets
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const rows = await sql`
      SELECT
        generation_runs.*,
        jsonb_build_object('name', products.name, 'slug', products.slug, 'brand_id', products.brand_id) AS products,
        COALESCE(
          jsonb_agg(assets ORDER BY assets.created_at ASC) FILTER (WHERE assets.id IS NOT NULL),
          '[]'
        ) AS assets
      FROM generation_runs
      LEFT JOIN products ON products.id = generation_runs.product_id
      LEFT JOIN assets ON assets.generation_run_id = generation_runs.id
      WHERE generation_runs.id = ${id}
      GROUP BY generation_runs.id, products.name, products.slug, products.brand_id
    `

    const data = rows[0]

    if (!data) {
      return NextResponse.json({ error: 'Generation run not found' }, { status: 404 })
    }

    if (data.assembled_prompt) {
      try {
        data.assembled_prompt_parsed = JSON.parse(data.assembled_prompt)
      } catch {
        // Keep as string if not valid JSON
      }
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/generation-runs/[id] - Update generation run (status, response, etc.)
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await request.json()

    // Only allow updating specific fields
    const allowedFields = ['status', 'raw_response', 'error_message', 'completed_at']
    const updateData: Record<string, unknown> = {}

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Auto-set completed_at if status is completed or failed
    if (updateData.status === 'completed' || updateData.status === 'failed') {
      updateData.completed_at = new Date().toISOString()
    }

    const status = updateData.status ?? null
    const rawResponse = updateData.raw_response ?? null
    const errorMessage = updateData.error_message ?? null
    const completedAt = updateData.completed_at ?? null

    const rows = await sql`
      UPDATE generation_runs
      SET
        status = COALESCE(${status}, status),
        raw_response = COALESCE(${rawResponse}, raw_response),
        error_message = COALESCE(${errorMessage}, error_message),
        completed_at = COALESCE(${completedAt}, completed_at)
      WHERE id = ${id}
      RETURNING *
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Generation run not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/generation-runs/[id] - Delete generation run and its assets
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const rows = await sql`
      DELETE FROM generation_runs
      WHERE id = ${id}
      RETURNING id
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Generation run not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
