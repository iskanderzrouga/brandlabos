import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { sql } from '@/lib/db'
import { getOrgApiKey } from '@/lib/api-keys'

// POST /api/generate-avatar-name - Generate a descriptive avatar name
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { content, product_id } = body

    if (!content || !product_id) {
      return NextResponse.json(
        { error: 'content and product_id are required' },
        { status: 400 }
      )
    }

    // Get existing avatar names to avoid duplicates
    const existingAvatars = await sql`
      SELECT name
      FROM avatars
      WHERE product_id = ${product_id}
    `

    const existingNames = existingAvatars?.map((a) => a.name.toLowerCase()) || []

    const orgRows = await sql`
      SELECT brands.organization_id AS organization_id
      FROM products
      LEFT JOIN brands ON brands.id = products.brand_id
      WHERE products.id = ${product_id}
      LIMIT 1
    `
    const orgId = orgRows[0]?.organization_id as string | undefined
    const anthropicKey = await getOrgApiKey('anthropic', orgId || null)
    if (!anthropicKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
    }
    const anthropic = new Anthropic({ apiKey: anthropicKey })

    const systemPrompt = `You are a naming expert. Generate a short, descriptive avatar name (3-8 words, lowercase, hyphenated) based on the avatar profile provided.

The name should capture the essence of who this person is - their main job-to-be-done, awareness level, or key characteristic.

Examples of good names:
- frustrated-dieter-seeking-quick-fix
- skeptical-health-conscious-mom
- busy-professional-first-timer
- jaded-supplement-veteran
- curious-problem-aware-millennial

RULES:
- Use lowercase with hyphens
- 3-8 words maximum
- Be descriptive and memorable
- Focus on JTBD, awareness level, or key pain point
- Return ONLY the name, nothing else

These names are already taken, DO NOT use them:
${existingNames.join(', ') || 'none'}`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Generate a name for this avatar:\n\n${content.substring(0, 2000)}` }],
    })

    let generatedName = message.content[0].type === 'text'
      ? message.content[0].text.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      : 'unnamed-avatar'

    // If somehow it's still a duplicate, add a number
    let finalName = generatedName
    let counter = 1
    while (existingNames.includes(finalName.toLowerCase())) {
      finalName = `${generatedName}-${counter}`
      counter++
    }

    return NextResponse.json({ name: finalName })
  } catch (error) {
    console.error('Generate name error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate name' },
      { status: 500 }
    )
  }
}
