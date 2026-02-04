import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

export async function GET(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const threadId = String(searchParams.get('thread_id') || '').trim()
  if (!threadId) return NextResponse.json({ error: 'thread_id is required' }, { status: 400 })

  try {
    const threadRows = await sql`
      SELECT id
      FROM agent_threads
      WHERE id = ${threadId}
        AND user_id = ${user.id}
      LIMIT 1
    `
    if (!threadRows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const rows = await sql`
      SELECT id, role, content, created_at
      FROM agent_messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC
      LIMIT 200
    `
    return NextResponse.json(rows)
  } catch (error) {
    console.error('List messages error:', error)
    return NextResponse.json({ error: 'Failed to list messages' }, { status: 500 })
  }
}

