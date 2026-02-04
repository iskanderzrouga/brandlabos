import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  try {
    const rows = await sql`
      SELECT *
      FROM agent_threads
      WHERE id = ${id}
        AND user_id = ${user.id}
      LIMIT 1
    `
    const thread = rows[0]
    if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(thread)
  } catch (error) {
    console.error('Get thread error:', error)
    return NextResponse.json({ error: 'Failed to fetch thread' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  try {
    const body = await request.json()
    const nextContext = body.context && typeof body.context === 'object' ? body.context : null
    const nextTitle = typeof body.title === 'string' ? body.title : undefined

    const rows = await sql`
      SELECT id, context, title
      FROM agent_threads
      WHERE id = ${id}
        AND user_id = ${user.id}
      LIMIT 1
    `
    const thread = rows[0]
    if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const mergedContext = nextContext ? { ...(thread.context || {}), ...nextContext } : thread.context
    const title = nextTitle !== undefined ? nextTitle : thread.title

    const updatedRows = await sql`
      UPDATE agent_threads
      SET context = ${mergedContext}, title = ${title}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `
    return NextResponse.json(updatedRows[0])
  } catch (error) {
    console.error('Patch thread error:', error)
    return NextResponse.json({ error: 'Failed to update thread' }, { status: 500 })
  }
}
