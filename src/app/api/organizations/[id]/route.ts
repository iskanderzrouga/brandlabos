import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { updateOrganizationSchema } from '@/lib/validations'
import { requireAuth } from '@/lib/require-auth'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id] - Get single organization
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const rows = await sql`
      SELECT *
      FROM organizations
      WHERE id = ${id}
      LIMIT 1
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/organizations/[id] - Update organization
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const body = await request.json()
    const validated = updateOrganizationSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const name = validated.data.name ?? null
    const slug = validated.data.slug ?? null

    const rows = await sql`
      UPDATE organizations
      SET
        name = COALESCE(${name}, name),
        slug = COALESCE(${slug}, slug),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/organizations/[id] - Delete organization
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const rows = await sql`
      DELETE FROM organizations
      WHERE id = ${id}
      RETURNING id
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
