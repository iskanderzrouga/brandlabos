import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { updateAppUserSchema } from '@/lib/validations'

type Params = { params: Promise<{ id: string }> }

// GET /api/users/[id] - Get single user with access info
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
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
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/users/[id] - Update user
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await request.json()

    const validated = updateAppUserSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('app_users')
      .update(validated.data)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/users/[id] - Delete user from both app_users and Supabase Auth
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    // First get the user to find their auth_user_id
    const { data: appUser, error: fetchError } = await supabase
      .from('app_users')
      .select('auth_user_id')
      .eq('id', id)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    // Delete from app_users table
    const { error: deleteError } = await supabase
      .from('app_users')
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    // Delete from Supabase Auth (if not placeholder)
    if (appUser.auth_user_id && appUser.auth_user_id !== '00000000-0000-0000-0000-000000000000') {
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(appUser.auth_user_id)
      if (authDeleteError) {
        console.error('Failed to delete from Supabase Auth:', authDeleteError)
        // Don't fail - app_users record is already deleted
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
