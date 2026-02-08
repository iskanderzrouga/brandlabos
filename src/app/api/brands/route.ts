import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { createBrandSchema } from '@/lib/validations'
import { requireAuth } from '@/lib/require-auth'

// GET /api/brands - List all brands (optionally filtered by organization)
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organization_id')

    const rows = organizationId
      ? await sql`
          SELECT
            brands.*,
            jsonb_build_object('name', organizations.name, 'slug', organizations.slug) AS organizations
          FROM brands
          JOIN organizations ON organizations.id = brands.organization_id
          WHERE brands.organization_id = ${organizationId}
          ORDER BY brands.created_at DESC
        `
      : await sql`
          SELECT
            brands.*,
            jsonb_build_object('name', organizations.name, 'slug', organizations.slug) AS organizations
          FROM brands
          JOIN organizations ON organizations.id = brands.organization_id
          ORDER BY brands.created_at DESC
        `

    return NextResponse.json(rows)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/brands - Create a new brand
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json()
    const validated = createBrandSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    try {
      const rows = await sql`
        INSERT INTO brands (organization_id, name, slug, voice_guidelines, logo_url, metadata)
        VALUES (
          ${validated.data.organization_id},
          ${validated.data.name},
          ${validated.data.slug},
          ${validated.data.voice_guidelines ?? null},
          ${validated.data.logo_url ?? null},
          ${validated.data.metadata ?? {}}
        )
        RETURNING *
      `

      return NextResponse.json(rows[0], { status: 201 })
    } catch (error: any) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'Brand with this slug already exists in this organization' },
          { status: 409 }
        )
      }
      if (error?.code === '23503') {
        return NextResponse.json(
          { error: 'Organization not found' },
          { status: 404 }
        )
      }
      return NextResponse.json({ error: error?.message || 'Database error' }, { status: 500 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
