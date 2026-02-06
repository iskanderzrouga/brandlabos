import crypto from 'node:crypto'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { getOrgApiKey } from '@/lib/api-keys'
import {
  AGENT_CONTEXT_DEFAULTS,
  buildAgentContextMessages,
  buildSystemPrompt,
  loadGlobalPromptBlocks,
  type ThreadContext,
} from '@/lib/agent/compiled-context'

export const maxDuration = 300

type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

function nonNegativeIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return fallback
  return Math.floor(value)
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (!raw) return fallback
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

const AGENT_MODEL = 'claude-opus-4-6'
const AGENT_MAX_STEPS = positiveIntFromEnv('AGENT_MAX_STEPS', 3)
const AGENT_MAX_TOKENS = positiveIntFromEnv('AGENT_MAX_TOKENS', 1600)
const AGENT_LOOP_BUDGET_MS = positiveIntFromEnv('AGENT_LOOP_BUDGET_MS', 90_000)
const AGENT_HISTORY_LIMIT = positiveIntFromEnv('AGENT_HISTORY_LIMIT', 120)

const AGENT_CONTEXT_MAX_MESSAGES = positiveIntFromEnv(
  'AGENT_CONTEXT_MAX_MESSAGES',
  AGENT_CONTEXT_DEFAULTS.maxMessages
)
const AGENT_CONTEXT_MAX_CHARS = positiveIntFromEnv(
  'AGENT_CONTEXT_MAX_CHARS',
  AGENT_CONTEXT_DEFAULTS.maxChars
)
const AGENT_CONTEXT_MAX_CHARS_PER_MESSAGE = positiveIntFromEnv(
  'AGENT_CONTEXT_MAX_CHARS_PER_MESSAGE',
  AGENT_CONTEXT_DEFAULTS.maxCharsPerMessage
)

const ANTHROPIC_TIMEOUT_MS = positiveIntFromEnv('ANTHROPIC_TIMEOUT_MS', 90_000)
const ANTHROPIC_MAX_RETRIES = nonNegativeIntFromEnv('ANTHROPIC_MAX_RETRIES', 1)
const ANTHROPIC_ENABLE_CONTEXT_1M = boolFromEnv('ANTHROPIC_ENABLE_CONTEXT_1M', true)
const ANTHROPIC_CONTEXT_1M_BETA =
  process.env.ANTHROPIC_CONTEXT_1M_BETA?.trim() || 'context-1m-2025-08-07'
const ANTHROPIC_CONTEXT_1M_MIN_INPUT_TOKENS = positiveIntFromEnv(
  'ANTHROPIC_CONTEXT_1M_MIN_INPUT_TOKENS',
  170_000
)

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as any).type === 'tool_use' &&
    typeof (block as any).id === 'string' &&
    typeof (block as any).name === 'string'
  )
}

function extractMetaAdLibraryUrls(text: string): string[] {
  const regex = /(https?:\/\/[^\s]+?facebook\.com\/ads\/library\/[^\s]*)/gi
  const matches = text.match(regex) || []
  return matches
    .map((match) => match.replace(/[),.;!?]+$/g, ''))
    .filter(Boolean)
}

function isMetaAdLibraryUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes('facebook.com') && parsed.pathname.includes('/ads/library')
  } catch {
    return false
  }
}

function deriveThreadTitle(message: string) {
  const clean = message.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const sentence = clean.split(/[.!?\n]/)[0]
  const clipped = sentence.length > 80 ? sentence.slice(0, 80).trim() : sentence
  return clipped || null
}

function shouldEnableTools(messageText: string, threadContext: ThreadContext) {
  if (threadContext.active_swipe_id) return true
  if (Array.isArray(threadContext.research_ids) && threadContext.research_ids.length > 0) return true

  const text = messageText.toLowerCase()
  if (text.includes('facebook.com/ads/library')) return true

  return (
    text.includes('ingest meta') ||
    text.includes('ad library') ||
    text.includes('list swipes') ||
    text.includes('get swipe') ||
    text.includes('show swipe') ||
    text.includes('transcript') ||
    text.includes('ingest')
  )
}

function extractDraftBody(text: string): string | null {
  const match = text.match(/```draft\s*([\s\S]*?)\s*```/i)
  if (!match) return null
  return String(match[1] || '').trim()
}

function normalizeVersionHeadingLine(line: string): string {
  const match = line.match(
    /^\s*(?:\*{1,2}\s*)?(?:#{1,4}\s*)?(?:version|v)\s*([1-9]\d*)\s*(?:\*{1,2})?\s*:?\s*$/i
  )
  if (!match) return line
  return `## Version ${match[1]}`
}

function isInstructionEchoLine(line: string): boolean {
  const text = line.trim().toLowerCase()
  if (!text) return false
  if (text.length > 180) return false

  return (
    text.includes('writing requests must return draft block only') ||
    text.includes('no text before or after the draft block') ||
    text.includes('versions format') ||
    text.includes('default drafts count') ||
    text.includes('non-draft replies must be ultra-brief') ||
    text.includes('if {{versions}} > 1') ||
    text.includes('output only') ||
    text === '...'
  )
}

function isStructuredDraftLine(line: string): boolean {
  const text = line.trim()
  if (!text) return false
  return (
    /^##\s*Version\s*\d+/i.test(text) ||
    /^#{1,4}\s+\S+/.test(text) ||
    /^([-*]|\d+[.)])\s+/.test(text)
  )
}

function normalizeLooseDraftBody(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n')
  let lines = normalized.split('\n').map((line) => normalizeVersionHeadingLine(line.trimEnd()))
  lines = lines.filter((line) => !isInstructionEchoLine(line))

  while (lines.length > 0 && !lines[0].trim()) lines.shift()
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop()

  const firstStructuredIndex = lines.findIndex(isStructuredDraftLine)
  if (firstStructuredIndex > 0) {
    const intro = lines.slice(0, firstStructuredIndex).join(' ').trim().toLowerCase()
    const introLooksLikePreamble =
      intro.length <= 260 ||
      intro.includes('here are') ||
      intro.includes('below') ||
      intro.includes('designed to') ||
      intro.includes('for each version') ||
      intro.startsWith('these') ||
      intro.startsWith('this ')
    if (introLooksLikePreamble) {
      lines = lines.slice(firstStructuredIndex)
    }
  }

  const body = lines.join('\n').trim()
  return body || normalized.trim()
}

function isWritingIntent(messageText: string): boolean {
  const text = messageText.toLowerCase()
  return (
    /\b(write|draft|rewrite|generate|create|script|hooks?|angles?|headlines?|ideas?|versions?)\b/i.test(
      messageText
    ) ||
    text.includes('for this script') ||
    text.includes('for thisscripts') ||
    text.includes('write just 1 draft')
  )
}

function looksLikeDraftPayload(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length < 140) return false

  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const hasVersionHeading = lines.some((line) => /^#{1,4}\s*version\s*\d+/i.test(line))
  const hasList = lines.some((line) => /^([-*]|\d+[.)])\s+/.test(line))
  const hasHeading = lines.some((line) => /^#{1,4}\s+\S+/.test(line))
  const hasPromptLikeLanguage =
    /image prompt|prompt ideas|version 1|hook|angle|script/i.test(trimmed) && lines.length >= 6

  return hasVersionHeading || hasPromptLikeLanguage || (lines.length >= 6 && (hasList || hasHeading))
}

function userRequestedAllVersions(messageText: string, versions: number): boolean {
  if (versions <= 1) return false
  const text = messageText.toLowerCase()
  if (text.includes('for each version') || text.includes('each version') || text.includes('all versions')) {
    return true
  }
  if (text.includes('v1') && text.includes('v2')) return true
  if (/version\s*1[\s\S]*version\s*2/i.test(messageText)) return true
  if (/version\s*2[\s\S]*version\s*3/i.test(messageText)) return true
  return false
}

function getVersionHeadingNumbers(text: string): Set<number> {
  const numbers = new Set<number>()
  const regex = /^##\s*Version\s*(\d+)\s*$/gim
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    const value = Number(match[1])
    if (Number.isFinite(value) && value > 0) numbers.add(value)
  }
  return numbers
}

function distributeDraftAcrossVersions(body: string, versions: number): string | null {
  if (versions <= 1) return null
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
  if (blocks.length < versions) return null

  const perVersion = Math.ceil(blocks.length / versions)
  const sections: string[] = []
  for (let i = 0; i < versions; i += 1) {
    const start = i * perVersion
    const end = Math.min(blocks.length, start + perVersion)
    const chunk = blocks.slice(start, end)
    if (chunk.length === 0) break
    sections.push(`## Version ${i + 1}\n${chunk.join('\n\n')}`.trim())
  }
  if (sections.length === 0) return null
  return sections.join('\n\n')
}

function ensureDraftEnvelope(args: {
  assistantText: string
  userMessage: string
  versions: number
}): { text: string; coerced: boolean; distributed: boolean; version_headings: number } {
  const { assistantText, userMessage, versions } = args
  const trimmed = assistantText.trim()
  if (!trimmed) return { text: assistantText, coerced: false, distributed: false, version_headings: 0 }

  const existingDraftBody = extractDraftBody(trimmed)
  let distributed = false
  if (existingDraftBody) {
    let body = normalizeLooseDraftBody(existingDraftBody)
    const hasVersionHeading = /^##\s*Version\s*\d+/im.test(body)
    if (versions > 1 && !hasVersionHeading) {
      body = `## Version 1\n${body}`.trim()
    }
    const versionHeadings = getVersionHeadingNumbers(body).size
    return {
      text: `\`\`\`draft\n${body}\n\`\`\``,
      coerced: true,
      distributed,
      version_headings: versionHeadings,
    }
  }

  if (!isWritingIntent(userMessage)) {
    return { text: assistantText, coerced: false, distributed: false, version_headings: 0 }
  }

  if (!looksLikeDraftPayload(trimmed)) {
    return { text: assistantText, coerced: false, distributed: false, version_headings: 0 }
  }

  let body = normalizeLooseDraftBody(trimmed)
  let versionHeadings = getVersionHeadingNumbers(body).size

  if (versions > 1 && versionHeadings === 0 && userRequestedAllVersions(userMessage, versions)) {
    const distributedBody = distributeDraftAcrossVersions(body, versions)
    if (distributedBody) {
      body = distributedBody
      distributed = true
      versionHeadings = getVersionHeadingNumbers(body).size
    }
  }

  if (versions > 1 && versionHeadings === 0) {
    body = `## Version 1\n${body}`.trim()
    versionHeadings = 1
  }

  return {
    text: `\`\`\`draft\n${body}\n\`\`\``,
    coerced: true,
    distributed,
    version_headings: versionHeadings,
  }
}

function estimateInputTokens(systemPrompt: string, messages: Array<{ role: string; content: unknown }>) {
  let chars = systemPrompt.length
  for (const message of messages) {
    const content = message.content
    if (typeof content === 'string') {
      chars += content.length
      continue
    }
    try {
      chars += JSON.stringify(content).length
    } catch {
      // ignore unparsable chunks for estimate only
    }
  }
  return Math.ceil(chars / 4)
}

function buildAnthropicRequestOptions(useContext1M: boolean) {
  if (!useContext1M || !ANTHROPIC_CONTEXT_1M_BETA) return undefined
  return {
    headers: {
      'anthropic-beta': ANTHROPIC_CONTEXT_1M_BETA,
    },
  }
}

function isContext1MBetaError(error: unknown): boolean {
  const message =
    typeof (error as any)?.message === 'string' ? String((error as any).message).toLowerCase() : ''
  const status = typeof (error as any)?.status === 'number' ? Number((error as any).status) : 0
  if (status !== 400) return false
  return (
    message.includes('anthropic-beta') ||
    message.includes('context-1m') ||
    message.includes('beta header')
  )
}

function describeAgentError(error: unknown): { status: number; code: string; message: string } {
  const status = typeof (error as any)?.status === 'number' ? Number((error as any).status) : 0
  const name = typeof (error as any)?.name === 'string' ? String((error as any).name) : ''
  const message = typeof (error as any)?.message === 'string' ? String((error as any).message) : ''

  if (name === 'APIConnectionTimeoutError' || /timed?\s*out/i.test(message)) {
    return {
      status: 504,
      code: 'timeout',
      message: 'Agent timed out before the model finished. Please retry.',
    }
  }

  if (status === 429) {
    return {
      status: 429,
      code: 'rate_limited',
      message: 'Anthropic rate limit reached. Please retry in a moment.',
    }
  }

  if (status === 401 || status === 403) {
    return {
      status: 502,
      code: 'provider_auth',
      message: 'Anthropic authentication failed. Check your API key settings.',
    }
  }

  if (status === 413) {
    return {
      status: 413,
      code: 'input_too_large',
      message: 'The request payload is too large. Reduce attachments or history and retry.',
    }
  }

  if (isContext1MBetaError(error)) {
    return {
      status: 400,
      code: 'context_1m_beta_error',
      message: '1M context beta header was rejected by provider.',
    }
  }

  if (status >= 500 && status < 600) {
    return {
      status: 502,
      code: 'provider_error',
      message: 'Anthropic provider error. Please retry.',
    }
  }

  return {
    status: 500,
    code: 'agent_chat_failed',
    message: message || 'Agent chat failed.',
  }
}

function writeSseEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  payload: Record<string, unknown>
) {
  const chunk = `data: ${JSON.stringify(payload)}\n\n`
  controller.enqueue(encoder.encode(chunk))
}

async function ingestMetaSwipe(args: { productId: string; url: string; userId: string }) {
  const { productId, url, userId } = args

  const swipeRows = await sql`
    INSERT INTO swipes (product_id, source, source_url, status, created_by)
    VALUES (${productId}, 'meta_ad_library', ${url}, 'processing', ${userId})
    ON CONFLICT (product_id, source, source_url) DO UPDATE SET
      updated_at = NOW(),
      status = CASE WHEN swipes.status = 'failed' THEN 'processing' ELSE swipes.status END,
      error_message = CASE WHEN swipes.status = 'failed' THEN NULL ELSE swipes.error_message END
    RETURNING *
  `
  const swipe = swipeRows[0]
  if (!swipe) throw new Error('Failed to create swipe')

  if (swipe.status === 'ready') {
    return { swipe, job: null }
  }

  const existingJobRows = await sql`
    SELECT id, status
    FROM media_jobs
    WHERE type = 'ingest_meta_ad'
      AND status IN ('queued', 'running')
      AND input->>'swipe_id' = ${swipe.id}
    ORDER BY created_at DESC
    LIMIT 1
  `
  const existingJob = existingJobRows[0]
  if (existingJob) return { swipe, job: existingJob }

  const jobRows = await sql`
    INSERT INTO media_jobs (type, status, input)
    VALUES (
      'ingest_meta_ad',
      'queued',
      ${{
        swipe_id: swipe.id,
        product_id: productId,
        url,
        user_id: userId,
      }}
    )
    RETURNING *
  `

  return { swipe, job: jobRows[0] ?? null }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()
  const responseHeaders = new Headers({ 'x-request-id': requestId })

  const user = await requireAuth()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'unauthorized', request_id: requestId },
      { status: 401, headers: responseHeaders }
    )
  }
  const authedUser = user

  const mode = request.nextUrl.searchParams.get('mode') === 'json' ? 'json' : 'stream'
  const startedAt = Date.now()

  const clientBuildId = request.headers.get('x-client-build-id')?.trim() || null
  const serverBuildId =
    process.env.NEXT_DEPLOYMENT_ID || process.env.NETLIFY_BUILD_ID || process.env.COMMIT_REF || null
  const deploymentSkew = Boolean(clientBuildId && serverBuildId && clientBuildId !== serverBuildId)

  if (serverBuildId) {
    responseHeaders.set('x-server-build-id', serverBuildId)
  }

  try {
    const body = await request.json()
    const threadId = String(body.thread_id || '').trim()
    const messageText = String(body.message || '').trim()

    if (!threadId || !messageText) {
      return NextResponse.json(
        { error: 'thread_id and message are required', code: 'invalid_request', request_id: requestId },
        { status: 400, headers: responseHeaders }
      )
    }

    const dbLoadStartedAt = Date.now()

    const threadRows = await sql`
      SELECT *
      FROM agent_threads
      WHERE id = ${threadId}
        AND user_id = ${authedUser.id}
      LIMIT 1
    `
    const thread = threadRows[0]
    if (!thread) {
      return NextResponse.json(
        { error: 'Thread not found', code: 'thread_not_found', request_id: requestId },
        { status: 404, headers: responseHeaders }
      )
    }

    const threadContext: ThreadContext = (thread.context || {}) as ThreadContext

    await sql`
      INSERT INTO agent_messages (thread_id, role, content)
      VALUES (${threadId}, 'user', ${messageText})
    `

    if (!thread.title) {
      const derived = deriveThreadTitle(messageText)
      if (derived) {
        await sql`
          UPDATE agent_threads
          SET title = ${derived}, updated_at = NOW()
          WHERE id = ${threadId}
        `
      }
    }

    const urls = extractMetaAdLibraryUrls(messageText).filter(isMetaAdLibraryUrl)
    let maybeSwipe: any = null
    if (urls.length > 0) {
      const url = urls[0]
      const ingest = await ingestMetaSwipe({ productId: thread.product_id, url, userId: authedUser.id })
      maybeSwipe = ingest.swipe

      threadContext.active_swipe_id = ingest.swipe.id
      await sql`
        UPDATE agent_threads
        SET context = ${threadContext}, updated_at = NOW()
        WHERE id = ${threadId}
      `

      await sql`
        INSERT INTO agent_messages (thread_id, role, content, metadata)
        VALUES (
          ${threadId},
          'tool',
          ${`Ingest started: ${url}`},
          ${{ swipe_id: ingest.swipe.id, job_id: ingest.job?.id || null, status: ingest.swipe.status }}
        )
      `
    }

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
    if (!productRow) {
      return NextResponse.json(
        { error: 'Product not found', code: 'product_not_found', request_id: requestId },
        { status: 404, headers: responseHeaders }
      )
    }

    const skill = String(threadContext.skill || 'ugc_video_scripts')
    const versions = Math.min(6, Math.max(1, Number(threadContext.versions || 1)))

    const avatarIds = Array.isArray(threadContext.avatar_ids) ? threadContext.avatar_ids : []
    const avatars: Array<{ id: string; name: string; content: string }> = []
    if (avatarIds.length > 0) {
      const avatarRows = (await sql`
        SELECT id, name, content
        FROM avatars
        WHERE id = ANY(${avatarIds})
      `) as Array<{ id: string; name: string; content: string }>
      const order = new Map(avatarIds.map((id, idx) => [id, idx]))
      avatars.push(
        ...(avatarRows || []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      )
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

    let research: Array<{
      id: string
      title?: string | null
      summary?: string | null
      content?: string | null
    }> = []
    const researchIds = Array.isArray(threadContext.research_ids) ? threadContext.research_ids : []
    if (researchIds.length > 0) {
      const rows = (await sql`
        SELECT id, title, summary, content
        FROM research_items
        WHERE id = ANY(${researchIds})
          AND product_id = ${thread.product_id}
      `) as Array<{ id: string; title?: string | null; summary?: string | null; content?: string | null }>
      const order = new Map(researchIds.map((id, idx) => [id, idx]))
      research = (rows || []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    }

    const promptCompileStartedAt = Date.now()

    const blocks = await loadGlobalPromptBlocks()
    const systemBuild = buildSystemPrompt({
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

    const historyRows = await sql`
      SELECT role, content
      FROM agent_messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at DESC
      LIMIT ${AGENT_HISTORY_LIMIT}
    `

    const contextWindow = buildAgentContextMessages(
      (historyRows as Array<{ role: string; content: string }>).reverse(),
      {
        maxMessages: AGENT_CONTEXT_MAX_MESSAGES,
        maxChars: AGENT_CONTEXT_MAX_CHARS,
        maxCharsPerMessage: AGENT_CONTEXT_MAX_CHARS_PER_MESSAGE,
      }
    )

    const contextMessages = contextWindow.messages
    const promptCompileMs = Date.now() - promptCompileStartedAt
    const dbLoadMs = Date.now() - dbLoadStartedAt

    const anthropicKey = await getOrgApiKey('anthropic', productRow.organization_id || null)
    if (!anthropicKey) {
      return NextResponse.json(
        {
          error: 'ANTHROPIC_API_KEY is not set',
          code: 'missing_anthropic_key',
          request_id: requestId,
        },
        { status: 500, headers: responseHeaders }
      )
    }

    const anthropic = new Anthropic({
      apiKey: anthropicKey,
      timeout: ANTHROPIC_TIMEOUT_MS,
      maxRetries: ANTHROPIC_MAX_RETRIES,
    })

    const estimatedInputTokens = estimateInputTokens(systemBuild.prompt, contextMessages)

    const context1MRequested =
      ANTHROPIC_ENABLE_CONTEXT_1M &&
      Boolean(ANTHROPIC_CONTEXT_1M_BETA) &&
      estimatedInputTokens >= ANTHROPIC_CONTEXT_1M_MIN_INPUT_TOKENS

    let context1MActive = context1MRequested
    let context1MFallback = false

    const tools: any[] = [
      {
        name: 'ingest_meta_ad_url',
        description:
          'Ingest a Meta Ad Library URL: create a swipe record and enqueue a transcription job. Returns swipe_id and status.',
        input_schema: {
          type: 'object',
          properties: {
            product_id: { type: 'string' },
            url: { type: 'string' },
          },
          required: ['product_id', 'url'],
        },
      },
      {
        name: 'list_swipes',
        description: 'List swipes for the current product (optionally filter by query).',
        input_schema: {
          type: 'object',
          properties: {
            product_id: { type: 'string' },
            query: { type: 'string' },
          },
          required: ['product_id'],
        },
      },
      {
        name: 'get_swipe',
        description: 'Fetch a swipe by id. Optionally include transcript.',
        input_schema: {
          type: 'object',
          properties: {
            swipe_id: { type: 'string' },
            include_transcript: { type: 'boolean' },
          },
          required: ['swipe_id'],
        },
      },
    ]

    async function runTool(toolUse: ToolUseBlock) {
      if (!toolUse?.name) throw new Error('Invalid tool use')

      if (toolUse.name === 'ingest_meta_ad_url') {
        const url = String((toolUse.input as any)?.url || '').trim()
        const productId = thread.product_id
        if (!url || !isMetaAdLibraryUrl(url)) {
          return { error: 'Invalid Meta Ad Library URL' }
        }

        const ingest = await ingestMetaSwipe({ productId, url, userId: authedUser.id })

        threadContext.active_swipe_id = ingest.swipe.id
        await sql`
          UPDATE agent_threads
          SET context = ${threadContext}, updated_at = NOW()
          WHERE id = ${threadId}
        `

        return {
          swipe_id: ingest.swipe.id,
          status: ingest.swipe.status,
          job_id: ingest.job?.id || null,
        }
      }

      if (toolUse.name === 'list_swipes') {
        const productId = thread.product_id
        const query = String((toolUse.input as any)?.query || '').trim()
        if (query) {
          const like = `%${query}%`
          const rows = await sql`
            SELECT id, status, title, summary, source_url, created_at
            FROM swipes
            WHERE product_id = ${productId}
              AND (
                title ILIKE ${like}
                OR summary ILIKE ${like}
                OR source_url ILIKE ${like}
              )
            ORDER BY created_at DESC
            LIMIT 50
          `
          return { swipes: rows }
        }

        const rows = await sql`
          SELECT id, status, title, summary, source_url, created_at
          FROM swipes
          WHERE product_id = ${productId}
          ORDER BY created_at DESC
          LIMIT 50
        `
        return { swipes: rows }
      }

      if (toolUse.name === 'get_swipe') {
        const swipeId = String((toolUse.input as any)?.swipe_id || '').trim()
        const includeTranscript = Boolean((toolUse.input as any)?.include_transcript)
        if (!swipeId) return { error: 'swipe_id is required' }

        const rows = await sql`
          SELECT id, product_id, status, title, summary, transcript, source_url, metadata, created_at
          FROM swipes
          WHERE id = ${swipeId}
          LIMIT 1
        `
        const row = rows[0]
        if (!row) return { error: 'Not found' }
        if (row.product_id !== thread.product_id) return { error: 'Forbidden' }

        if (!includeTranscript) {
          delete row.transcript
        }

        return row
      }

      return { error: `Unknown tool: ${toolUse.name}` }
    }

    const activeTools = shouldEnableTools(messageText, threadContext) ? tools : undefined
    const maxSteps = activeTools ? AGENT_MAX_STEPS : 1

    const baseMeta = {
      request_id: requestId,
      model: AGENT_MODEL,
      estimated_input_tokens: estimatedInputTokens,
      context_1m_requested: context1MRequested,
      max_steps: maxSteps,
      deployment: {
        client_build_id: clientBuildId,
        server_build_id: serverBuildId,
        skew_detected: deploymentSkew,
      },
    }

    const runAgent = async (onDelta?: (delta: string) => void) => {
      const loopStartedAt = Date.now()
      let modelWaitMs = 0
      let toolSteps = 0
      let providerRequestId: string | null = null
      let assistantText = ''
      let workingMessages: any[] = contextMessages

      const runSingleStep = async (useContext1M: boolean) => {
        const stepStartedAt = Date.now()
        let streamedText = ''

        const stream = anthropic.messages.stream(
          {
            model: AGENT_MODEL,
            max_tokens: AGENT_MAX_TOKENS,
            system: systemBuild.prompt,
            messages: workingMessages,
            ...(activeTools ? { tools: activeTools } : {}),
          },
          buildAnthropicRequestOptions(useContext1M)
        )

        stream.on('text', (delta) => {
          streamedText += delta
          if (delta && onDelta) onDelta(delta)
        })

        const finalMessage = await stream.finalMessage()
        providerRequestId = stream.request_id || providerRequestId
        modelWaitMs += Date.now() - stepStartedAt

        return { finalMessage, streamedText }
      }

      for (let step = 0; step < maxSteps; step += 1) {
        if (Date.now() - loopStartedAt > AGENT_LOOP_BUDGET_MS) {
          console.warn('Agent loop budget exceeded', {
            request_id: requestId,
            thread_id: threadId,
            step,
            model: AGENT_MODEL,
          })
          break
        }

        let stepResult: { finalMessage: any; streamedText: string }

        try {
          stepResult = await runSingleStep(context1MActive)
        } catch (error) {
          if (context1MActive && isContext1MBetaError(error)) {
            context1MFallback = true
            context1MActive = false
            stepResult = await runSingleStep(context1MActive)
          } else {
            throw error
          }
        }

        const content = stepResult.finalMessage?.content || []
        const textParts = content
          .filter((chunk: any) => chunk?.type === 'text')
          .map((chunk: any) => String(chunk?.text || ''))
          .filter(Boolean)

        if (textParts.length > 0) {
          assistantText = textParts.join('\n\n').trim()
        } else if (stepResult.streamedText.trim()) {
          assistantText = stepResult.streamedText.trim()
        }

        const toolUses = content.filter(isToolUseBlock)
        workingMessages = workingMessages.concat([{ role: 'assistant', content }])

        if (!activeTools || toolUses.length === 0) break

        for (const toolUse of toolUses) {
          toolSteps += 1
          const result = await runTool(toolUse)
          workingMessages = workingMessages.concat([
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(result),
                },
              ],
            },
          ])
        }
      }

      if (!assistantText) {
        assistantText = 'I can help. What are you trying to write?'
      }

      const draftEnvelope = ensureDraftEnvelope({
        assistantText,
        userMessage: messageText,
        versions,
      })
      assistantText = draftEnvelope.text

      const persistStartedAt = Date.now()
      await sql`
        INSERT INTO agent_messages (thread_id, role, content)
        VALUES (${threadId}, 'assistant', ${assistantText})
      `
      const persistMs = Date.now() - persistStartedAt

      const runtime = {
        ...baseMeta,
        provider_request_id: providerRequestId,
        context_1m_active: context1MActive,
        context_1m_fallback: context1MFallback,
        tool_steps: toolSteps,
        prompt_blocks: systemBuild.promptBlocks.map(({ content, ...rest }) => rest),
        prompt_sections: systemBuild.sections,
        context_window: contextWindow.debug,
        context_messages: contextWindow.messages,
        draft_coerced: draftEnvelope.coerced,
        draft_distributed: draftEnvelope.distributed,
        draft_version_headings: draftEnvelope.version_headings,
        timings_ms: {
          db_load: dbLoadMs,
          prompt_compile: promptCompileMs,
          model_wait: modelWaitMs,
          persist: persistMs,
          total: Date.now() - startedAt,
        },
      }

      console.info('agent_chat_success', {
        request_id: requestId,
        thread_id: threadId,
        mode,
        model: AGENT_MODEL,
        status: 200,
        context_1m_requested: context1MRequested,
        context_1m_active: context1MActive,
        context_1m_fallback: context1MFallback,
        estimated_input_tokens: estimatedInputTokens,
        tool_steps: toolSteps,
        draft_coerced: draftEnvelope.coerced,
        draft_distributed: draftEnvelope.distributed,
        draft_version_headings: draftEnvelope.version_headings,
        total_ms: runtime.timings_ms.total,
        deployment_skew: deploymentSkew,
      })

      return {
        assistant_message: assistantText,
        thread_context: threadContext,
        maybe_swipe_status: maybeSwipe
          ? { swipe_id: maybeSwipe.id, status: maybeSwipe.status }
          : null,
        runtime,
      }
    }

    if (mode === 'json') {
      const result = await runAgent()
      return NextResponse.json(
        {
          ...result,
          request_id: requestId,
        },
        { headers: responseHeaders }
      )
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          writeSseEvent(controller, encoder, { type: 'meta', ...baseMeta })

          try {
            const result = await runAgent((delta) => {
              writeSseEvent(controller, encoder, {
                type: 'delta',
                delta,
              })
            })

            writeSseEvent(controller, encoder, {
              type: 'final',
              ...result,
              request_id: requestId,
            })
          } catch (error) {
            const described = describeAgentError(error)

            console.error('agent_chat_stream_error', {
              request_id: requestId,
              thread_id: threadId,
              mode,
              status: described.status,
              code: described.code,
              message: described.message,
              deployment_skew: deploymentSkew,
            })

            writeSseEvent(controller, encoder, {
              type: 'error',
              request_id: requestId,
              code: described.code,
              error: described.message,
            })
          } finally {
            controller.close()
          }
        })()
      },
    })

    const streamHeaders = new Headers(responseHeaders)
    streamHeaders.set('Content-Type', 'text/event-stream; charset=utf-8')
    streamHeaders.set('Cache-Control', 'no-cache, no-transform')
    streamHeaders.set('Connection', 'keep-alive')

    return new Response(stream, {
      status: 200,
      headers: streamHeaders,
    })
  } catch (error) {
    const described = describeAgentError(error)

    console.error('agent_chat_error', {
      request_id: requestId,
      mode,
      status: described.status,
      code: described.code,
      message: described.message,
      total_ms: Date.now() - startedAt,
      deployment_skew: deploymentSkew,
    })

    return NextResponse.json(
      {
        error: described.message,
        code: described.code,
        request_id: requestId,
      },
      {
        status: described.status,
        headers: responseHeaders,
      }
    )
  }
}
