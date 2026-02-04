import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { updatePromptBlockSchema } from '@/lib/validations'

type Params = { params: Promise<{ id: string }> }

// GET /api/prompt-blocks/[id] - Get single prompt block
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('prompt_blocks')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Prompt block not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/prompt-blocks/[id] - Update prompt block (creates new version if content changes)
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await request.json()
    console.log('PATCH /api/prompt-blocks/' + id + ' - received body keys:', Object.keys(body))

    const validated = updatePromptBlockSchema.safeParse(body)

    if (!validated.success) {
      console.error('PATCH validation failed:', validated.error.flatten())
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Get existing block
    const { data: existing, error: fetchError } = await supabase
      .from('prompt_blocks')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Prompt block not found' }, { status: 404 })
      }
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    // If content is changing, create a new version instead of updating
    if (validated.data.content && validated.data.content !== existing.content) {
      // Deactivate current version
      await supabase
        .from('prompt_blocks')
        .update({ is_active: false })
        .eq('id', id)

      // Create new version
      const { data: newVersion, error: createError } = await supabase
        .from('prompt_blocks')
        .insert({
          name: validated.data.name ?? existing.name,
          type: existing.type,
          scope: existing.scope,
          scope_id: existing.scope_id,
          content: validated.data.content,
          version: existing.version + 1,
          is_active: true,
          metadata: validated.data.metadata ?? existing.metadata,
        })
        .select()
        .single()

      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 })
      }

      return NextResponse.json(newVersion)
    }

    // Otherwise, just update metadata/name/is_active
    const { data, error } = await supabase
      .from('prompt_blocks')
      .update(validated.data)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/prompt-blocks/[id] - Delete prompt block
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { error } = await supabase
      .from('prompt_blocks')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
