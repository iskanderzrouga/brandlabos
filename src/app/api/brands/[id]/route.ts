import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { updateBrandSchema } from '@/lib/validations'
import { requireAuth } from '@/lib/require-auth'

type Params = { params: Promise<{ id: string }> }

// GET /api/brands/[id] - Get single brand with organization
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const rows = await sql`
      SELECT
        brands.*,
        jsonb_build_object('name', organizations.name, 'slug', organizations.slug) AS organizations,
        COALESCE(
          jsonb_agg(
            jsonb_build_object('id', products.id, 'name', products.name, 'slug', products.slug)
            ORDER BY products.created_at DESC
          ) FILTER (WHERE products.id IS NOT NULL),
          '[]'
        ) AS products
      FROM brands
      JOIN organizations ON organizations.id = brands.organization_id
      LEFT JOIN products ON products.brand_id = brands.id
      WHERE brands.id = ${id}
      GROUP BY brands.id, organizations.name, organizations.slug
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/brands/[id] - Update brand
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const body = await request.json()
    const validated = updateBrandSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const name = validated.data.name ?? null
    const slug = validated.data.slug ?? null
    const voiceGuidelines = validated.data.voice_guidelines ?? null
    const logoUrl = validated.data.logo_url ?? null
    const metadata = validated.data.metadata ?? null

    const rows = await sql`
      UPDATE brands
      SET
        name = COALESCE(${name}, name),
        slug = COALESCE(${slug}, slug),
        voice_guidelines = COALESCE(${voiceGuidelines}, voice_guidelines),
        logo_url = COALESCE(${logoUrl}, logo_url),
        metadata = COALESCE(${metadata}, metadata),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/brands/[id] - Delete brand
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const rows = await sql`
      DELETE FROM brands
      WHERE id = ${id}
      RETURNING id
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
