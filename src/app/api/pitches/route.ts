import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { z } from 'zod'

const createPitchSchema = z.object({
  product_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  type: z.string().optional(),
  is_active: z.boolean().optional(),
})

// GET /api/pitches - List pitches with filtering
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('product_id')
    const activeOnly = searchParams.get('active_only') === 'true'

    let rows = await sql`
      SELECT *
      FROM pitches
      ORDER BY created_at DESC
    `

    if (productId) {
      rows = rows.filter((row: any) => row.product_id === productId)
    }

    if (activeOnly) {
      rows = rows.filter((row: any) => row.is_active)
    }

    return NextResponse.json(rows)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/pitches - Create a new pitch
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = createPitchSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    try {
      const rows = await sql`
        INSERT INTO pitches (product_id, name, content, type, is_active)
        VALUES (
          ${validated.data.product_id},
          ${validated.data.name},
          ${validated.data.content},
          ${validated.data.type ?? 'general'},
          ${validated.data.is_active ?? true}
        )
        RETURNING *
      `
      return NextResponse.json(rows[0], { status: 201 })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'Database error' }, { status: 500 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
