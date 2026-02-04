import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

// POST /api/edit-content - Edit a specific piece of text with AI
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { original_text, edit_instruction, context } = body

    if (!original_text || !edit_instruction) {
      return NextResponse.json(
        { error: 'original_text and edit_instruction are required' },
        { status: 400 }
      )
    }

    const systemPrompt = `You are an expert copywriter helping edit ad copy.
Your job is to edit ONLY the specific text provided, following the user's instruction.

RULES:
- Return ONLY the edited text, nothing else
- Keep the same general length unless asked to change it
- Maintain the same tone and style unless asked to change it
- Do not add quotes or formatting around your response
- Just output the edited text directly`

    const userPrompt = `Original text to edit:
"${original_text}"

Context: This is from a ${context.field} field in an ad concept called "${context.concept?.concept_name || 'Unknown'}".

Edit instruction: ${edit_instruction}

Provide the edited text:`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const responseText = message.content[0].type === 'text'
      ? message.content[0].text.trim()
      : ''

    return NextResponse.json({ edited_text: responseText })
  } catch (error) {
    console.error('Edit content error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to edit content' },
      { status: 500 }
    )
  }
}
