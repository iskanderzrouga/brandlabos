import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { promptAssembler } from '@/lib/services/prompt-assembler'
import { sql } from '@/lib/db'
import { getOrgApiKey } from '@/lib/api-keys'

interface GenerateRequest {
  product_id: string
  avatar_ids: string[]
  pitch_id?: string
  content_type?: string
  num_concepts?: number
  user_instructions?: string
  custom_prompt?: string // User-edited system prompt from Glass Box
  prompt_overrides?: Record<string, string> // One-off prompt module overrides
}

// Map frontend content types to database enum values
const contentTypeToDbEnum: Record<string, string> = {
  organic_static: 'static_organic_ads',
  ugc_video_scripts: 'scripts',
  landing_page_copy: 'landing_pages',
  advertorial_copy: 'landing_pages', // closest match
}

interface ConceptCard {
  concept_name: string
  image_description: string
  image_prompt: string
  copy_variants: {
    hook: string
    body: string
    cta: string
  }[]
}

interface GenerationResponse {
  concepts: ConceptCard[]
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json()

    if (!body.product_id || !body.avatar_ids?.length) {
      return NextResponse.json(
        { error: 'product_id and avatar_ids are required' },
        { status: 400 }
      )
    }

    const orgRows = await sql`
      SELECT brands.organization_id AS organization_id
      FROM products
      LEFT JOIN brands ON brands.id = products.brand_id
      WHERE products.id = ${body.product_id}
      LIMIT 1
    `
    const orgId = orgRows[0]?.organization_id as string | undefined
    const anthropicKey = await getOrgApiKey('anthropic', orgId || null)
    if (!anthropicKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
    }
    const anthropic = new Anthropic({ apiKey: anthropicKey })

    // Assemble the prompt (or use custom if provided)
    const numConcepts = body.num_concepts || 3
    const assembled = await promptAssembler.assemble({
      productId: body.product_id,
      avatarIds: body.avatar_ids,
      pitchId: body.pitch_id,
      contentType: body.content_type,
      userInstructions: body.user_instructions,
      numConcepts,
      promptOverrides: body.prompt_overrides,
    })

    // Use custom prompt if provided (Glass Box editing)
    const systemPrompt = body.custom_prompt || assembled.systemPrompt

    // Call Claude
    const message = await anthropic.messages.create({
      model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-opus-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: assembled.userPrompt,
        },
      ],
      system: systemPrompt,
    })

    // Extract the text response
    const textContent = message.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude')
    }

    // Parse the JSON from the response
    let concepts: GenerationResponse
    try {
      // Extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = textContent.text.match(/```json\s*([\s\S]*?)\s*```/) ||
                        textContent.text.match(/```\s*([\s\S]*?)\s*```/) ||
                        [null, textContent.text]

      const jsonStr = jsonMatch[1] || textContent.text
      concepts = JSON.parse(jsonStr.trim())
    } catch (parseError) {
      console.error('Failed to parse Claude response:', textContent.text)
      throw new Error('Failed to parse generation response as JSON')
    }

    // Create generation run
    let run = null
    let saveError = null
    try {
      // Convert frontend content type to database enum value
      const dbFeatureType = contentTypeToDbEnum[body.content_type || 'organic_static'] || 'static_organic_ads'
      console.log('Attempting to save generation run for product:', body.product_id, 'feature_type:', dbFeatureType)

      const rows = await sql`
        INSERT INTO generation_runs (
          product_id,
          feature_type,
          status,
          config,
          assembled_prompt,
          raw_response,
          completed_at
        ) VALUES (
          ${body.product_id},
          ${dbFeatureType},
          'completed',
          ${{
            avatar_ids: body.avatar_ids,
            pitch_id: body.pitch_id,
            content_type: body.content_type,
            num_concepts: numConcepts,
            user_instructions: body.user_instructions,
          }},
          ${JSON.stringify(assembled)},
          ${concepts},
          ${new Date().toISOString()}
        )
        RETURNING *
      `

      run = rows[0] ?? null
      if (!run) {
        saveError = 'Failed to save generation run'
      } else {
        console.log('Generation run saved successfully:', run?.id)
      }
    } catch (dbError) {
      console.error('Database error saving generation run:', dbError)
      saveError = dbError instanceof Error ? dbError.message : 'Unknown DB error'
    }

    // Save assets
    if (run && concepts.concepts) {
      const assets = concepts.concepts.map((concept) => ({
        generation_run_id: run.id,
        type: 'concept_card' as const,
        content: concept,
      }))

      for (const asset of assets) {
        await sql`
          INSERT INTO assets (generation_run_id, type, content)
          VALUES (${asset.generation_run_id}, ${asset.type}, ${asset.content})
        `
      }
    }

    return NextResponse.json({
      success: true,
      run_id: run?.id,
      concepts: concepts.concepts,
      metadata: assembled.metadata,
      save_error: saveError,
    })
  } catch (error) {
    console.error('Generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Generation failed' },
      { status: 500 }
    )
  }
}
