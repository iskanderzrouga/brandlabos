import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'

type ThreadContext = {
  skill?: string
  versions?: number
  avatar_ids?: string[]
  positioning_id?: string | null
  active_swipe_id?: string | null
  research_ids?: string[]
}

type PromptBlockRow = {
  id: string
  type: string
  content: string
  metadata?: { key?: string }
}

async function loadGlobalPromptBlocks(): Promise<Map<string, PromptBlockRow>> {
  const blocks = await sql`
    SELECT id, type, content, metadata
    FROM prompt_blocks
    WHERE is_active = true
      AND scope = 'global'
  ` as PromptBlockRow[]

  const map = new Map<string, PromptBlockRow>()
  for (const b of blocks || []) {
    const key = (b.metadata as { key?: string } | undefined)?.key || b.type
    map.set(key, b)
  }
  return map
}

function getPromptBlockContent(blocks: Map<string, PromptBlockRow>, key: string): string {
  const db = blocks.get(key)?.content
  if (db) return db
  const fallback = (DEFAULT_PROMPT_BLOCKS as any)[key]?.content
  return typeof fallback === 'string' ? fallback : ''
}

function buildSystemPrompt(args: {
  skill: string
  versions: number
  product: { name: string; content: string; brandName?: string | null; brandVoice?: string | null }
  avatars: Array<{ id: string; name: string; content: string }>
  positioning?: { name: string; content: string } | null
  swipe?: { id: string; status: string; title?: string | null; summary?: string | null; transcript?: string | null; source_url?: string | null } | null
  research?: Array<{ id: string; title?: string | null; summary?: string | null; content?: string | null }>
  blocks: Map<string, PromptBlockRow>
}) {
  const {
    skill,
    versions,
    product,
    avatars,
    positioning,
    swipe,
    blocks,
  } = args

  const writingRules = getPromptBlockContent(blocks, 'writing_rules')
  const skillGuidance = getPromptBlockContent(blocks, skill)
  const agentSystemTemplate = getPromptBlockContent(blocks, 'agent_system')
  const agentSystem = agentSystemTemplate.replace(/{{\s*versions\s*}}/gi, () => String(versions))

  const sections: string[] = []

  if (agentSystem.trim()) sections.push(agentSystem)

  sections.push(`## CURRENT SKILL\n${skill}`)
  if (skillGuidance) sections.push(`## SKILL GUIDANCE\n${skillGuidance}`)
  if (writingRules) sections.push(`## WRITING RULES\n${writingRules}`)

  sections.push(`## PRODUCT\nName: ${product.name}\n\nContext:\n${product.content || '(none)'}\n`)
  if (product.brandName || product.brandVoice) {
    sections.push(`## BRAND\nName: ${product.brandName || '(unknown)'}\n\nVoice guidelines:\n${product.brandVoice || '(none)'}`)
  }

  if (positioning) {
    sections.push(`## POSITIONING\n${positioning.name}\n\n${positioning.content}`)
  }

  if (avatars.length > 0) {
    const lines: string[] = []
    lines.push(`## AVATARS (${avatars.length})`)
    for (const a of avatars) {
      lines.push(`\n### ${a.name}\n${a.content}`)
    }
    sections.push(lines.join('\n'))
  } else {
    sections.push(`## AVATARS\n(none selected)`)
  }

  if (swipe) {
    const transcript =
      swipe.status === 'ready' && swipe.transcript
        ? swipe.transcript.slice(0, 7000)
        : null
    sections.push(`## ACTIVE SWIPE\nStatus: ${swipe.status}\nURL: ${swipe.source_url || ''}\nTitle: ${swipe.title || ''}\nSummary: ${swipe.summary || ''}\n\nTranscript:\n${transcript || '(not ready yet)'}\n`)
  }

  if (args.research && args.research.length > 0) {
    const lines: string[] = []
    lines.push(`## RESEARCH CONTEXT (${args.research.length})`)
    for (const item of args.research) {
      const excerpt = item.content ? item.content.slice(0, 1200) : ''
      lines.push(`\n### ${item.title || 'Untitled research'}\n${item.summary || ''}\n${excerpt ? `\nExcerpt:\n${excerpt}` : ''}`.trim())
    }
    sections.push(lines.join('\n'))
  }

  return sections.join('\n\n---\n\n')
}

export async function GET(_request: NextRequest, ctx: { params: { id: string } }) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const threadId = ctx.params.id
  if (!threadId) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  const threadRows = await sql`
    SELECT *
    FROM agent_threads
    WHERE id = ${threadId}
      AND user_id = ${user.id}
    LIMIT 1
  `
  const thread = threadRows[0]
  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  const threadContext: ThreadContext = (thread.context || {}) as ThreadContext

  const productRows = await sql`
    SELECT
      products.id,
      products.name,
      products.context,
      brands.organization_id AS organization_id,
      brands.name AS brand_name,
      brands.voice_guidelines AS brand_voice_guidelines
    FROM products
    LEFT JOIN brands ON brands.id = products.brand_id
    WHERE products.id = ${thread.product_id}
    LIMIT 1
  `
  const productRow = productRows[0]
  if (!productRow) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const skill = String(threadContext.skill || 'ugc_video_scripts')
  const versions = Math.min(6, Math.max(1, Number(threadContext.versions || 1)))

  const avatarIds = Array.isArray(threadContext.avatar_ids) ? threadContext.avatar_ids : []
  const avatars: Array<{ id: string; name: string; content: string }> = []
  for (const id of avatarIds) {
    const rows = await sql`SELECT id, name, content FROM avatars WHERE id = ${id} LIMIT 1`
    const row = rows[0] as { id: string; name: string; content: string } | undefined
    if (row) {
      avatars.push({ id: row.id, name: row.name, content: row.content })
    }
  }

  let positioning: { name: string; content: string } | null = null
  if (threadContext.positioning_id) {
    const rows = await sql`
      SELECT name, content
      FROM pitches
      WHERE id = ${threadContext.positioning_id}
      LIMIT 1
    `
    const row = rows[0] as { name: string; content: string } | undefined
    if (row) positioning = { name: row.name, content: row.content }
  }

  let swipe: any = null
  if (threadContext.active_swipe_id) {
    const rows = await sql`
      SELECT id, status, title, summary, transcript, source_url
      FROM swipes
      WHERE id = ${threadContext.active_swipe_id}
        AND product_id = ${thread.product_id}
      LIMIT 1
    `
    swipe = rows[0] ?? null
  }

  let research: Array<{ id: string; title?: string | null; summary?: string | null; content?: string | null }> = []
  const researchIds = Array.isArray(threadContext.research_ids) ? threadContext.research_ids : []
  if (researchIds.length > 0) {
    const rows = (await sql`
      SELECT id, title, summary, content
      FROM research_items
      WHERE id = ANY(${researchIds})
        AND product_id = ${thread.product_id}
    `) as Array<{ id: string; title?: string | null; summary?: string | null; content?: string | null }>
    const order = new Map(researchIds.map((id, idx) => [id, idx]))
    research = (rows || []).sort((a: any, b: any) => {
      const ai = order.get(a.id) ?? 0
      const bi = order.get(b.id) ?? 0
      return ai - bi
    })
  }

  const blocks = await loadGlobalPromptBlocks()
  const system = buildSystemPrompt({
    skill,
    versions,
    product: {
      name: productRow.name,
      content: productRow.context?.content || '',
      brandName: productRow.brand_name || null,
      brandVoice: productRow.brand_voice_guidelines || null,
    },
    avatars,
    positioning,
    swipe,
    research,
    blocks,
  })

  return NextResponse.json({ prompt: system })
}
