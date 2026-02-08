import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'

const updatePitchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  type: z.string().optional(),
  is_active: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string }> }

// GET /api/pitches/[id] - Get single pitch
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const rows = await sql`
      SELECT *
      FROM pitches
      WHERE id = ${id}
      LIMIT 1
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Pitch not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/pitches/[id] - Update pitch
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const body = await request.json()
    const validated = updatePitchSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const name = validated.data.name ?? null
    const content = validated.data.content ?? null
    const type = validated.data.type ?? null
    const isActive = validated.data.is_active ?? null

    const rows = await sql`
      UPDATE pitches
      SET
        name = COALESCE(${name}, name),
        content = COALESCE(${content}, content),
        type = COALESCE(${type}, type),
        is_active = COALESCE(${isActive}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Pitch not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/pitches/[id] - Delete pitch
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const rows = await sql`
      DELETE FROM pitches
      WHERE id = ${id}
      RETURNING id
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Pitch not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
