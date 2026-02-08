import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { updatePromptBlockSchema } from '@/lib/validations'
import { requireAuth } from '@/lib/require-auth'

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
// If user_id is provided in body and the block is global, creates a user-scoped copy instead
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await request.json()

    const userId = typeof body.user_id === 'string' ? body.user_id : null

    const validated = updatePromptBlockSchema.safeParse(body)

    if (!validated.success) {
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

    // If user_id provided and block is global (no user_id), create a user-scoped copy
    if (userId && !existing.user_id && validated.data.content) {
      const metadataKey =
        typeof (validated.data.metadata as { key?: string } | undefined)?.key === 'string'
          ? (validated.data.metadata as { key?: string }).key
          : typeof (existing.metadata as { key?: string } | undefined)?.key === 'string'
            ? (existing.metadata as { key?: string }).key
            : null

      // Deactivate any existing user-scoped block with same key
      if (metadataKey) {
        await sql`
          UPDATE prompt_blocks
          SET is_active = false
          WHERE scope = ${existing.scope}
            AND COALESCE(scope_id::text, '') = COALESCE(${existing.scope_id}::text, '')
            AND user_id = ${userId}
            AND (metadata->>'key') = ${metadataKey}
            AND is_active = true
        `
      }

      // Create user-scoped copy
      const newRows = await sql`
        INSERT INTO prompt_blocks (
          name,
          type,
          scope,
          scope_id,
          user_id,
          content,
          version,
          is_active,
          metadata
        ) VALUES (
          ${validated.data.name ?? existing.name},
          ${existing.type},
          ${existing.scope},
          ${existing.scope_id},
          ${userId},
          ${validated.data.content},
          1,
          true,
          ${validated.data.metadata ?? existing.metadata ?? {}}
        )
        RETURNING *
      `

      return NextResponse.json(newRows[0])
    }

    // If content is changing, create a new version instead of updating
    if (validated.data.content && validated.data.content !== existing.content) {
      const metadataKey =
        typeof (validated.data.metadata as { key?: string } | undefined)?.key === 'string'
          ? (validated.data.metadata as { key?: string }).key
          : typeof (existing.metadata as { key?: string } | undefined)?.key === 'string'
            ? (existing.metadata as { key?: string }).key
            : null

      if (metadataKey) {
        if (existing.scope_id) {
          await sql`
            UPDATE prompt_blocks
            SET is_active = false
            WHERE scope = ${existing.scope}
              AND scope_id = ${existing.scope_id}
              AND COALESCE(user_id::text, '') = COALESCE(${existing.user_id}::text, '')
              AND (metadata->>'key') = ${metadataKey}
              AND is_active = true
          `
        } else {
          await sql`
            UPDATE prompt_blocks
            SET is_active = false
            WHERE scope = ${existing.scope}
              AND scope_id IS NULL
              AND COALESCE(user_id::text, '') = COALESCE(${existing.user_id}::text, '')
              AND (metadata->>'key') = ${metadataKey}
              AND is_active = true
          `
        }
      }

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
          user_id,
          content,
          version,
          is_active,
          metadata
        ) VALUES (
          ${validated.data.name ?? existing.name},
          ${existing.type},
          ${existing.scope},
          ${existing.scope_id},
          ${existing.user_id},
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
// Non-super_admin can only delete their own user-scoped blocks
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const user = await requireAuth()

    const existingRows = await sql`
      SELECT id, user_id FROM prompt_blocks WHERE id = ${id} LIMIT 1
    `
    if (!existingRows[0]) {
      return NextResponse.json({ error: 'Prompt block not found' }, { status: 404 })
    }

    const block = existingRows[0]

    // Non-super_admin can only delete their own user-scoped blocks
    if (user && user.role !== 'super_admin' && block.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
