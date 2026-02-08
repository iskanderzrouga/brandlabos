import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { createAssetSchema } from '@/lib/validations'
import { requireAuth } from '@/lib/require-auth'

// GET /api/assets - List assets (filtered by generation run)
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const generationRunId = searchParams.get('generation_run_id')
    const type = searchParams.get('type')

    if (!generationRunId) {
      return NextResponse.json(
        { error: 'generation_run_id is required' },
        { status: 400 }
      )
    }

    let rows = await sql`
      SELECT *
      FROM assets
      WHERE generation_run_id = ${generationRunId}
      ORDER BY created_at ASC
    `

    if (type) {
      rows = rows.filter((row: any) => row.type === type)
    }

    return NextResponse.json(rows)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/assets - Create a new asset
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json()
    const validated = createAssetSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    try {
      const rows = await sql`
        INSERT INTO assets (generation_run_id, type, content, metadata)
        VALUES (
          ${validated.data.generation_run_id},
          ${validated.data.type},
          ${validated.data.content},
          ${validated.data.metadata ?? {}}
        )
        RETURNING *
      `
      return NextResponse.json(rows[0], { status: 201 })
    } catch (error: any) {
      if (error?.code === '23503') {
        return NextResponse.json(
          { error: 'Generation run not found' },
          { status: 404 }
        )
      }
      return NextResponse.json({ error: error?.message || 'Database error' }, { status: 500 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/assets/bulk - Create multiple assets at once
export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json()

    if (!Array.isArray(body.assets)) {
      return NextResponse.json(
        { error: 'assets array is required' },
        { status: 400 }
      )
    }

    const validatedAssets = []
    for (const asset of body.assets) {
      const validated = createAssetSchema.safeParse(asset)
      if (!validated.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: validated.error.flatten() },
          { status: 400 }
        )
      }
      validatedAssets.push(validated.data)
    }

    const inserted = []
    for (const asset of validatedAssets) {
      const rows = await sql`
        INSERT INTO assets (generation_run_id, type, content, metadata)
        VALUES (
          ${asset.generation_run_id},
          ${asset.type},
          ${asset.content},
          ${asset.metadata ?? {}}
        )
        RETURNING *
      `
      if (rows[0]) inserted.push(rows[0])
    }

    return NextResponse.json(inserted, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
