import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { updateAvatarSchema } from '@/lib/validations'

type Params = { params: Promise<{ id: string }> }

// GET /api/avatars/[id] - Get single avatar
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const rows = await sql`
      SELECT
        avatars.*,
        jsonb_build_object(
          'name', products.name,
          'slug', products.slug,
          'brand_id', products.brand_id,
          'context', products.context,
          'brands', jsonb_build_object(
            'name', brands.name,
            'slug', brands.slug,
            'organization_id', brands.organization_id
          )
        ) AS products
      FROM avatars
      JOIN products ON products.id = avatars.product_id
      JOIN brands ON brands.id = products.brand_id
      WHERE avatars.id = ${id}
      LIMIT 1
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Avatar not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/avatars/[id] - Update avatar
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await request.json()
    const validated = updateAvatarSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const name = validated.data.name ?? null
    const content = validated.data.content ?? null
    const isActive = validated.data.is_active ?? null

    const rows = await sql`
      UPDATE avatars
      SET
        name = COALESCE(${name}, name),
        content = COALESCE(${content}, content),
        is_active = COALESCE(${isActive}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Avatar not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/avatars/[id] - Delete avatar
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const rows = await sql`
      DELETE FROM avatars
      WHERE id = ${id}
      RETURNING id
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Avatar not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
