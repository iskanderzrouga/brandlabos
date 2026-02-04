import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

// POST /api/users/[id]/access - Add access (org or brand level)
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id: userId } = await params
    const body = await request.json()
    const { type, organization_id, brand_id } = body

    const supabase = createAdminClient()

    if (type === 'organization' && organization_id) {
      const { data, error } = await supabase
        .from('user_organization_access')
        .insert({ user_id: userId, organization_id })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            { error: 'User already has access to this organization' },
            { status: 409 }
          )
        }
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json(data, { status: 201 })
    }

    if (type === 'brand' && brand_id) {
      const { data, error } = await supabase
        .from('user_brand_access')
        .insert({ user_id: userId, brand_id })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            { error: 'User already has access to this brand' },
            { status: 409 }
          )
        }
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json(data, { status: 201 })
    }

    return NextResponse.json(
      { error: 'Invalid access type or missing id' },
      { status: 400 }
    )
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/users/[id]/access - Remove access
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id: userId } = await params
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const accessId = searchParams.get('access_id')

    if (!type || !accessId) {
      return NextResponse.json(
        { error: 'Missing type or access_id parameter' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    if (type === 'organization') {
      const { error } = await supabase
        .from('user_organization_access')
        .delete()
        .eq('id', accessId)
        .eq('user_id', userId)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    } else if (type === 'brand') {
      const { error } = await supabase
        .from('user_brand_access')
        .delete()
        .eq('id', accessId)
        .eq('user_id', userId)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    } else {
      return NextResponse.json({ error: 'Invalid access type' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
