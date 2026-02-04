import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { clearAuthCookie, readAuthCookie, verifyAuthToken } from '@/lib/auth'

export async function GET() {
  try {
    const token = await readAuthCookie()
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAuthToken(token)
    const userId = payload.sub as string | undefined
    if (!userId) {
      await clearAuthCookie()
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rows = await sql`
      SELECT id, email, name, role, is_active
      FROM app_users
      WHERE id = ${userId}
      LIMIT 1
    `

    const user = rows[0]
    if (!user || !user.is_active) {
      await clearAuthCookie()
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    })
  } catch (error) {
    console.error('Auth me error:', error)
    await clearAuthCookie()
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
