import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createProductSchema } from '@/lib/validations'

// GET /api/products - List all products (optionally filtered by brand)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const brandId = searchParams.get('brand_id')

    const supabase = createAdminClient()

    let query = supabase
      .from('products')
      .select('*, brands(name, slug, organization_id)')
      .order('created_at', { ascending: false })

    if (brandId) {
      query = query.eq('brand_id', brandId)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Map context to content for UI
    const mappedData = data?.map((product: Record<string, unknown>) => ({
      ...product,
      content: (product.context as Record<string, unknown>)?.content || '',
    })) || []

    return NextResponse.json(mappedData)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/products - Create a new product
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = createProductSchema.safeParse(body)

    if (!validated.success) {
      console.error('Product validation failed:', validated.error.flatten())
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Map 'content' to 'context' for database (products table uses context JSONB)
    const { content, ...rest } = validated.data
    const insertData = {
      ...rest,
      context: { content }, // Store content inside the context JSONB field
    }

    const { data, error } = await supabase
      .from('products')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('Product creation error:', error)
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Product with this slug already exists for this brand' },
          { status: 409 }
        )
      }
      if (error.code === '23503') {
        return NextResponse.json(
          { error: 'Brand not found' },
          { status: 404 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Map context back to content for UI
    const responseData = {
      ...data,
      content: data.context?.content || '',
    }

    return NextResponse.json(responseData, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
