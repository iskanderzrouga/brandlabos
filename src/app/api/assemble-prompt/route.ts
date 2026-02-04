import { NextRequest, NextResponse } from 'next/server'
import { promptAssembler } from '@/lib/services/prompt-assembler'

// POST /api/assemble-prompt - Get the assembled prompt for preview
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { product_id, avatar_ids, pitch_id, content_type, user_instructions } = body

    if (!product_id || !avatar_ids || avatar_ids.length === 0) {
      return NextResponse.json(
        { error: 'product_id and avatar_ids are required' },
        { status: 400 }
      )
    }

    const assembled = await promptAssembler.assemble({
      productId: product_id,
      avatarIds: avatar_ids,
      pitchId: pitch_id,
      contentType: content_type,
      userInstructions: user_instructions,
    })

    return NextResponse.json(assembled)
  } catch (error) {
    console.error('Assemble prompt error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to assemble prompt' },
      { status: 500 }
    )
  }
}
