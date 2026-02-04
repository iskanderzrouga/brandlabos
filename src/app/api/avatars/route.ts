import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { createAvatarSchema } from '@/lib/validations'

// GET /api/avatars - List all avatars (optionally filtered by product)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('product_id')
    const activeOnly = searchParams.get('active_only') === 'true'

    const baseQuery = activeOnly
      ? sql`
          SELECT
            avatars.*,
            jsonb_build_object('name', products.name, 'slug', products.slug, 'brand_id', products.brand_id) AS products
          FROM avatars
          JOIN products ON products.id = avatars.product_id
          WHERE avatars.is_active = true
          ORDER BY avatars.created_at DESC
        `
      : sql`
          SELECT
            avatars.*,
            jsonb_build_object('name', products.name, 'slug', products.slug, 'brand_id', products.brand_id) AS products
          FROM avatars
          JOIN products ON products.id = avatars.product_id
          ORDER BY avatars.created_at DESC
        `

    let rows = await baseQuery

    if (productId) {
      rows = rows.filter((row: any) => row.product_id === productId)
    }

    return NextResponse.json(rows)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/avatars - Create a new avatar
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = createAvatarSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    try {
      const rows = await sql`
        INSERT INTO avatars (product_id, name, content, is_active)
        VALUES (
          ${validated.data.product_id},
          ${validated.data.name},
          ${validated.data.content},
          ${validated.data.is_active ?? true}
        )
        RETURNING *
      `

      return NextResponse.json(rows[0], { status: 201 })
    } catch (error: any) {
      if (error?.code === '23503') {
        return NextResponse.json(
          { error: 'Product not found' },
          { status: 404 }
        )
      }
      return NextResponse.json({ error: error?.message || 'Database error' }, { status: 500 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
