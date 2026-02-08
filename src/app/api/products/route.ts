import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { createProductSchema } from '@/lib/validations'
import { requireAuth } from '@/lib/require-auth'

// GET /api/products - List all products (optionally filtered by brand)
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const brandId = searchParams.get('brand_id')

    const rows = brandId
      ? await sql`
          SELECT
            products.*,
            jsonb_build_object(
              'name', brands.name,
              'slug', brands.slug,
              'organization_id', brands.organization_id
            ) AS brands
          FROM products
          JOIN brands ON brands.id = products.brand_id
          WHERE products.brand_id = ${brandId}
          ORDER BY products.created_at DESC
        `
      : await sql`
          SELECT
            products.*,
            jsonb_build_object(
              'name', brands.name,
              'slug', brands.slug,
              'organization_id', brands.organization_id
            ) AS brands
          FROM products
          JOIN brands ON brands.id = products.brand_id
          ORDER BY products.created_at DESC
        `

    const mappedData = rows.map((product: Record<string, unknown>) => ({
      ...product,
      content: (product.context as Record<string, unknown>)?.content || '',
    }))

    return NextResponse.json(mappedData)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/products - Create a new product
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json()
    const validated = createProductSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    // Map 'content' to 'context' for database (products table uses context JSONB)
    const { content, ...rest } = validated.data
    const insertContext = { content }

    try {
      const rows = await sql`
        INSERT INTO products (brand_id, name, slug, context)
        VALUES (
          ${rest.brand_id},
          ${rest.name},
          ${rest.slug},
          ${insertContext}
        )
        RETURNING *
      `

      const data = rows[0]
      const responseData = {
        ...data,
        content: data.context?.content || '',
      }

      return NextResponse.json(responseData, { status: 201 })
    } catch (error: any) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'Product with this slug already exists for this brand' },
          { status: 409 }
        )
      }
      if (error?.code === '23503') {
        return NextResponse.json(
          { error: 'Brand not found' },
          { status: 404 }
        )
      }
      return NextResponse.json({ error: error?.message || 'Database error' }, { status: 500 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
