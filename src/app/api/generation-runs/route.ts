import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createGenerationRunSchema } from '@/lib/validations'
import { promptAssembler } from '@/lib/services/prompt-assembler'

// GET /api/generation-runs - List generation runs (filtered by product)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('product_id')
    const featureType = searchParams.get('feature_type')
    const status = searchParams.get('status')

    console.log('=== Generation Runs API ===')
    console.log('Query params:', { productId, featureType, status })

    const supabase = createAdminClient()

    // Simple query without join to avoid potential issues
    let query = supabase
      .from('generation_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (productId) {
      query = query.eq('product_id', productId)
    }

    if (featureType) {
      query = query.eq('feature_type', featureType)
    }

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    console.log('Query result:', {
      error: error?.message,
      dataCount: data?.length,
      firstItem: data?.[0]?.id
    })

    if (error) {
      console.error('Generation runs query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Generation runs API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/generation-runs - Create a new generation run and assemble prompt
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = createGenerationRunSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Create the generation run in pending state
    const { data: run, error: createError } = await supabase
      .from('generation_runs')
      .insert({
        product_id: validated.data.product_id,
        feature_type: validated.data.feature_type,
        config: validated.data.config,
        status: 'pending',
      })
      .select()
      .single()

    if (createError) {
      if (createError.code === '23503') {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 })
      }
      return NextResponse.json({ error: createError.message }, { status: 500 })
    }

    // Assemble the prompt
    try {
      const assembledPrompt = await promptAssembler.assemble({
        productId: validated.data.product_id,
        avatarIds: validated.data.config.avatar_ids,
        userInstructions: validated.data.config.user_instructions,
      })

      // Update the run with the assembled prompt
      const { data: updatedRun, error: updateError } = await supabase
        .from('generation_runs')
        .update({
          assembled_prompt: JSON.stringify(assembledPrompt),
          status: 'pending', // Ready for AI processing
        })
        .eq('id', run.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      return NextResponse.json(
        {
          ...updatedRun,
          assembled_prompt_parsed: assembledPrompt,
        },
        { status: 201 }
      )
    } catch (assemblyError) {
      // If prompt assembly fails, mark run as failed
      await supabase
        .from('generation_runs')
        .update({
          status: 'failed',
          error_message: assemblyError instanceof Error ? assemblyError.message : 'Prompt assembly failed',
        })
        .eq('id', run.id)

      return NextResponse.json(
        { error: 'Prompt assembly failed', details: assemblyError instanceof Error ? assemblyError.message : 'Unknown error' },
        { status: 500 }
      )
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
