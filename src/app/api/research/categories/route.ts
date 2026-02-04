import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

export async function GET(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const productId = String(searchParams.get('product_id') || '').trim()

  if (!productId) {
    return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
  }

  try {
    const categories = await sql`
      SELECT
        research_categories.*,
        COUNT(research_items.id) AS item_count
      FROM research_categories
      LEFT JOIN research_items
        ON research_items.category_id = research_categories.id
      WHERE research_categories.product_id = ${productId}
      GROUP BY research_categories.id
      ORDER BY research_categories.sort_order ASC, research_categories.created_at ASC
    `

    const inboxRows = await sql`
      SELECT COUNT(*)::int AS count
      FROM research_items
      WHERE product_id = ${productId}
        AND status = 'inbox'
    `

    return NextResponse.json({
      categories,
      inbox_count: inboxRows[0]?.count || 0,
    })
  } catch (error) {
    console.error('List research categories error:', error)
    return NextResponse.json({ error: 'Failed to list categories' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const productId = String(body.product_id || '').trim()
    const name = String(body.name || '').trim()
    const description = body.description ? String(body.description) : null

    if (!productId || !name) {
      return NextResponse.json({ error: 'product_id and name are required' }, { status: 400 })
    }

    const rows = await sql`
      INSERT INTO research_categories (product_id, name, description, created_by)
      VALUES (${productId}, ${name}, ${description}, ${user.id})
      RETURNING *
    `
    return NextResponse.json(rows[0])
  } catch (error) {
    console.error('Create research category error:', error)
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }
}
