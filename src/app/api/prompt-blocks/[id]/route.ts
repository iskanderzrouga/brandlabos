import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { updatePromptBlockSchema } from '@/lib/validations'

type Params = { params: Promise<{ id: string }> }

// GET /api/prompt-blocks/[id] - Get single prompt block
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const rows = await sql`
      SELECT *
      FROM prompt_blocks
      WHERE id = ${id}
      LIMIT 1
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Prompt block not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/prompt-blocks/[id] - Update prompt block (creates new version if content changes)
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await request.json()
    console.log('PATCH /api/prompt-blocks/' + id + ' - received body keys:', Object.keys(body))

    const validated = updatePromptBlockSchema.safeParse(body)

    if (!validated.success) {
      console.error('PATCH validation failed:', validated.error.flatten())
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const existingRows = await sql`
      SELECT *
      FROM prompt_blocks
      WHERE id = ${id}
      LIMIT 1
    `

    const existing = existingRows[0]
    if (!existing) {
      return NextResponse.json({ error: 'Prompt block not found' }, { status: 404 })
    }

    // If content is changing, create a new version instead of updating
    if (validated.data.content && validated.data.content !== existing.content) {
      // Deactivate current version
      await sql`
        UPDATE prompt_blocks
        SET is_active = false
        WHERE id = ${id}
      `

      // Create new version
      const newRows = await sql`
        INSERT INTO prompt_blocks (
          name,
          type,
          scope,
          scope_id,
          content,
          version,
          is_active,
          metadata
        ) VALUES (
          ${validated.data.name ?? existing.name},
          ${existing.type},
          ${existing.scope},
          ${existing.scope_id},
          ${validated.data.content},
          ${existing.version + 1},
          true,
          ${validated.data.metadata ?? existing.metadata ?? {}}
        )
        RETURNING *
      `

      return NextResponse.json(newRows[0])
    }

    // Otherwise, just update metadata/name/is_active
    const name = validated.data.name ?? null
    const isActive = validated.data.is_active ?? null
    const metadata = validated.data.metadata ?? null

    const rows = await sql`
      UPDATE prompt_blocks
      SET
        name = COALESCE(${name}, name),
        is_active = COALESCE(${isActive}, is_active),
        metadata = COALESCE(${metadata}, metadata)
      WHERE id = ${id}
      RETURNING *
    `

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/prompt-blocks/[id] - Delete prompt block
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const rows = await sql`
      DELETE FROM prompt_blocks
      WHERE id = ${id}
      RETURNING id
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'Prompt block not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
