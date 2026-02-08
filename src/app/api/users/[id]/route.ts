import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { updateAppUserSchema } from '@/lib/validations'
import { hashPassword } from '@/lib/passwords'
import { requireAuth } from '@/lib/require-auth'

type Params = { params: Promise<{ id: string }> }

// GET /api/users/[id] - Get single user with access info
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = await params
    const users = await sql`
      SELECT id, email, name, role, is_active, created_at, updated_at
      FROM app_users
      WHERE id = ${id}
      LIMIT 1
    `

    const targetUser = users[0]
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const orgAccess = await sql`
      SELECT
        user_organization_access.organization_id,
        organizations.id AS org_id,
        organizations.name AS org_name
      FROM user_organization_access
      JOIN organizations ON organizations.id = user_organization_access.organization_id
      WHERE user_organization_access.user_id = ${id}
    `

    const response = {
      ...targetUser,
      user_organization_access: orgAccess.map((row) => ({
        organization_id: row.organization_id,
        organizations: { id: row.org_id, name: row.org_name },
      })),
    }

    return NextResponse.json(response)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/users/[id] - Update user
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = await params
    const body = await request.json()

    const validated = updateAppUserSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const name = validated.data.name ?? null
    const role = validated.data.role ?? null
    const isActive = validated.data.is_active ?? null
    const password = validated.data.password ?? null
    const passwordHash = password ? await hashPassword(password) : null
    const passwordResetAt = password ? new Date().toISOString() : null

    const rows = await sql`
      UPDATE app_users
      SET
        name = COALESCE(${name}, name),
        role = COALESCE(${role}, role),
        is_active = COALESCE(${isActive}, is_active),
        password_hash = COALESCE(${passwordHash}, password_hash),
        last_password_reset_at = COALESCE(${passwordResetAt}, last_password_reset_at),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, email, name, role, is_active, created_at, updated_at
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/users/[id] - Delete user from both app_users and Supabase Auth
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = await params
    const rows = await sql`
      DELETE FROM app_users
      WHERE id = ${id}
      RETURNING id
    `

    if (!rows[0]) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
