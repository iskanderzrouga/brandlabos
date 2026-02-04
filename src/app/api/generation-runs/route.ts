import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
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

    let rows
    if (productId && featureType && status) {
      rows = await sql`
        SELECT *
        FROM generation_runs
        WHERE product_id = ${productId}
          AND feature_type = ${featureType}
          AND status = ${status}
        ORDER BY created_at DESC
        LIMIT 50
      `
    } else if (productId && featureType) {
      rows = await sql`
        SELECT *
        FROM generation_runs
        WHERE product_id = ${productId}
          AND feature_type = ${featureType}
        ORDER BY created_at DESC
        LIMIT 50
      `
    } else if (productId && status) {
      rows = await sql`
        SELECT *
        FROM generation_runs
        WHERE product_id = ${productId}
          AND status = ${status}
        ORDER BY created_at DESC
        LIMIT 50
      `
    } else if (featureType && status) {
      rows = await sql`
        SELECT *
        FROM generation_runs
        WHERE feature_type = ${featureType}
          AND status = ${status}
        ORDER BY created_at DESC
        LIMIT 50
      `
    } else if (productId) {
      rows = await sql`
        SELECT *
        FROM generation_runs
        WHERE product_id = ${productId}
        ORDER BY created_at DESC
        LIMIT 50
      `
    } else if (featureType) {
      rows = await sql`
        SELECT *
        FROM generation_runs
        WHERE feature_type = ${featureType}
        ORDER BY created_at DESC
        LIMIT 50
      `
    } else if (status) {
      rows = await sql`
        SELECT *
        FROM generation_runs
        WHERE status = ${status}
        ORDER BY created_at DESC
        LIMIT 50
      `
    } else {
      rows = await sql`
        SELECT *
        FROM generation_runs
        ORDER BY created_at DESC
        LIMIT 50
      `
    }

    console.log('Query result:', {
      dataCount: rows?.length,
      firstItem: rows?.[0]?.id
    })

    return NextResponse.json(rows || [])
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

    // Create the generation run in pending state
    let run
    try {
      const rows = await sql`
        INSERT INTO generation_runs (
          product_id,
          feature_type,
          config,
          status
        ) VALUES (
          ${validated.data.product_id},
          ${validated.data.feature_type},
          ${validated.data.config},
          'pending'
        )
        RETURNING *
      `
      run = rows[0]
    } catch (error: any) {
      if (error?.code === '23503') {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error?.message || 'Database error' }, { status: 500 })
    }

    // Assemble the prompt
    try {
      const assembledPrompt = await promptAssembler.assemble({
        productId: validated.data.product_id,
        avatarIds: validated.data.config.avatar_ids,
        userInstructions: validated.data.config.user_instructions,
      })

      // Update the run with the assembled prompt
      const updatedRows = await sql`
        UPDATE generation_runs
        SET
          assembled_prompt = ${JSON.stringify(assembledPrompt)},
          status = 'pending'
        WHERE id = ${run.id}
        RETURNING *
      `

      const updatedRun = updatedRows[0]
      return NextResponse.json(
        {
          ...updatedRun,
          assembled_prompt_parsed: assembledPrompt,
        },
        { status: 201 }
      )
    } catch (assemblyError) {
      // If prompt assembly fails, mark run as failed
      await sql`
        UPDATE generation_runs
        SET
          status = 'failed',
          error_message = ${assemblyError instanceof Error ? assemblyError.message : 'Prompt assembly failed'}
        WHERE id = ${run.id}
      `

      return NextResponse.json(
        { error: 'Prompt assembly failed', details: assemblyError instanceof Error ? assemblyError.message : 'Unknown error' },
        { status: 500 }
      )
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
