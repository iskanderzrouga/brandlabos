import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { createAppUserSchema } from '@/lib/validations'
import { hashPassword } from '@/lib/passwords'
import crypto from 'crypto'

// GET /api/users - List all users with their access info
export async function GET() {
  try {
    const users = await sql`
      SELECT id, email, name, role, is_active, created_at, updated_at
      FROM app_users
      ORDER BY created_at DESC
    `

    const orgAccess = await sql`
      SELECT
        user_organization_access.user_id,
        user_organization_access.organization_id,
        organizations.id AS org_id,
        organizations.name AS org_name
      FROM user_organization_access
      JOIN organizations ON organizations.id = user_organization_access.organization_id
    `

    const brandAccess = await sql`
      SELECT
        user_brand_access.user_id,
        user_brand_access.brand_id,
        brands.id AS brand_id,
        brands.name AS brand_name
      FROM user_brand_access
      JOIN brands ON brands.id = user_brand_access.brand_id
    `

    const orgByUser = new Map<string, Array<{ organization_id: string; organizations: { id: string; name: string } }>>()
    for (const row of orgAccess) {
      const list = orgByUser.get(row.user_id) || []
      list.push({
        organization_id: row.organization_id,
        organizations: { id: row.org_id, name: row.org_name },
      })
      orgByUser.set(row.user_id, list)
    }

    const brandByUser = new Map<string, Array<{ brand_id: string; brands: { id: string; name: string } }>>()
    for (const row of brandAccess) {
      const list = brandByUser.get(row.user_id) || []
      list.push({
        brand_id: row.brand_id,
        brands: { id: row.brand_id, name: row.brand_name },
      })
      brandByUser.set(row.user_id, list)
    }

    const data = users.map((user: any) => ({
      ...user,
      user_organization_access: orgByUser.get(user.id) || [],
      user_brand_access: brandByUser.get(user.id) || [],
    }))

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/users - Create a new user (admin only)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = createAppUserSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const email = validated.data.email.toLowerCase()
    const password = validated.data.password || crypto.randomBytes(9).toString('base64url')
    const passwordHash = await hashPassword(password)

    try {
      const rows = await sql`
        INSERT INTO app_users (email, name, role, is_active, password_hash, last_password_reset_at)
        VALUES (
          ${email},
          ${validated.data.name ?? null},
          ${validated.data.role},
          ${validated.data.is_active ?? true},
          ${passwordHash},
          ${new Date().toISOString()}
        )
        RETURNING id, email, name, role, is_active, created_at
      `

      const user = rows[0]
      return NextResponse.json(
        {
          ...user,
          temp_password: validated.data.password ? null : password,
        },
        { status: 201 }
      )
    } catch (error: any) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'User with this email already exists' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error?.message || 'Database error' }, { status: 500 })
    }
  } catch (error) {
    console.error('Create user error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
