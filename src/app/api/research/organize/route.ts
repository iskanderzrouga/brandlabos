import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'
import { getOrgApiKey } from '@/lib/api-keys'

function parseJsonPayload(text: string) {
  const cleaned = (text.match(/```json\s*([\s\S]*?)\s*```/) || [null, text])[1].trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

type PromptBlockRow = {
  id: string
  type: string
  content: string
  metadata?: { key?: string }
}

async function loadGlobalPromptBlocks(): Promise<Map<string, PromptBlockRow>> {
  const blocks = await sql`
    SELECT id, type, content, metadata
    FROM prompt_blocks
    WHERE is_active = true
      AND scope = 'global'
    ORDER BY updated_at DESC NULLS LAST, version DESC, created_at DESC
  ` as PromptBlockRow[]

  const map = new Map<string, PromptBlockRow>()
  for (const b of blocks || []) {
    const key = (b.metadata as { key?: string } | undefined)?.key || b.type
    if (!map.has(key)) {
      map.set(key, b)
    }
  }
  return map
}

function getPromptBlockContent(blocks: Map<string, PromptBlockRow>, key: string): string {
  const db = blocks.get(key)?.content
  if (db) return db
  const fallback = (DEFAULT_PROMPT_BLOCKS as any)[key]?.content
  return typeof fallback === 'string' ? fallback : ''
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const productId = String(body.product_id || '').trim()
    const apply = Boolean(body.apply)

    if (!productId) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
    }

    if (apply) {
      const categories = Array.isArray(body.categories) ? body.categories : []
      const assignments = Array.isArray(body.assignments) ? body.assignments : []
      if (categories.length === 0 || assignments.length === 0) {
        return NextResponse.json({ error: 'categories and assignments are required' }, { status: 400 })
      }

      const existingRows = await sql`
        SELECT id, name
        FROM research_categories
        WHERE product_id = ${productId}
      `
      const byName = new Map(
        existingRows.map((row: any) => [String(row.name).toLowerCase(), row.id])
      )

      for (const cat of categories) {
        const name = String(cat.name || '').trim()
        if (!name) continue
        const key = name.toLowerCase()
        if (byName.has(key)) continue
        const rows = await sql`
          INSERT INTO research_categories (product_id, name, description, created_by)
          VALUES (${productId}, ${name}, ${cat.description || null}, ${user.id})
          RETURNING id
        `
        byName.set(key, rows[0].id)
      }

      for (const assignment of assignments) {
        const itemId = String(assignment.item_id || '').trim()
        const name = String(assignment.category_name || '').trim()
        if (!itemId || !name) continue
        const categoryId = byName.get(name.toLowerCase())
        if (!categoryId) continue
        await sql`
          UPDATE research_items
          SET category_id = ${categoryId},
              status = 'organized',
              updated_at = NOW()
          WHERE id = ${itemId}
            AND product_id = ${productId}
        `
      }

      return NextResponse.json({ ok: true })
    }

    const itemIds = Array.isArray(body.item_ids) ? body.item_ids : []
    const values: any[] = [productId]
    let idx = 2
    let extraCondition = ''
    if (itemIds.length > 0) {
      extraCondition = `AND id = ANY($${idx})`
      values.push(itemIds)
      idx += 1
    }
    const rows = await sql.query(
      `
      SELECT id, title, summary, content
      FROM research_items
      WHERE product_id = $1
        AND status = 'inbox'
        ${extraCondition}
      ORDER BY created_at DESC
      LIMIT 12
    `,
      values
    )

    if (!rows || rows.length === 0) {
      return NextResponse.json({ categories: [], assignments: [] })
    }

    const orgRows = await sql`
      SELECT brands.organization_id AS organization_id
      FROM products
      LEFT JOIN brands ON brands.id = products.brand_id
      WHERE products.id = ${productId}
      LIMIT 1
    `
    const orgId = orgRows[0]?.organization_id as string | undefined

    const anthropicKey = await getOrgApiKey('anthropic', orgId || null)
    if (!anthropicKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
    }

    const itemsText = rows
      .map(
        (item: any, idx: number) =>
          `${idx + 1}. ID: ${item.id}\nTitle: ${item.title || '(none)'}\nSummary: ${
            item.summary || ''
          }\nExcerpt: ${(item.content || '').slice(0, 600)}\n`
      )
      .join('\n')

    const blocks = await loadGlobalPromptBlocks()
    const system = getPromptBlockContent(blocks, 'research_organizer_system')
    const promptTemplate = getPromptBlockContent(blocks, 'research_organizer_prompt')
    const prompt = promptTemplate.replace(/{{\s*items\s*}}/gi, () => itemsText)

    const anthropic = new Anthropic({ apiKey: anthropicKey })
    const model = process.env.ANTHROPIC_ORGANIZE_MODEL || 'claude-3-5-haiku-latest'

    const message = await anthropic.messages.create({
      model,
      max_tokens: 600,
      system: system || 'You are a precise organizer. Output strict JSON only, no extra commentary.',
      messages: [{ role: 'user', content: prompt }],
    })

    const text = (message.content as any[]).find((c) => c.type === 'text')?.text || ''
    const parsed = parseJsonPayload(text)
    if (!parsed) {
      return NextResponse.json({ error: 'Failed to parse organizer output' }, { status: 500 })
    }

    return NextResponse.json(parsed)
  } catch (error) {
    console.error('Organize research error:', error)
    return NextResponse.json({ error: 'Failed to organize research' }, { status: 500 })
  }
}
