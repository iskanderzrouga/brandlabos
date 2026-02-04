import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createAssetSchema } from '@/lib/validations'

// GET /api/assets - List assets (filtered by generation run)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const generationRunId = searchParams.get('generation_run_id')
    const type = searchParams.get('type')

    if (!generationRunId) {
      return NextResponse.json(
        { error: 'generation_run_id is required' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    let query = supabase
      .from('assets')
      .select('*')
      .eq('generation_run_id', generationRunId)
      .order('created_at', { ascending: true })

    if (type) {
      query = query.eq('type', type)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/assets - Create a new asset
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = createAssetSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('assets')
      .insert(validated.data)
      .select()
      .single()

    if (error) {
      if (error.code === '23503') {
        return NextResponse.json(
          { error: 'Generation run not found' },
          { status: 404 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/assets/bulk - Create multiple assets at once
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()

    if (!Array.isArray(body.assets)) {
      return NextResponse.json(
        { error: 'assets array is required' },
        { status: 400 }
      )
    }

    const validatedAssets = []
    for (const asset of body.assets) {
      const validated = createAssetSchema.safeParse(asset)
      if (!validated.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: validated.error.flatten() },
          { status: 400 }
        )
      }
      validatedAssets.push(validated.data)
    }

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('assets')
      .insert(validatedAssets)
      .select()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
