import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createPromptBlockSchema } from '@/lib/validations'

// GET /api/prompt-blocks - List prompt blocks with filtering
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const scope = searchParams.get('scope')
    const scopeId = searchParams.get('scope_id')
    const activeOnly = searchParams.get('active_only') !== 'false' // Default true

    const supabase = createAdminClient()

    let query = supabase
      .from('prompt_blocks')
      .select('*')
      .order('type', { ascending: true })
      .order('version', { ascending: false })

    if (type) {
      query = query.eq('type', type)
    }

    if (scope) {
      query = query.eq('scope', scope)
    }

    if (scopeId) {
      query = query.eq('scope_id', scopeId)
    }

    if (activeOnly) {
      query = query.eq('is_active', true)
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

// POST /api/prompt-blocks - Create a new prompt block
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('POST /api/prompt-blocks - received body:', JSON.stringify(body, null, 2))

    const validated = createPromptBlockSchema.safeParse(body)

    if (!validated.success) {
      console.error('Validation failed:', validated.error.flatten())
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Check if we need to version (same name + type + scope + scope_id)
    const { data: existing } = await supabase
      .from('prompt_blocks')
      .select('version')
      .eq('name', validated.data.name)
      .eq('type', validated.data.type)
      .eq('scope', validated.data.scope)
      .eq('scope_id', validated.data.scope_id ?? '')
      .order('version', { ascending: false })
      .limit(1)
      .single()

    const nextVersion = existing ? existing.version + 1 : 1

    // If creating a new version, deactivate the old one
    if (existing) {
      await supabase
        .from('prompt_blocks')
        .update({ is_active: false })
        .eq('name', validated.data.name)
        .eq('type', validated.data.type)
        .eq('scope', validated.data.scope)
        .eq('scope_id', validated.data.scope_id ?? '')
    }

    const { data, error } = await supabase
      .from('prompt_blocks')
      .insert({
        ...validated.data,
        version: nextVersion,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
