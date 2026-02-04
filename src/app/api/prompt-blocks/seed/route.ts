import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'

// Map our default block keys to proper database types
const BLOCK_TYPE_MAP: Record<string, string> = {
  // Content type templates
  organic_static: 'feature_template',
  ugc_video_scripts: 'feature_template',
  landing_page_copy: 'feature_template',
  advertorial_copy: 'feature_template',
  // Shared blocks
  output_format: 'output_format',
  writing_rules: 'global_rules',
  zoom_deep: 'feature_template',
  zoom_broad: 'feature_template',
  // Legacy
  global_rules: 'global_rules',
}

// POST /api/prompt-blocks/seed - Seed default prompt blocks
export async function POST() {
  try {
    const countRows = await sql`SELECT COUNT(*)::int AS count FROM prompt_blocks`
    const count = countRows[0]?.count ?? 0

    if (count > 0) {
      return NextResponse.json({
        message: 'Prompt blocks already exist',
        count
      })
    }

    // Insert all default blocks
    const blocksToInsert = Object.entries(DEFAULT_PROMPT_BLOCKS).map(([key, block]) => ({
      name: block.name,
      type: BLOCK_TYPE_MAP[key] || 'custom',
      scope: 'global',
      content: block.content,
      version: 1,
      is_active: true,
      metadata: { key }, // Store original key for reference
    }))

    const inserted = []
    for (const block of blocksToInsert) {
      const rows = await sql`
        INSERT INTO prompt_blocks (
          name,
          type,
          scope,
          content,
          version,
          is_active,
          metadata
        ) VALUES (
          ${block.name},
          ${block.type},
          ${block.scope},
          ${block.content},
          ${block.version},
          ${block.is_active},
          ${block.metadata}
        )
        RETURNING *
      `
      if (rows[0]) inserted.push(rows[0])
    }

    return NextResponse.json({
      message: 'Default prompt blocks seeded',
      count: inserted.length,
      blocks: inserted
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/prompt-blocks/seed - Re-seed missing blocks without overwriting existing
export async function GET() {
  try {
    const existingBlocks = await sql`
      SELECT metadata
      FROM prompt_blocks
    `

    const existingKeys = new Set(
      existingBlocks?.map(b => (b.metadata as { key?: string })?.key).filter(Boolean) || []
    )

    // Find missing blocks
    const missingBlocks = Object.entries(DEFAULT_PROMPT_BLOCKS)
      .filter(([key]) => !existingKeys.has(key))
      .map(([key, block]) => ({
        name: block.name,
        type: BLOCK_TYPE_MAP[key] || 'custom',
        scope: 'global',
        content: block.content,
        version: 1,
        is_active: true,
        metadata: { key },
      }))

    if (missingBlocks.length === 0) {
      return NextResponse.json({
        message: 'All blocks already exist',
        added: 0
      })
    }

    const inserted = []
    for (const block of missingBlocks) {
      const rows = await sql`
        INSERT INTO prompt_blocks (
          name,
          type,
          scope,
          content,
          version,
          is_active,
          metadata
        ) VALUES (
          ${block.name},
          ${block.type},
          ${block.scope},
          ${block.content},
          ${block.version},
          ${block.is_active},
          ${block.metadata}
        )
        RETURNING *
      `
      if (rows[0]) inserted.push(rows[0])
    }

    return NextResponse.json({
      message: 'Missing prompt blocks added',
      added: inserted.length,
      blocks: inserted.map(b => b.name)
    })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
