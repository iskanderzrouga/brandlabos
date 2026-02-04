import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { createOrganizationSchema } from '@/lib/validations'

// GET /api/organizations - List all organizations
export async function GET() {
  try {
    const rows = await sql`
      SELECT *
      FROM organizations
      ORDER BY created_at DESC
    `

    return NextResponse.json(rows)
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/organizations - Create a new organization
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = createOrganizationSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    try {
      const rows = await sql`
        INSERT INTO organizations (name, slug)
        VALUES (${validated.data.name}, ${validated.data.slug})
        RETURNING *
      `
      return NextResponse.json(rows[0], { status: 201 })
    } catch (error: any) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'Organization with this slug already exists' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error?.message || 'Database error' }, { status: 500 })
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
