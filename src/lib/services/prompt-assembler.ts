import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'

// Re-export for backwards compatibility
export { DEFAULT_PROMPT_BLOCKS }

// ============================================================================
// PROMPT ASSEMBLER SERVICE - The "Compiler"
// Implements Emergent Zoom: multiple avatars = find intersection (broader)
//                          single avatar = deep dive (specific)
// ============================================================================

interface AssemblyContext {
  productId: string
  avatarIds: string[]
  pitchId?: string
  contentType?: string
  userInstructions?: string
  numConcepts?: number
  promptOverrides?: Record<string, string> // One-off overrides for prompt modules
}

interface AssembledPrompt {
  systemPrompt: string
  userPrompt: string
  metadata: {
    avatarCount: number
    zoomBehavior: 'intersection' | 'deep_dive'
    assembledAt: string
  }
}

interface Avatar {
  id: string
  name: string
  content: string
}

interface Pitch {
  id: string
  name: string
  content: string
}

interface Product {
  id: string
  name: string
  content: string
  brands?: {
    name: string
    voice_guidelines?: string
  }
}

interface PromptBlock {
  id: string
  name: string
  type: string
  scope: string
  content: string
  is_active: boolean
  metadata?: { key?: string }
}

export class PromptAssembler {
  private promptBlocks: Map<string, PromptBlock> = new Map()

  async assemble(context: AssemblyContext): Promise<AssembledPrompt> {
    const supabase = createAdminClient()

    // Fetch all active prompt blocks
    const { data: blocks } = await supabase
      .from('prompt_blocks')
      .select('*')
      .eq('is_active', true)
      .eq('scope', 'global')

    // Store blocks by metadata.key for easy lookup
    this.promptBlocks.clear()
    if (blocks) {
      blocks.forEach(block => {
        // Use metadata.key if available, otherwise use type
        const key = (block.metadata as { key?: string })?.key || block.type
        this.promptBlocks.set(key, block)
      })
    }

    // Fetch product with brand
    const { data: productData } = await supabase
      .from('products')
      .select('*, brands(name, voice_guidelines)')
      .eq('id', context.productId)
      .single()

    if (!productData) {
      throw new Error(`Product ${context.productId} not found`)
    }

    // Map context.content to content for the assembler
    const product = {
      ...productData,
      content: productData.context?.content || '',
    }

    // Fetch avatars
    const { data: avatars } = await supabase
      .from('avatars')
      .select('*')
      .in('id', context.avatarIds)

    if (!avatars || avatars.length === 0) {
      throw new Error('No avatars found')
    }

    // Fetch pitch if provided
    let pitch: Pitch | null = null
    if (context.pitchId) {
      const { data: pitchData } = await supabase
        .from('pitches')
        .select('*')
        .eq('id', context.pitchId)
        .single()
      pitch = pitchData
    }

    // Determine zoom behavior
    const zoomBehavior = avatars.length > 1 ? 'intersection' : 'deep_dive'

    // Build the system prompt
    const contentType = context.contentType || 'organic_static'
    const numConcepts = context.numConcepts || 3

    const systemPrompt = this.buildSystemPrompt(
      product as Product,
      avatars as Avatar[],
      zoomBehavior,
      pitch,
      contentType,
      context.promptOverrides
    )

    // Build user prompt with instructions
    const userPrompt = this.buildUserPrompt(context.userInstructions, avatars.length, numConcepts)

    return {
      systemPrompt,
      userPrompt,
      metadata: {
        avatarCount: avatars.length,
        zoomBehavior,
        assembledAt: new Date().toISOString(),
      },
    }
  }

  private getBlock(type: string, overrides?: Record<string, string>): string {
    // Check for override first (one-off changes)
    if (overrides && overrides[type]) {
      return overrides[type]
    }
    // Then check database blocks
    const block = this.promptBlocks.get(type)
    if (block) {
      return block.content
    }
    // Fall back to default
    const defaultBlock = DEFAULT_PROMPT_BLOCKS[type as keyof typeof DEFAULT_PROMPT_BLOCKS]
    return defaultBlock?.content || ''
  }

  private buildSystemPrompt(
    product: Product,
    avatars: Avatar[],
    zoomBehavior: 'intersection' | 'deep_dive',
    pitch: Pitch | null,
    contentType: string,
    overrides?: Record<string, string>
  ): string {
    const sections: string[] = []

    // === LAYER 1: CONTENT TYPE RULES ===
    // Fetch content type template from database (via getBlock which falls back to defaults)
    const contentTypeBlock = this.getBlock(contentType, overrides)
    if (contentTypeBlock) {
      sections.push(contentTypeBlock)
    } else {
      // Fall back to organic_static if content type not found
      sections.push(this.getBlock('organic_static', overrides))
    }

    // === LAYER 2: OUTPUT FORMAT (content-type specific) ===
    const outputFormatKey = `output_format_${contentType}`
    const outputFormat = this.getBlock(outputFormatKey, overrides)
    if (outputFormat) {
      sections.push(outputFormat)
    }

    // === LAYER 3: WRITING RULES ===
    sections.push(this.getBlock('writing_rules', overrides))

    // === LAYER 4: PRODUCT CONTEXT ===
    sections.push(this.formatProductContext(product))

    // === LAYER 5: BRAND VOICE ===
    if (product.brands?.voice_guidelines) {
      sections.push(`## BRAND VOICE
${product.brands.voice_guidelines}`)
    }

    // === LAYER 6: PITCH / ANGLE (if selected) ===
    if (pitch) {
      sections.push(this.formatPitch(pitch))
    }

    // === LAYER 7: AVATAR CONTEXT (with zoom behavior) ===
    if (zoomBehavior === 'deep_dive') {
      sections.push(this.formatSingleAvatar(avatars[0]))
    } else {
      sections.push(this.formatAvatarIntersection(avatars))
    }

    // === LAYER 8: ZOOM BEHAVIOR INSTRUCTION ===
    if (zoomBehavior === 'intersection') {
      let zoomContent = this.getBlock('zoom_broad', overrides)
      zoomContent = zoomContent.replace('{{count}}', String(avatars.length))
      sections.push(zoomContent)
    } else {
      sections.push(this.getBlock('zoom_deep', overrides))
    }

    return sections.join('\n\n---\n')
  }

  private formatProductContext(product: Product): string {
    return `## PRODUCT CONTEXT: ${product.name}

${product.content}`
  }

  private formatPitch(pitch: Pitch): string {
    return `## PITCH / ANGLE: ${pitch.name}

Use this angle/value proposition as the PRIMARY messaging direction for all generated copy:

${pitch.content}

IMPORTANT: All generated ad concepts should align with and build upon this pitch angle.`
  }

  private formatSingleAvatar(avatar: Avatar): string {
    return `## TARGET AVATAR: ${avatar.name}

${avatar.content}`
  }

  private formatAvatarIntersection(avatars: Avatar[]): string {
    const lines: string[] = [`## TARGET AVATARS (${avatars.length} personas - find common ground)`]

    avatars.forEach((avatar, i) => {
      lines.push(`\n### Avatar ${i + 1}: ${avatar.name}`)
      lines.push(avatar.content)
    })

    lines.push(`\n### INSTRUCTION: Find the COMMON THEMES across all avatars above and create copy that resonates with ALL of them.`)

    return lines.join('\n')
  }

  private buildUserPrompt(userInstructions: string | undefined, avatarCount: number, numConcepts: number): string {
    const base = `Generate ${numConcepts} distinct ad concept${numConcepts > 1 ? 's' : ''}. Each concept should have a unique angle and visual approach.`

    if (userInstructions) {
      return `${base}

ADDITIONAL INSTRUCTIONS FROM USER:
${userInstructions}`
    }

    return base
  }
}

export const promptAssembler = new PromptAssembler()
