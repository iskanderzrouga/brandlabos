import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { verifyPassword } from '@/lib/passwords'
import { setAuthCookie, signAuthToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    const users = await sql`
      SELECT id, email, name, role, is_active, password_hash
      FROM app_users
      WHERE lower(email) = ${email}
      LIMIT 1
    `

    const user = users[0]
    if (!user || !user.is_active || !user.password_hash) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const ok = await verifyPassword(password, user.password_hash)
    if (!ok) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = await signAuthToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    })

    await setAuthCookie(token)

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
