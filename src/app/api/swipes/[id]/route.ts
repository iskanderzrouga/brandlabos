import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const full = searchParams.get('full') === '1'
  const { id } = await context.params

  try {
    const rows = await sql`
      SELECT *
      FROM swipes
      WHERE id = ${id}
      LIMIT 1
    `
    const swipe = rows[0]
    if (!swipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!full && typeof swipe.transcript === 'string' && swipe.transcript.length > 4000) {
      swipe.transcript = swipe.transcript.slice(0, 4000) + '\n\n...(truncated)'
      swipe.transcript_truncated = true
    }

    return NextResponse.json(swipe)
  } catch (error) {
    console.error('Get swipe error:', error)
    return NextResponse.json({ error: 'Failed to fetch swipe' }, { status: 500 })
  }
}
