import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { updateProductSchema } from '@/lib/validations'
import { requireAuth } from '@/lib/require-auth'

type Params = { params: Promise<{ id: string }> }

// GET /api/products/[id] - Get single product with brand and avatars
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const rows = await sql`
      SELECT
        products.*,
        jsonb_build_object(
          'name', brands.name,
          'slug', brands.slug,
          'organization_id', brands.organization_id,
          'organizations', jsonb_build_object('name', organizations.name, 'slug', organizations.slug)
        ) AS brands,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', avatars.id,
              'name', avatars.name,
              'content', avatars.content,
              'is_active', avatars.is_active
            )
            ORDER BY avatars.created_at DESC
          ) FILTER (WHERE avatars.id IS NOT NULL),
          '[]'
        ) AS avatars
      FROM products
      JOIN brands ON brands.id = products.brand_id
      JOIN organizations ON organizations.id = brands.organization_id
      LEFT JOIN avatars ON avatars.product_id = products.id
      WHERE products.id = ${id}
      GROUP BY products.id, brands.name, brands.slug, brands.organization_id, organizations.name, organizations.slug
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const data = rows[0]
    const responseData = {
      ...data,
      content: data.context?.content || '',
    }

    return NextResponse.json(responseData)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/products/[id] - Update product
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const body = await request.json()
    const validated = updateProductSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const { content, ...rest } = validated.data
    const name = rest.name ?? null
    const slug = rest.slug ?? null
    const context = content !== undefined ? { content } : null

    const rows = await sql`
      UPDATE products
      SET
        name = COALESCE(${name}, name),
        slug = COALESCE(${slug}, slug),
        context = COALESCE(${context}, context),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const responseData = {
      ...rows[0],
      content: rows[0].context?.content || '',
    }

    return NextResponse.json(responseData)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/products/[id] - Delete product
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const rows = await sql`
      DELETE FROM products
      WHERE id = ${id}
      RETURNING id
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
