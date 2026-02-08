import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

type Params = { params: Promise<{ id: string }> }

// POST /api/prompt-blocks/[id]/reset - Soft-reset a prompt block
// Sets is_active = false (preserving as version history) instead of deleting.
// Optionally tags the row with a preset_name in metadata.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const presetName = typeof body.preset_name === 'string' ? body.preset_name.trim() : null

    const existingRows = await sql`
      SELECT * FROM prompt_blocks WHERE id = ${id} LIMIT 1
    `
    if (!existingRows[0]) {
      return NextResponse.json({ error: 'Prompt block not found' }, { status: 404 })
    }

    const block = existingRows[0]

    // Non-super_admin can only reset their own user-scoped blocks or global blocks
    if (user.role !== 'super_admin' && block.user_id && block.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (presetName) {
      const existingMeta = typeof block.metadata === 'object' && block.metadata ? block.metadata : {}
      const updatedMeta = { ...existingMeta, preset_name: presetName }

      await sql`
        UPDATE prompt_blocks
        SET is_active = false, metadata = ${updatedMeta}
        WHERE id = ${id}
      `
    } else {
      await sql`
        UPDATE prompt_blocks
        SET is_active = false
        WHERE id = ${id}
      `
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
