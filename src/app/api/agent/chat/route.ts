import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk'
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

export const maxDuration = 120

type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

type NormalizedError = {
  status: number
  error: string
  error_code: string
}

type RuntimeTimings = {
  data_load_ms: number
  prompt_compile_ms: number
  model_wait_ms: number
  total_ms: number
}

type ChatRuntimeSummary = {
  request_id: string
  model: string
  estimated_input_tokens: number
  context_1m_used: boolean
  tool_steps: number
  model_call_count: number
  anthropic_request_ids: string[]
  timings_ms: RuntimeTimings
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

const AGENT_MODEL = 'claude-opus-4-6'
const CONTEXT_MAX_MESSAGES = AGENT_CONTEXT_DEFAULTS.maxMessages
const CONTEXT_MAX_CHARS = AGENT_CONTEXT_DEFAULTS.maxChars
const CONTEXT_MAX_CHARS_PER_MESSAGE = AGENT_CONTEXT_DEFAULTS.maxCharsPerMessage
const AGENT_MAX_STEPS = 2
const AGENT_MAX_TOKENS = positiveIntFromEnv('AGENT_MAX_TOKENS', 1800)
const AGENT_LOOP_BUDGET_MS = positiveIntFromEnv('AGENT_LOOP_BUDGET_MS', 25_000)
const AGENT_HISTORY_LIMIT = positiveIntFromEnv('AGENT_HISTORY_LIMIT', 40)
const ANTHROPIC_MAX_RETRIES = nonNegativeIntFromEnv('ANTHROPIC_MAX_RETRIES', 1)
const ANTHROPIC_TIMEOUT_MS = positiveIntFromEnv('ANTHROPIC_TIMEOUT_MS', 90_000)
const ANTHROPIC_ENABLE_CONTEXT_1M = String(process.env.ANTHROPIC_ENABLE_CONTEXT_1M ?? 'true').toLowerCase() !== 'false'
const ANTHROPIC_CONTEXT_1M_BETA = String(process.env.ANTHROPIC_CONTEXT_1M_BETA || 'context-1m-2025-08-07')
const LEGACY_1M_MIN_CHARS = positiveIntFromEnv('ANTHROPIC_CONTEXT_1M_MIN_INPUT_CHARS', 700_000)
const ANTHROPIC_CONTEXT_1M_MIN_INPUT_TOKENS = positiveIntFromEnv(
  'ANTHROPIC_CONTEXT_1M_MIN_INPUT_TOKENS',
  Math.max(170_000, Math.floor(LEGACY_1M_MIN_CHARS / 4))
)
const AGENT_CHAT_STREAMING_ENABLED =
  String(process.env.AGENT_CHAT_STREAMING_ENABLED ?? 'true').toLowerCase() !== 'false'

let context1MBetaAvailability: 'unknown' | 'enabled' | 'disabled' = 'unknown'

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
    .map((m) => m.replace(/[),.;!?]+$/g, ''))
    .filter(Boolean)
}

function isMetaAdLibraryUrl(url: string) {
  try {
    const u = new URL(url)
    return u.hostname.includes('facebook.com') && u.pathname.includes('/ads/library')
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

function isPromptTooLargeError(error: APIError) {
  const haystack = `${error.message || ''} ${(error as any)?.error?.message || ''}`.toLowerCase()
  return (
    haystack.includes('too long') ||
    haystack.includes('too large') ||
    (haystack.includes('prompt') && haystack.includes('length')) ||
    haystack.includes('context length') ||
    (haystack.includes('max') && haystack.includes('tokens'))
  )
}

function isContext1MBetaAccessError(error: APIError) {
  const haystack = `${error.message || ''} ${(error as any)?.error?.message || ''}`.toLowerCase()
  if (error.status !== 400 && error.status !== 403) return false
  return (
    haystack.includes('context-1m') ||
    haystack.includes('beta') ||
    haystack.includes('tier') ||
    haystack.includes('not enabled') ||
    haystack.includes('not available')
  )
}

function estimateMessageChars(messages: any[]): number {
  let total = 0
  for (const message of messages || []) {
    if (!message) continue
    const content = (message as any).content
    if (typeof content === 'string') {
      total += content.length
      continue
    }
    if (Array.isArray(content)) {
      try {
        total += JSON.stringify(content).length
      } catch {
        total += 0
      }
      continue
    }
    if (content != null) {
      try {
        total += JSON.stringify(content).length
      } catch {
        total += 0
      }
    }
  }
  return total
}

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}

function extractTextFromContent(content: any[]): string {
  return (content || [])
    .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
    .map((block: any) => block.text)
    .join('\n\n')
    .trim()
}

function normalizeStreamToggle(value: unknown): boolean {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return !(normalized === '0' || normalized === 'false' || normalized === 'off')
  }
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return true
}

function normalizeChatError(error: unknown): NormalizedError {
  if (error instanceof APIConnectionTimeoutError) {
    return {
      status: 504,
      error: 'Anthropic request timed out before completion.',
      error_code: 'anthropic_timeout',
    }
  }

  if (error instanceof APIError) {
    if (error.status === 400 && isPromptTooLargeError(error)) {
      return {
        status: 413,
        error: 'Prompt payload exceeded request limits for this model call.',
        error_code: 'prompt_too_large',
      }
    }

    const status = error.status && error.status >= 400 ? error.status : 502
    return {
      status,
      error: `Anthropic request failed (${status}).`,
      error_code: 'anthropic_api_error',
    }
  }

  return {
    status: 500,
    error: 'Agent chat failed',
    error_code: 'agent_chat_failed',
  }
}

function jsonWithRequestId(body: Record<string, any>, status: number, requestId: string) {
  return NextResponse.json(
    {
      ...body,
      request_id: body.request_id || requestId,
    },
    {
      status,
      headers: { 'x-request-id': requestId },
    }
  )
}

function logInfo(label: string, payload: Record<string, any>) {
  console.info(label, payload)
}

function logError(label: string, payload: Record<string, any>) {
  console.error(label, payload)
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

async function consumeAnthropicStream(args: {
  stream: any
  onTextDelta?: (delta: string) => void
}) {
  let textSnapshot = ''

  if (typeof args.stream.on === 'function') {
    args.stream.on('text', (textDelta: string, nextSnapshot: string) => {
      textSnapshot = nextSnapshot || textSnapshot
      if (textDelta) {
        args.onTextDelta?.(textDelta)
      }
    })
  }

  const withResponsePromise =
    typeof args.stream.withResponse === 'function'
      ? args.stream.withResponse().catch(() => null)
      : Promise.resolve(null)

  const startedAt = Date.now()
  const finalMessage = await args.stream.finalMessage()
  const durationMs = Date.now() - startedAt
  const withResponse = await withResponsePromise
  const content = Array.isArray((finalMessage as any)?.content) ? (finalMessage as any).content : []
  if (!textSnapshot) {
    textSnapshot = extractTextFromContent(content)
  }

  return {
    finalMessage,
    content,
    textSnapshot,
    durationMs,
    anthropicRequestId: withResponse?.request_id || null,
  }
}

async function createAnthropicMessageStream(args: {
  anthropic: Anthropic
  model: string
  maxTokens: number
  system: string
  messages: any[]
  tools?: any[]
  estimatedInputTokens: number
  onTextDelta?: (delta: string) => void
}) {
  const payload: any = {
    model: args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: args.messages,
    ...(args.tools ? { tools: args.tools } : {}),
  }

  const useContext1M =
    ANTHROPIC_ENABLE_CONTEXT_1M &&
    context1MBetaAvailability !== 'disabled' &&
    args.estimatedInputTokens >= ANTHROPIC_CONTEXT_1M_MIN_INPUT_TOKENS

  if (useContext1M) {
    try {
      const betaStream = args.anthropic.beta.messages.stream({
        ...payload,
        betas: [ANTHROPIC_CONTEXT_1M_BETA as any],
      })
      const result = await consumeAnthropicStream({ stream: betaStream, onTextDelta: args.onTextDelta })
      context1MBetaAvailability = 'enabled'
      return {
        ...result,
        usedContext1M: true,
      }
    } catch (error) {
      if (error instanceof APIError && isContext1MBetaAccessError(error)) {
        context1MBetaAvailability = 'disabled'
        console.warn('Context 1M beta unavailable for this key/account. Falling back to standard messages API.')
      } else {
        throw error
      }
    }
  }

  const stream = args.anthropic.messages.stream(payload)
  const result = await consumeAnthropicStream({ stream, onTextDelta: args.onTextDelta })
  return {
    ...result,
    usedContext1M: false,
  }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID()
  const requestStartedAt = Date.now()

  const user = await requireAuth()
  if (!user) {
    return jsonWithRequestId({ error: 'Unauthorized', error_code: 'unauthorized' }, 401, requestId)
  }
  const authedUser = user

  try {
    const body = await request.json()
    const threadId = String(body.thread_id || '').trim()
    const messageText = String(body.message || '').trim()
    const includeDebug = Boolean(body.debug || body.include_debug || body.debug_context)

    const streamQuery = request.nextUrl.searchParams.get('stream')
    const streamAllowedByQuery = normalizeStreamToggle(streamQuery)
    const streamAllowedByBody = body.stream !== false
    const streamMode = AGENT_CHAT_STREAMING_ENABLED && streamAllowedByQuery && streamAllowedByBody

    if (!threadId || !messageText) {
      return jsonWithRequestId(
        { error: 'thread_id and message are required', error_code: 'invalid_input' },
        400,
        requestId
      )
    }

    const dataLoadStartedAt = Date.now()

    const threadRows = await sql`
      SELECT *
      FROM agent_threads
      WHERE id = ${threadId}
        AND user_id = ${authedUser.id}
      LIMIT 1
    `
    const thread = threadRows[0]
    if (!thread) {
      return jsonWithRequestId({ error: 'Thread not found', error_code: 'thread_not_found' }, 404, requestId)
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
      return jsonWithRequestId({ error: 'Product not found', error_code: 'product_not_found' }, 404, requestId)
    }

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
    const system = systemBuild.prompt
    const promptCompileMs = Date.now() - promptCompileStartedAt

    const historyRows = await sql`
      SELECT role, content
      FROM agent_messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at DESC
      LIMIT ${AGENT_HISTORY_LIMIT}
    `

    // Keep the newest user input as complete as possible; clip older messages first.
    const contextMaxChars = Math.max(
      CONTEXT_MAX_CHARS,
      Math.min(400_000, messageText.length + 12_000)
    )
    const contextMaxCharsPerMessage = Math.max(
      CONTEXT_MAX_CHARS_PER_MESSAGE,
      Math.min(320_000, messageText.length + 2_000)
    )

    const contextWindow = buildAgentContextMessages(
      (historyRows as Array<{ role: string; content: string }>).reverse(),
      {
        maxMessages: CONTEXT_MAX_MESSAGES,
        maxChars: contextMaxChars,
        maxCharsPerMessage: contextMaxCharsPerMessage,
      }
    )
    const messages: any[] = contextWindow.messages

    const anthropicKey = await getOrgApiKey('anthropic', productRow.organization_id || null)
    if (!anthropicKey) {
      return jsonWithRequestId({ error: 'ANTHROPIC_API_KEY is not set', error_code: 'missing_api_key' }, 500, requestId)
    }

    const anthropic = new Anthropic({
      apiKey: anthropicKey,
      maxRetries: ANTHROPIC_MAX_RETRIES,
      timeout: ANTHROPIC_TIMEOUT_MS,
    })

    const model = AGENT_MODEL

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

    async function runTool(toolUse: any) {
      if (!toolUse?.name) throw new Error('Invalid tool use')

      if (toolUse.name === 'ingest_meta_ad_url') {
        const url = String(toolUse.input?.url || '').trim()
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
        const query = String(toolUse.input?.query || '').trim()
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
        const swipeId = String(toolUse.input?.swipe_id || '').trim()
        const includeTranscript = Boolean(toolUse.input?.include_transcript)
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

    const dataLoadMs = Date.now() - dataLoadStartedAt
    const activeTools = shouldEnableTools(messageText, threadContext) ? tools : undefined

    const runtimeTracking = {
      maxEstimatedInputTokens: 0,
      context1MUsed: false,
      toolSteps: 0,
      modelWaitMs: 0,
      modelCallCount: 0,
      anthropicRequestIds: [] as string[],
    }

    const runtimeLimits = {
      history_limit: AGENT_HISTORY_LIMIT,
      context_max_messages: CONTEXT_MAX_MESSAGES,
      context_max_chars: contextMaxChars,
      context_max_chars_per_message: contextMaxCharsPerMessage,
      max_steps: activeTools ? AGENT_MAX_STEPS : 1,
      max_tokens: AGENT_MAX_TOKENS,
      loop_budget_ms: AGENT_LOOP_BUDGET_MS,
      anthropic_max_retries: ANTHROPIC_MAX_RETRIES,
      anthropic_timeout_ms: ANTHROPIC_TIMEOUT_MS,
      context_1m_enabled: ANTHROPIC_ENABLE_CONTEXT_1M,
      context_1m_beta: ANTHROPIC_ENABLE_CONTEXT_1M ? ANTHROPIC_CONTEXT_1M_BETA : null,
      context_1m_min_input_tokens: ANTHROPIC_CONTEXT_1M_MIN_INPUT_TOKENS,
      context_1m_legacy_min_input_chars: LEGACY_1M_MIN_CHARS,
      context_1m_runtime_state: context1MBetaAvailability,
      stream_mode: streamMode,
      stream_enabled: AGENT_CHAT_STREAMING_ENABLED,
    }

    async function runAgentLoop(args?: { onDelta?: (delta: string) => void }) {
      const loopStartedAt = Date.now()
      const maxSteps = activeTools ? AGENT_MAX_STEPS : 1
      let assistantText = ''
      let workingMessages: any[] = messages

      for (let step = 0; step < maxSteps; step += 1) {
        if (Date.now() - loopStartedAt > AGENT_LOOP_BUDGET_MS) {
          console.warn('Agent loop budget exceeded', { request_id: requestId, thread_id: threadId, step, model })
          break
        }

        const estimatedInputChars = system.length + estimateMessageChars(workingMessages)
        const estimatedInputTokens = estimateTokensFromChars(estimatedInputChars)
        runtimeTracking.maxEstimatedInputTokens = Math.max(
          runtimeTracking.maxEstimatedInputTokens,
          estimatedInputTokens
        )

        const resp = await createAnthropicMessageStream({
          anthropic,
          model,
          maxTokens: AGENT_MAX_TOKENS,
          system,
          messages: workingMessages,
          ...(activeTools ? { tools: activeTools } : {}),
          estimatedInputTokens,
          onTextDelta: args?.onDelta,
        })

        runtimeTracking.modelWaitMs += resp.durationMs
        runtimeTracking.modelCallCount += 1
        runtimeTracking.context1MUsed = runtimeTracking.context1MUsed || resp.usedContext1M
        if (resp.anthropicRequestId) {
          runtimeTracking.anthropicRequestIds.push(resp.anthropicRequestId)
        }

        const content = resp.content || []
        const toolUses = content.filter(isToolUseBlock)
        const textFromContent = extractTextFromContent(content)
        if (textFromContent) {
          assistantText = textFromContent
        } else if (resp.textSnapshot) {
          assistantText = resp.textSnapshot.trim()
        }

        workingMessages = workingMessages.concat([{ role: 'assistant', content }])

        if (!activeTools || toolUses.length === 0) break

        for (const tu of toolUses) {
          runtimeTracking.toolSteps += 1
          const result = await runTool(tu)
          workingMessages = workingMessages.concat([
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: tu.id,
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

      await sql`
        INSERT INTO agent_messages (thread_id, role, content)
        VALUES (${threadId}, 'assistant', ${assistantText})
      `

      const runtimeSummary: ChatRuntimeSummary = {
        request_id: requestId,
        model,
        estimated_input_tokens: runtimeTracking.maxEstimatedInputTokens,
        context_1m_used: runtimeTracking.context1MUsed,
        tool_steps: runtimeTracking.toolSteps,
        model_call_count: runtimeTracking.modelCallCount,
        anthropic_request_ids: runtimeTracking.anthropicRequestIds,
        timings_ms: {
          data_load_ms: dataLoadMs,
          prompt_compile_ms: promptCompileMs,
          model_wait_ms: runtimeTracking.modelWaitMs,
          total_ms: Date.now() - requestStartedAt,
        },
      }

      const responsePayload: any = {
        assistant_message: assistantText,
        thread_context: threadContext,
        maybe_swipe_status: maybeSwipe
          ? { swipe_id: maybeSwipe.id, status: maybeSwipe.status }
          : null,
        request_id: requestId,
        runtime: runtimeSummary,
      }

      if (includeDebug) {
        responsePayload.debug = {
          model,
          prompt: system,
          prompt_blocks: systemBuild.promptBlocks,
          prompt_sections: systemBuild.sections,
          context_window: contextWindow.debug,
          context_messages: contextWindow.messages,
          request_message_chars: messageText.length,
          runtime_limits: {
            ...runtimeLimits,
            context_1m_runtime_state: context1MBetaAvailability,
          },
          runtime: runtimeSummary,
          tools_enabled: Boolean(activeTools),
        }
      }

      logInfo('agent_chat_success', {
        request_id: requestId,
        thread_id: threadId,
        user_id: authedUser.id,
        status: 200,
        model,
        context_1m_used: runtimeSummary.context_1m_used,
        estimated_input_tokens: runtimeSummary.estimated_input_tokens,
        tool_steps: runtimeSummary.tool_steps,
        timings_ms: runtimeSummary.timings_ms,
      })

      return { responsePayload, runtimeSummary }
    }

    if (!streamMode) {
      const { responsePayload } = await runAgentLoop()
      return jsonWithRequestId(responsePayload, 200, requestId)
    }

    const encoder = new TextEncoder()

    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        const writeEvent = (event: string, payload: Record<string, any> = {}) => {
          const line = JSON.stringify({ event, ...payload }) + '\n'
          controller.enqueue(encoder.encode(line))
        }

        const closeSafe = () => {
          try {
            controller.close()
          } catch {
            // ignore already-closed stream
          }
        }

        ;(async () => {
          writeEvent('meta', {
            request_id: requestId,
            model,
            runtime_limits: runtimeLimits,
          })

          try {
            const { responsePayload, runtimeSummary } = await runAgentLoop({
              onDelta: (delta) => {
                if (!delta) return
                writeEvent('delta', { delta })
              },
            })

            writeEvent('final', {
              request_id: requestId,
              data: responsePayload,
              runtime: runtimeSummary,
            })
          } catch (error) {
            const normalized = normalizeChatError(error)
            logError('agent_chat_error', {
              request_id: requestId,
              thread_id: threadId,
              user_id: authedUser.id,
              status: normalized.status,
              error_code: normalized.error_code,
              message: normalized.error,
            })
            writeEvent('error', {
              request_id: requestId,
              status: normalized.status,
              error: normalized.error,
              error_code: normalized.error_code,
            })
          } finally {
            closeSafe()
          }
        })().catch((error) => {
          const normalized = normalizeChatError(error)
          writeEvent('error', {
            request_id: requestId,
            status: normalized.status,
            error: normalized.error,
            error_code: normalized.error_code,
          })
          closeSafe()
        })
      },
    })

    return new Response(readable, {
      status: 200,
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'x-request-id': requestId,
      },
    })
  } catch (error) {
    const normalized = normalizeChatError(error)
    logError('agent_chat_error', {
      request_id: requestId,
      status: normalized.status,
      error_code: normalized.error_code,
      message: normalized.error,
    })

    return jsonWithRequestId(
      {
        error: normalized.error,
        error_code: normalized.error_code,
      },
      normalized.status,
      requestId
    )
  }
}
