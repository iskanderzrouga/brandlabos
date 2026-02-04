import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

// POST /api/users/[id]/access - Add access (org or brand level)
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id: userId } = await params
    const body = await request.json()
    const { type, organization_id, brand_id } = body

    if (type === 'organization' && organization_id) {
      try {
        const rows = await sql`
          INSERT INTO user_organization_access (user_id, organization_id)
          VALUES (${userId}, ${organization_id})
          RETURNING *
        `

        return NextResponse.json(rows[0], { status: 201 })
      } catch (error: any) {
        if (error?.code === '23505') {
          return NextResponse.json(
            { error: 'User already has access to this organization' },
            { status: 409 }
          )
        }
        return NextResponse.json({ error: error?.message || 'Database error' }, { status: 500 })
      }
    }

    if (type === 'brand' && brand_id) {
      try {
        const rows = await sql`
          INSERT INTO user_brand_access (user_id, brand_id)
          VALUES (${userId}, ${brand_id})
          RETURNING *
        `

        return NextResponse.json(rows[0], { status: 201 })
      } catch (error: any) {
        if (error?.code === '23505') {
          return NextResponse.json(
            { error: 'User already has access to this brand' },
            { status: 409 }
          )
        }
        return NextResponse.json({ error: error?.message || 'Database error' }, { status: 500 })
      }
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

    if (type === 'organization') {
      await sql`
        DELETE FROM user_organization_access
        WHERE id = ${accessId}
          AND user_id = ${userId}
      `
    } else if (type === 'brand') {
      await sql`
        DELETE FROM user_brand_access
        WHERE id = ${accessId}
          AND user_id = ${userId}
      `
    } else {
      return NextResponse.json({ error: 'Invalid access type' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
