import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

function deriveTitleFromContent(content: string) {
  const firstLine = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstLine) return null
  return firstLine.slice(0, 120)
}

export async function GET(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const productId = String(searchParams.get('product_id') || '').trim()
  const q = String(searchParams.get('q') || '').trim()
  const categoryId = String(searchParams.get('category_id') || '').trim()
  const status = String(searchParams.get('status') || '').trim()

  if (!productId) {
    return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
  }

  try {
    const conditions: string[] = ['research_items.product_id = $1']
    const values: any[] = [productId]
    let idx = 2

    if (q) {
      conditions.push(
        `(research_items.title ILIKE $${idx} OR research_items.summary ILIKE $${idx} OR research_items.content ILIKE $${idx})`
      )
      values.push(`%${q}%`)
      idx += 1
    }

    if (categoryId) {
      conditions.push(`research_items.category_id = $${idx}`)
      values.push(categoryId)
      idx += 1
    }

    if (status) {
      conditions.push(`research_items.status = $${idx}`)
      values.push(status)
      idx += 1
    }

    const query = `
      SELECT
        research_items.*,
        research_categories.name AS category_name,
        (
          SELECT mj.status
          FROM media_jobs mj
          WHERE mj.input->>'research_item_id' = research_items.id::text
          ORDER BY mj.created_at DESC
          LIMIT 1
        ) AS job_status
      FROM research_items
      LEFT JOIN research_categories ON research_categories.id = research_items.category_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY research_items.created_at DESC
      LIMIT 200
    `

    const rows = await sql.query(query, values)
    return NextResponse.json(rows)
  } catch (error) {
    console.error('List research items error:', error)
    return NextResponse.json({ error: 'Failed to list research items' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const productId = String(body.product_id || '').trim()
    const type = String(body.type || '').trim()
    const categoryId = body.category_id ? String(body.category_id) : null

    if (!productId || !type) {
      return NextResponse.json({ error: 'product_id and type are required' }, { status: 400 })
    }

    if (type === 'text') {
      const content = String(body.content || '').trim()
      if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })
      const title = body.title ? String(body.title).trim() : deriveTitleFromContent(content)
      const summary = body.summary ? String(body.summary).trim() : null

      const rows = await sql`
        INSERT INTO research_items (
          product_id, category_id, type, title, summary, content, source_url, status, created_by
        )
        VALUES (
          ${productId},
          ${categoryId},
          'text',
          ${title},
          ${summary},
          ${content},
          ${null},
          'inbox',
          ${user.id}
        )
        RETURNING *
      `
      return NextResponse.json(rows[0])
    }

    if (type === 'file') {
      const file = body.file || {}
      const r2Key = String(file.key || '').trim()
      const filename = String(file.filename || '').trim()
      const mime = file.mime ? String(file.mime) : null
      const size = file.size ? Number(file.size) : null

      if (!r2Key || !filename) {
        return NextResponse.json({ error: 'file.key and file.filename are required' }, { status: 400 })
      }

      const fileRows = await sql`
        INSERT INTO research_files (product_id, filename, mime, size_bytes, r2_key, status)
        VALUES (${productId}, ${filename}, ${mime}, ${size}, ${r2Key}, 'uploaded')
        RETURNING *
      `
      const fileRow = fileRows[0]

      const itemRows = await sql`
        INSERT INTO research_items (
          product_id, category_id, type, title, file_id, status, created_by
        )
        VALUES (
          ${productId},
          ${categoryId},
          'file',
          ${filename},
          ${fileRow.id},
          'processing',
          ${user.id}
        )
        RETURNING *
      `
      const item = itemRows[0]

      await sql`
        INSERT INTO media_jobs (type, status, input)
        VALUES (
          'ingest_research_file',
          'queued',
          ${{
            research_item_id: item.id,
            file_id: fileRow.id,
            product_id: productId,
            r2_key: r2Key,
            filename,
            mime,
            user_id: user.id,
          }}
        )
      `

      return NextResponse.json(item)
    }

    return NextResponse.json({ error: 'Unsupported type' }, { status: 400 })
  } catch (error) {
    console.error('Create research item error:', error)
    return NextResponse.json({ error: 'Failed to create research item' }, { status: 500 })
  }
}
