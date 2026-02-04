import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createAppUserSchema } from '@/lib/validations'

// GET /api/users - List all users with their access info
export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('app_users')
      .select(`
        *,
        user_organization_access (
          organization_id,
          organizations (id, name)
        ),
        user_brand_access (
          brand_id,
          brands (id, name)
        )
      `)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

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

    const supabase = createAdminClient()

    // Invite user via Supabase Auth - sends "You have been invited" email
    const { data: authData, error: authError } = await supabase.auth.admin.inviteUserByEmail(
      validated.data.email,
      {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback?type=invite`,
      }
    )

    if (authError) {
      // Check if user already exists in auth
      if (authError.message.includes('already been registered') || authError.message.includes('already exists')) {
        return NextResponse.json(
          { error: 'User with this email already exists in auth system' },
          { status: 409 }
        )
      }
      console.error('Auth invite error:', authError)
      return NextResponse.json({ error: authError.message }, { status: 500 })
    }

    // Create user in app_users with the actual auth_user_id
    const { data, error } = await supabase
      .from('app_users')
      .insert({
        ...validated.data,
        auth_user_id: authData.user.id,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'User with this email already exists' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Create user error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
