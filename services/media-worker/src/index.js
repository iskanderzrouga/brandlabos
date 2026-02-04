import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'

import { Pool } from 'pg'
import { chromium } from 'playwright'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import pdfParse from 'pdf-parse'
import mammoth from 'mammoth'

const WORKER_ID = process.env.WORKER_ID || os.hostname()

function requiredEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

const pool = new Pool({
  connectionString: requiredEnv('DATABASE_URL'),
  max: 4,
})

const r2Bucket = requiredEnv('R2_BUCKET')
const r2 = new S3Client({
  region: process.env.R2_REGION || 'auto',
  endpoint: requiredEnv('R2_ENDPOINT'),
  credentials: {
    accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
  },
  forcePathStyle: true,
})

const openai = new OpenAI({ apiKey: requiredEnv('OPENAI_API_KEY') })
const anthropic = new Anthropic({ apiKey: requiredEnv('ANTHROPIC_API_KEY') })

const SUMMARIZE_MODEL = process.env.ANTHROPIC_SUMMARIZE_MODEL || 'claude-3-5-haiku-latest'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), `[${WORKER_ID}]`, ...args)
}

async function claimNextJob() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
      SELECT *
      FROM media_jobs
      WHERE type IN ('ingest_meta_ad', 'ingest_research_file')
        AND status = 'queued'
        AND run_after <= NOW()
      ORDER BY run_after ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `
    )
    if (rows.length === 0) {
      await client.query('COMMIT')
      return null
    }

    const job = rows[0]
    const updated = await client.query(
      `
      UPDATE media_jobs
      SET status = 'running',
          locked_at = NOW(),
          locked_by = $1,
          attempts = attempts + 1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `,
      [WORKER_ID, job.id]
    )

    await client.query('COMMIT')
    return updated.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`${cmd} failed (${code}): ${stderr.slice(0, 1200)}`))
    })
  })
}

async function scrapeMetaAdVideo(url) {
  const userAgent =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const page = await browser.newPage({
    userAgent,
    viewport: { width: 1360, height: 768 },
    locale: 'en-US',
  })

  const candidates = []
  page.on('response', async (res) => {
    try {
      const u = res.url()
      const headers = res.headers()
      const ct = headers['content-type'] || ''
      const len = Number(headers['content-length'] || 0) || 0
      const looksVideo = ct.startsWith('video/') || /\.mp4(\?|$)/i.test(u)
      if (!looksVideo) return
      candidates.push({ url: u, contentLength: len })
    } catch {
      // ignore
    }
  })

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    // Try to trigger video fetches.
    await page.waitForTimeout(2_000)
    const video = page.locator('video').first()
    if ((await video.count()) > 0) {
      await video.click({ timeout: 2_000 }).catch(() => {})
    }
    await page.mouse.wheel(0, 900)
    await page.waitForTimeout(6_000)

    // Pick the largest candidate by content-length.
    candidates.sort((a, b) => (b.contentLength || 0) - (a.contentLength || 0))
    const best = candidates.find((c) => c.url)

    // Fallback: regex scan of HTML.
    let fallbackUrl = null
    if (!best) {
      const html = await page.content()
      const m = html.match(/https?:\\/\\/[^\"'\\s>]+\\.mp4[^\"'\\s>]*/i)
      if (m) fallbackUrl = m[0]
    }

    const title = await page.title().catch(() => null)
    return { videoUrl: best?.url || fallbackUrl, meta: { page_title: title } }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function downloadToFile(url, filePath, maxBytes) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)

  const lenHeader = res.headers.get('content-length')
  if (lenHeader) {
    const n = Number(lenHeader)
    if (Number.isFinite(n) && n > maxBytes) throw new Error(`Video too large (${n} bytes)`)
  }

  if (!res.body) throw new Error('No response body')

  const nodeStream = Readable.fromWeb(res.body)
  const file = fs.createWriteStream(filePath)

  let downloaded = 0
  nodeStream.on('data', (chunk) => {
    downloaded += chunk.length
    if (downloaded > maxBytes) {
      nodeStream.destroy(new Error('Video exceeded max size'))
    }
  })

  await new Promise((resolve, reject) => {
    file.on('finish', resolve)
    file.on('error', reject)
    nodeStream.on('error', reject)
    nodeStream.pipe(file)
  })
}

async function uploadToR2(key, filePath, contentType) {
  await r2.send(
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
    })
  )
}

async function downloadFromR2(key, filePath) {
  const res = await r2.send(
    new GetObjectCommand({
      Bucket: r2Bucket,
      Key: key,
    })
  )
  if (!res.Body) throw new Error('R2 download failed: empty body')
  const file = fs.createWriteStream(filePath)
  await new Promise((resolve, reject) => {
    res.Body.pipe(file)
    res.Body.on('error', reject)
    file.on('finish', resolve)
    file.on('error', reject)
  })
}

async function extractTextFromFile(filePath, mime, filename) {
  const lower = filename.toLowerCase()
  if (mime?.includes('pdf') || lower.endsWith('.pdf')) {
    const data = await pdfParse(await fsp.readFile(filePath))
    return data.text || ''
  }
  if (mime?.includes('word') || lower.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ path: filePath })
    return result.value || ''
  }
  if (mime?.includes('text') || lower.endsWith('.txt')) {
    return await fsp.readFile(filePath, 'utf8')
  }
  return ''
}

async function transcribeWhisper(audioPath) {
  const res = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
  })
  const text = typeof res.text === 'string' ? res.text : ''
  return { text }
}

async function summarizeSwipe({ transcript, url }) {
  const prompt = `Return JSON with keys: title, summary.\n\nURL: ${url}\n\nTranscript:\n${transcript.slice(0, 12000)}`
  const message = await anthropic.messages.create({
    model: SUMMARIZE_MODEL,
    max_tokens: 350,
    system:
      'You create short swipe titles and high-signal summaries for ad/transcript libraries. Output ONLY JSON.',
    messages: [{ role: 'user', content: prompt }],
  })
  const text = message.content.find((c) => c.type === 'text')?.text || ''
  const cleaned = (text.match(/```json\\s*([\\s\\S]*?)\\s*```/) || [null, text])[1].trim()
  try {
    const parsed = JSON.parse(cleaned)
    return {
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, 140) : null,
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
    }
  } catch {
    // Fallback: keep it usable even if the model didn't comply.
    return {
      title: null,
      summary: cleaned.slice(0, 800),
    }
  }
}

async function summarizeResearch({ title, text }) {
  const prompt = `Return JSON with keys: title, summary, keywords (array of 3-6).\n\nTitle: ${title}\n\nText:\n${text.slice(0, 14000)}`
  const message = await anthropic.messages.create({
    model: SUMMARIZE_MODEL,
    max_tokens: 350,
    system: 'You summarize research notes into short, useful briefs. Output ONLY JSON.',
    messages: [{ role: 'user', content: prompt }],
  })
  const content = message.content.find((c) => c.type === 'text')?.text || ''
  const cleaned = (content.match(/```json\\s*([\\s\\S]*?)\\s*```/) || [null, content])[1].trim()
  try {
    const parsed = JSON.parse(cleaned)
    return {
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, 140) : null,
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 8) : [],
    }
  } catch {
    return {
      title: title || null,
      summary: cleaned.slice(0, 800),
      keywords: [],
    }
  }
}

async function markSwipeJobFailed({ jobId, swipeId, errorMessage, attempts }) {
  const backoffSeconds = attempts === 1 ? 60 : attempts === 2 ? 5 * 60 : 20 * 60
  const willRetry = attempts < 3

  if (willRetry) {
    await pool.query(
      `
      UPDATE media_jobs
      SET status = 'queued',
          run_after = NOW() + ($2::text || ' seconds')::interval,
          error_message = $3,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
      [jobId, String(backoffSeconds), errorMessage]
    )
    // Keep swipe in processing; surface latest error in metadata only.
    await pool.query(
      `
      UPDATE swipes
      SET status = 'processing',
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
      [swipeId]
    )
    return
  }

  await pool.query(
    `
    UPDATE media_jobs
    SET status = 'failed',
        error_message = $2,
        updated_at = NOW()
    WHERE id = $1
  `,
    [jobId, errorMessage]
  )

  await pool.query(
    `
    UPDATE swipes
    SET status = 'failed',
        error_message = $2,
        updated_at = NOW()
    WHERE id = $1
  `,
    [swipeId, errorMessage]
  )
}

async function markResearchJobFailed({ jobId, itemId, errorMessage, attempts }) {
  const backoffSeconds = attempts === 1 ? 60 : attempts === 2 ? 5 * 60 : 20 * 60
  const willRetry = attempts < 3

  if (willRetry) {
    await pool.query(
      `
      UPDATE media_jobs
      SET status = 'queued',
          run_after = NOW() + ($2::text || ' seconds')::interval,
          error_message = $3,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
      [jobId, String(backoffSeconds), errorMessage]
    )
    await pool.query(
      `
      UPDATE research_items
      SET status = 'processing',
          metadata = metadata || $2::jsonb,
          updated_at = NOW()
      WHERE id = $1
    `,
      [itemId, JSON.stringify({ error: errorMessage })]
    )
    return
  }

  await pool.query(
    `
    UPDATE media_jobs
    SET status = 'failed',
        error_message = $2,
        updated_at = NOW()
    WHERE id = $1
  `,
    [jobId, errorMessage]
  )

  await pool.query(
    `
    UPDATE research_items
    SET status = 'failed',
        metadata = metadata || $2::jsonb,
        updated_at = NOW()
    WHERE id = $1
  `,
    [itemId, JSON.stringify({ error: errorMessage })]
  )
}

async function processIngestMetaAd(job) {
  const input = job.input || {}
  const swipeId = String(input.swipe_id || '').trim()
  const productId = String(input.product_id || '').trim()
  const url = String(input.url || '').trim()

  if (!swipeId || !productId || !url) {
    throw new Error('Invalid job input (missing swipe_id/product_id/url)')
  }

  log('Scraping video URL...', url)
  const scraped = await scrapeMetaAdVideo(url)
  if (!scraped.videoUrl) throw new Error('Failed to locate MP4 URL from Meta page')

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'brandlab-swipe-'))
  const mp4Path = path.join(tmpDir, 'source.mp4')
  const audioPath = path.join(tmpDir, 'audio.mp3')

  try {
    const maxBytes = 250 * 1024 * 1024 // 250MB guardrail
    log('Downloading video...')
    await downloadToFile(scraped.videoUrl, mp4Path, maxBytes)

    const r2Key = `products/${productId}/swipes/${swipeId}/source.mp4`
    log('Uploading to R2...', r2Key)
    await uploadToR2(r2Key, mp4Path, 'video/mp4')

    log('Extracting audio...')
    await runCommand('ffmpeg', ['-y', '-i', mp4Path, '-vn', '-acodec', 'mp3', '-b:a', '128k', audioPath], {
      cwd: tmpDir,
    })

    log('Transcribing (Whisper)...')
    const transcript = await transcribeWhisper(audioPath)

    log('Summarizing...')
    const summary = await summarizeSwipe({ transcript: transcript.text, url })

    const meta = {
      ...scraped.meta,
      video_url: scraped.videoUrl,
    }

    await pool.query(
      `
      UPDATE swipes
      SET status = 'ready',
          r2_video_key = $2,
          transcript = $3,
          title = COALESCE($4, title),
          summary = COALESCE($5, summary),
          metadata = metadata || $6::jsonb,
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
      [swipeId, r2Key, transcript.text, summary.title, summary.summary, JSON.stringify(meta)]
    )

    await pool.query(
      `
      UPDATE media_jobs
      SET status = 'completed',
          output = $2,
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
      [
        job.id,
        {
          swipe_id: swipeId,
          r2_video_key: r2Key,
          transcript_len: transcript.text.length,
          title: summary.title,
        },
      ]
    )

    log('Done.', swipeId)
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function processIngestResearchFile(job) {
  const input = job.input || {}
  const itemId = String(input.research_item_id || '').trim()
  const fileId = String(input.file_id || '').trim()
  const productId = String(input.product_id || '').trim()
  const r2Key = String(input.r2_key || '').trim()
  const filename = String(input.filename || '').trim()
  const mime = String(input.mime || '').trim()

  if (!itemId || !fileId || !productId || !r2Key) {
    throw new Error('Invalid job input (missing research_item_id/product_id/r2_key)')
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'brandlab-research-'))
  const filePath = path.join(tmpDir, filename || 'upload')

  try {
    log('Downloading research file...', r2Key)
    await downloadFromR2(r2Key, filePath)

    log('Extracting text...')
    const text = await extractTextFromFile(filePath, mime, filename)
    if (!text || text.trim().length < 20) {
      throw new Error('No extractable text found in file')
    }

    log('Summarizing research...')
    const summary = await summarizeResearch({ title: filename, text })

    await pool.query(
      `
      UPDATE research_items
      SET status = 'inbox',
          title = COALESCE($2, title),
          summary = COALESCE($3, summary),
          content = $4,
          metadata = metadata || $5::jsonb,
          updated_at = NOW()
      WHERE id = $1
    `,
      [
        itemId,
        summary.title,
        summary.summary,
        text,
        JSON.stringify({ keywords: summary.keywords }),
      ]
    )

    await pool.query(
      `
      UPDATE research_files
      SET status = 'processed',
          updated_at = NOW()
      WHERE id = $1
    `,
      [fileId]
    )

    await pool.query(
      `
      UPDATE media_jobs
      SET status = 'completed',
          output = $2,
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
      [
        job.id,
        {
          research_item_id: itemId,
          file_id: fileId,
          text_len: text.length,
          title: summary.title,
        },
      ]
    )

    log('Research processed.', itemId)
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function main() {
  log('Worker online.')
  // Ensure schema migrations exist (not applied here, but helps first-time boot debugging).
  await pool.query('SELECT 1').catch((err) => {
    log('DB connection failed:', err?.message || err)
    process.exit(1)
  })

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = await claimNextJob().catch((err) => {
      log('Claim error:', err?.message || err)
      return null
    })

    if (!job) {
      await sleep(2000)
      continue
    }

    const swipeId = String(job.input?.swipe_id || '')
    const researchItemId = String(job.input?.research_item_id || '')
    log('Claimed job', job.id, 'attempt', job.attempts, 'type', job.type)

    try {
      if (job.type === 'ingest_meta_ad') {
        await processIngestMetaAd(job)
      } else if (job.type === 'ingest_research_file') {
        await processIngestResearchFile(job)
      } else {
        throw new Error(`Unsupported job type: ${job.type}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('Job failed', job.id, msg)
      if (job.type === 'ingest_meta_ad') {
        await markSwipeJobFailed({
          jobId: job.id,
          swipeId,
          errorMessage: msg,
          attempts: Number(job.attempts || 1),
        }).catch((e) => log('Failed to mark job failed:', e?.message || e))
      } else if (job.type === 'ingest_research_file') {
        await markResearchJobFailed({
          jobId: job.id,
          itemId: researchItemId,
          errorMessage: msg,
          attempts: Number(job.attempts || 1),
        }).catch((e) => log('Failed to mark job failed:', e?.message || e))
      }
    }
  }
}

process.on('SIGINT', async () => {
  log('SIGINT received, shutting down.')
  await pool.end().catch(() => {})
  process.exit(0)
})

process.on('SIGTERM', async () => {
  log('SIGTERM received, shutting down.')
  await pool.end().catch(() => {})
  process.exit(0)
})

main().catch((err) => {
  log('Fatal:', err?.message || err)
  process.exit(1)
})
