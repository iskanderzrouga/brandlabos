import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { signR2GetObjectUrl } from '@/lib/r2'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  try {
    const rows = await sql`
      SELECT id, status, r2_video_key
      FROM swipes
      WHERE id = ${id}
      LIMIT 1
    `
    const swipe = rows[0]
    if (!swipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (swipe.status !== 'ready' || !swipe.r2_video_key) {
      return NextResponse.json({ error: 'Video not ready' }, { status: 409 })
    }

    const url = await signR2GetObjectUrl(swipe.r2_video_key, 120)
    return NextResponse.json({ url })
  } catch (error) {
    console.error('Sign swipe video url error:', error)
    return NextResponse.json({ error: 'Failed to sign video url' }, { status: 500 })
  }
}
