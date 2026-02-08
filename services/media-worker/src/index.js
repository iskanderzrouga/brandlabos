import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'

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

const SUMMARIZE_MODEL = process.env.ANTHROPIC_SUMMARIZE_MODEL || 'claude-3-5-haiku-latest'

const openaiClientCache = new Map()
const anthropicClientCache = new Map()
const orgIdCache = new Map()

const DEFAULT_PROMPT_BLOCKS = {
  swipe_summarizer_system:
    'You create short swipe titles and high-signal summaries for ad/transcript libraries. Output ONLY JSON.',
  swipe_summarizer_prompt: `Return JSON with keys: title, summary.

URL: {{url}}

Transcript:
{{transcript}}`,
  research_summarizer_system: 'You summarize research notes into short, useful briefs. Output ONLY JSON.',
  research_summarizer_prompt: `Return JSON with keys: title, summary, keywords (array of 3-6).

Title: {{title}}

Text:
{{text}}`,
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), `[${WORKER_ID}]`, ...args)
}

const ENV_MAP = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

function resolveEncryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set')
  const trimmed = raw.trim()
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === 64) {
    const buf = Buffer.from(trimmed, 'hex')
    if (buf.length === 32) return buf
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64')
    if (decoded.length === 32) return decoded
  } catch {
    // fall through
  }
  const utf8 = Buffer.from(trimmed, 'utf8')
  if (utf8.length === 32) return utf8
  throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (hex/base64/raw)')
}

function decryptSecret(payload) {
  const key = resolveEncryptionKey()
  const parts = String(payload || '').split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted payload')
  }
  const iv = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const data = Buffer.from(parts[3], 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return decrypted.toString('utf8')
}

async function getOrgIdForProduct(productId) {
  if (orgIdCache.has(productId)) return orgIdCache.get(productId)
  const { rows } = await pool.query(
    `
    SELECT brands.organization_id AS organization_id
    FROM products
    LEFT JOIN brands ON brands.id = products.brand_id
    WHERE products.id = $1
    LIMIT 1
  `,
    [productId]
  )
  const orgId = rows?.[0]?.organization_id || null
  orgIdCache.set(productId, orgId)
  return orgId
}

async function getOrgApiKey(provider, orgId) {
  let key = null
  if (orgId) {
    const { rows } = await pool.query(
      `
      SELECT api_key_encrypted
      FROM organization_api_keys
      WHERE organization_id = $1
        AND provider = $2
      LIMIT 1
    `,
      [orgId, provider]
    )
    if (rows?.[0]?.api_key_encrypted) {
      key = decryptSecret(rows[0].api_key_encrypted)
    }
  }

  if (!key) {
    const envKey = process.env[ENV_MAP[provider]]
    key = envKey && envKey.trim().length > 0 ? envKey.trim() : null
  }

  return key
}

async function getOpenAiClient(orgId) {
  const key = await getOrgApiKey('openai', orgId)
  if (!key) throw new Error('OPENAI_API_KEY is not set')
  const cacheKey = `openai:${orgId || 'env'}:${key}`
  if (openaiClientCache.has(cacheKey)) return openaiClientCache.get(cacheKey)
  const client = new OpenAI({ apiKey: key })
  openaiClientCache.set(cacheKey, client)
  return client
}

async function getAnthropicClient(orgId) {
  const key = await getOrgApiKey('anthropic', orgId)
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
  const cacheKey = `anthropic:${orgId || 'env'}:${key}`
  if (anthropicClientCache.has(cacheKey)) return anthropicClientCache.get(cacheKey)
  const client = new Anthropic({ apiKey: key })
  anthropicClientCache.set(cacheKey, client)
  return client
}

async function loadGlobalPromptBlocks() {
  const { rows } = await pool.query(
    `
    SELECT type, content, metadata
    FROM prompt_blocks
    WHERE is_active = true
      AND scope = 'global'
    ORDER BY updated_at DESC NULLS LAST, version DESC, created_at DESC
  `
  )
  const map = new Map()
  for (const row of rows || []) {
    let meta = row?.metadata || null
    if (meta && typeof meta === 'string') {
      try {
        meta = JSON.parse(meta)
      } catch {
        meta = null
      }
    }
    const key = meta?.key || row?.type
    if (key && !map.has(key)) map.set(key, row.content)
  }
  return map
}

function getPromptBlockContent(blocks, key) {
  if (blocks && blocks.has(key)) return blocks.get(key)
  return DEFAULT_PROMPT_BLOCKS[key] || ''
}

function applyTemplate(template, vars) {
  return Object.entries(vars).reduce((acc, [key, value]) => {
    const re = new RegExp(`{{\\s*${key}\\s*}}`, 'gi')
    const safe = typeof value === 'string' ? value : String(value ?? '')
    return acc.replace(re, () => safe)
  }, template)
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

function decodeEscapedUrl(value) {
  return String(value || '')
    .replace(/\\\//g, '/')
    .replace(/\\u0025/gi, '%')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u003f/gi, '?')
    .replace(/\\u003a/gi, ':')
    .replace(/\\u002f/gi, '/')
}

function classifySwipeUrl(url) {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('facebook.com')) return null
    if (u.pathname.includes('/ads/library')) return 'ad_library'
    if (u.pathname.includes('/reel/')) return 'fb_reel'
    if (u.pathname.includes('/posts/') || u.pathname.includes('/permalink/')) return 'fb_post'
    return null
  } catch {
    return null
  }
}

const FB_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

async function scrapeFacebookPost(url) {
  log('Scraping Facebook post via Playwright...', url)
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const page = await browser.newPage({
    userAgent: FB_USER_AGENT,
    viewport: { width: 1360, height: 768 },
    locale: 'en-US',
  })

  // Capture video network requests
  const candidates = []
  const seen = new Set()
  const pushCandidate = (candidate) => {
    const normalizedUrl = decodeEscapedUrl(candidate?.url || '').trim()
    if (!normalizedUrl || seen.has(normalizedUrl)) return
    seen.add(normalizedUrl)
    const kind = /\.m3u8(\?|$)/i.test(normalizedUrl) ? 'hls' : 'mp4'
    const next = {
      url: normalizedUrl,
      source: candidate?.source || 'unknown',
      contentType: candidate?.contentType || '',
      contentLength: Number(candidate?.contentLength || 0) || 0,
      kind,
    }
    next.score = scoreVideoCandidate(next)
    candidates.push(next)
  }

  page.on('response', async (res) => {
    try {
      const responseUrl = res.url()
      const headers = res.headers()
      const ct = headers['content-type'] || ''
      const len = Number(headers['content-length'] || 0) || 0
      const looksVideo =
        ct.startsWith('video/') ||
        ct.includes('mpegurl') ||
        /\.mp4(\?|$)/i.test(responseUrl) ||
        /\.m3u8(\?|$)/i.test(responseUrl)
      if (!looksVideo) return
      pushCandidate({ url: responseUrl, source: 'network', contentType: ct, contentLength: len })
    } catch { /* ignore */ }
  })

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(2_000)

    // Try clicking video to trigger loading
    const video = page.locator('video').first()
    if ((await video.count()) > 0) {
      await video.click({ timeout: 2_000 }).catch(() => {})
    }
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(5_000)

    // Collect video from DOM
    const domSources = await page.$$eval('video', (nodes) => {
      const urls = []
      for (const node of nodes) {
        if (node.currentSrc) urls.push(node.currentSrc)
        if (node.src) urls.push(node.src)
        for (const child of node.querySelectorAll('source')) {
          if (child.src) urls.push(child.src)
        }
      }
      return Array.from(new Set(urls.filter(Boolean)))
    })
    for (const src of domSources) pushCandidate({ url: src, source: 'dom' })

    // HTML regex for video URLs
    const html = await page.content()
    const urlMatches = html.match(/https?:\/\/[^"'\\\s>]+(\.mp4|\.m3u8)[^"'\\\s>]*/gi) || []
    for (const match of urlMatches) pushCandidate({ url: match, source: 'html' })

    const encodedMatches =
      html.match(/"(playable_url_quality_hd|playable_url|browser_native_sd_url|browser_native_hd_url)"\s*:\s*"([^"]+)"/gi) || []
    for (const match of encodedMatches) {
      const parsed = match.match(/"(playable_url_quality_hd|playable_url|browser_native_sd_url|browser_native_hd_url)"\s*:\s*"([^"]+)"/i)
      if (parsed) pushCandidate({ url: parsed[2], source: parsed[1] })
    }

    candidates.sort((a, b) => b.score - a.score)
    const bestVideo = candidates[0] || null

    // If no video found, extract the post image
    let imageUrl = null
    if (!bestVideo) {
      imageUrl = await page.evaluate(() => {
        // Look for post content images — skip profile pics, icons, UI chrome
        const imgs = Array.from(document.querySelectorAll('img'))
        const scored = imgs
          .filter((img) => {
            const w = img.naturalWidth || img.width || 0
            const h = img.naturalHeight || img.height || 0
            const src = img.src || ''
            if (w < 300 || h < 200) return false
            // Skip Facebook UI images
            if (src.includes('rsrc.php')) return false
            if (src.includes('/static/')) return false
            if (src.includes('emoji')) return false
            if (img.closest('header, nav, [role="banner"]')) return false
            // Profile pics are typically small and circular
            if (img.getAttribute('alt')?.includes('profile')) return false
            return true
          })
          .map((img) => ({
            src: img.src,
            area: (img.naturalWidth || img.width) * (img.naturalHeight || img.height),
          }))
          .sort((a, b) => b.area - a.area)
        return scored[0]?.src || null
      }).catch(() => null)
    }

    // Extract post text
    const postContent = await page.evaluate(() => {
      // Facebook post text is typically in the main content area
      const selectors = [
        'div[data-ad-preview="message"]',
        'div[data-testid="post_message"]',
        'div[dir="auto"]',
      ]
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel)
        const texts = Array.from(els)
          .map((el) => (el.textContent || '').trim())
          .filter((t) => t.length > 20)
          .sort((a, b) => b.length - a.length)
        if (texts.length > 0) return texts[0]
      }
      return null
    }).catch(() => null)

    const title = await page.title().catch(() => null)
    const cookieHeader = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')

    const mediaType = bestVideo ? 'video' : imageUrl ? 'image' : null

    return {
      videoUrl: bestVideo?.url || null,
      imageUrl,
      kind: bestVideo?.kind || null,
      title,
      adCopy: postContent,
      headline: null,
      cta: null,
      mediaType,
      requestHeaders: {
        'user-agent': FB_USER_AGENT,
        referer: url,
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      meta: { candidate_count: candidates.length, selected_source: bestVideo?.source || null },
    }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function scrapeFacebookReel(url) {
  log('Scraping Facebook reel via Playwright...', url)
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const page = await browser.newPage({
    userAgent: FB_USER_AGENT,
    viewport: { width: 1360, height: 768 },
    locale: 'en-US',
  })

  const candidates = []
  const seen = new Set()
  const pushCandidate = (candidate) => {
    const normalizedUrl = decodeEscapedUrl(candidate?.url || '').trim()
    if (!normalizedUrl || seen.has(normalizedUrl)) return
    seen.add(normalizedUrl)
    const kind = /\.m3u8(\?|$)/i.test(normalizedUrl) ? 'hls' : 'mp4'
    const next = {
      url: normalizedUrl,
      source: candidate?.source || 'unknown',
      contentType: candidate?.contentType || '',
      contentLength: Number(candidate?.contentLength || 0) || 0,
      kind,
    }
    next.score = scoreVideoCandidate(next)
    candidates.push(next)
  }

  page.on('response', async (res) => {
    try {
      const responseUrl = res.url()
      const headers = res.headers()
      const ct = headers['content-type'] || ''
      const len = Number(headers['content-length'] || 0) || 0
      const looksVideo =
        ct.startsWith('video/') ||
        ct.includes('mpegurl') ||
        /\.mp4(\?|$)/i.test(responseUrl) ||
        /\.m3u8(\?|$)/i.test(responseUrl)
      if (!looksVideo) return
      pushCandidate({ url: responseUrl, source: 'network', contentType: ct, contentLength: len })
    } catch { /* ignore */ }
  })

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(2_000)
    const video = page.locator('video').first()
    if ((await video.count()) > 0) {
      await video.click({ timeout: 2_000 }).catch(() => {})
    }
    await page.mouse.wheel(0, 900)
    await page.waitForTimeout(6_000)

    // DOM video sources
    const domSources = await page.$$eval('video', (nodes) => {
      const urls = []
      for (const node of nodes) {
        if (node.currentSrc) urls.push(node.currentSrc)
        if (node.src) urls.push(node.src)
        for (const child of node.querySelectorAll('source')) {
          if (child.src) urls.push(child.src)
        }
      }
      return Array.from(new Set(urls.filter(Boolean)))
    })
    for (const src of domSources) pushCandidate({ url: src, source: 'dom' })

    // HTML regex
    const html = await page.content()
    const urlMatches = html.match(/https?:\/\/[^"'\\\s>]+(\.mp4|\.m3u8)[^"'\\\s>]*/gi) || []
    for (const match of urlMatches) pushCandidate({ url: match, source: 'html' })

    const encodedMatches =
      html.match(/"(playable_url_quality_hd|playable_url|browser_native_sd_url)"\s*:\s*"([^"]+)"/gi) || []
    for (const match of encodedMatches) {
      const parsed = match.match(/"(playable_url_quality_hd|playable_url|browser_native_sd_url)"\s*:\s*"([^"]+)"/i)
      if (parsed) pushCandidate({ url: parsed[2], source: parsed[1] })
    }

    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0] || null
    const title = await page.title().catch(() => null)
    const cookieHeader = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')

    // If no video found, try to extract an image as fallback
    let imageUrl = null
    if (!best) {
      imageUrl = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img'))
        const scored = imgs
          .filter((img) => {
            const w = img.naturalWidth || img.width || 0
            const h = img.naturalHeight || img.height || 0
            const src = img.src || ''
            if (w < 300 || h < 200) return false
            if (src.includes('rsrc.php') || src.includes('/static/') || src.includes('emoji')) return false
            if (img.closest('header, nav, [role="banner"]')) return false
            return true
          })
          .map((img) => ({ src: img.src, area: (img.naturalWidth || img.width) * (img.naturalHeight || img.height) }))
          .sort((a, b) => b.area - a.area)
        return scored[0]?.src || null
      }).catch(() => null)
    }

    return {
      videoUrl: best?.url || null,
      imageUrl,
      kind: best?.kind || null,
      title,
      mediaType: best ? 'video' : imageUrl ? 'image' : 'video',
      requestHeaders: {
        'user-agent': FB_USER_AGENT,
        referer: url,
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      meta: { candidate_count: candidates.length, selected_source: best?.source || null },
    }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

function scoreVideoCandidate(candidate) {
  const url = String(candidate?.url || '')
  const contentType = String(candidate?.contentType || '').toLowerCase()
  const contentLength = Number(candidate?.contentLength || 0)
  let score = 0

  if (/\.mp4(\?|$)/i.test(url)) score += 60
  if (/\.m3u8(\?|$)/i.test(url)) score += 50
  if (contentType.startsWith('video/')) score += 35
  if (contentType.includes('mp4')) score += 20
  if (contentType.includes('mpegurl') || contentType.includes('x-mpegurl')) score += 20
  if (/hd|high/i.test(url)) score += 8
  if (/sd/i.test(url)) score -= 2

  if (Number.isFinite(contentLength) && contentLength > 0) {
    score += Math.min(22, Math.log10(contentLength + 1) * 4)
  }

  return score
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
  const seen = new Set()
  const pushCandidate = (candidate) => {
    const normalizedUrl = decodeEscapedUrl(candidate?.url || '').trim()
    if (!normalizedUrl || seen.has(normalizedUrl)) return
    seen.add(normalizedUrl)
    const kind = /\.m3u8(\?|$)/i.test(normalizedUrl) ? 'hls' : 'mp4'
    const next = {
      url: normalizedUrl,
      source: candidate?.source || 'unknown',
      contentType: candidate?.contentType || '',
      contentLength: Number(candidate?.contentLength || 0) || 0,
      kind,
    }
    next.score = scoreVideoCandidate(next)
    candidates.push(next)
  }

  page.on('response', async (res) => {
    try {
      const responseUrl = res.url()
      const headers = res.headers()
      const ct = headers['content-type'] || ''
      const len = Number(headers['content-length'] || 0) || 0
      const looksVideo =
        ct.startsWith('video/') ||
        ct.includes('mpegurl') ||
        /\.mp4(\?|$)/i.test(responseUrl) ||
        /\.m3u8(\?|$)/i.test(responseUrl)
      if (!looksVideo) return
      pushCandidate({
        url: responseUrl,
        source: 'network',
        contentType: ct,
        contentLength: len,
      })
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

    // Collect direct DOM sources.
    const domSources = await page.$$eval('video', (nodes) => {
      const urls = []
      for (const node of nodes) {
        if (node.currentSrc) urls.push(node.currentSrc)
        if (node.src) urls.push(node.src)
        const children = node.querySelectorAll('source')
        for (const child of children) {
          if (child.src) urls.push(child.src)
        }
      }
      return Array.from(new Set(urls.filter(Boolean)))
    })
    for (const src of domSources) {
      pushCandidate({ url: src, source: 'dom' })
    }

    // Parse page HTML for MP4/HLS and common Meta JSON fields.
    const html = await page.content()
    const urlMatches = html.match(/https?:\/\/[^"'\\\s>]+(\.mp4|\.m3u8)[^"'\\\s>]*/gi) || []
    for (const match of urlMatches) {
      pushCandidate({ url: match, source: 'html' })
    }

    const encodedMatches =
      html.match(/"(playable_url_quality_hd|playable_url|browser_native_sd_url)"\s*:\s*"([^"]+)"/gi) || []
    for (const match of encodedMatches) {
      const parsed = match.match(/"(playable_url_quality_hd|playable_url|browser_native_sd_url)"\s*:\s*"([^"]+)"/i)
      if (!parsed) continue
      pushCandidate({ url: parsed[2], source: parsed[1] })
    }

    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0] || null

    const title = await page.title().catch(() => null)
    const cookieHeader = (await page.context().cookies())
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ')

    // Extract ad copy, headline, CTA from Meta Ad Library page
    const adContent = await page.evaluate(() => {
      function longest(texts) {
        return texts.filter(Boolean).sort((a, b) => b.length - a.length)[0] || null
      }
      function trySelectors(selectors, minLen = 10) {
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel)
          const texts = Array.from(els).map(el => (el.textContent || '').trim()).filter(t => t.length >= minLen)
          if (texts.length > 0) return longest(texts)
        }
        return null
      }

      const adCopy = trySelectors([
        'div._4ik4._4ik5 span',
        'div[data-testid="ad_body"] span',
        'div._7jyr span',
        'div._8jh1 span',
        'div[class*="x1cy8zhl"] span',
      ], 20)

      const headline = trySelectors([
        'a._231w._231z._4yee span',
        'div._8jh2 a span',
        'a[role="link"][href*="l.facebook.com"] span',
        'div[class*="x1heor9g"] a span',
      ], 3)

      const cta = trySelectors([
        'div._8jh3 span',
        'a[data-testid="cta_button"] span',
        'div[class*="x1i10hfl"] span[class*="x1lliihq"]',
      ], 2)

      // Determine media type
      const hasVideo = document.querySelector('video') !== null
      const hasCarousel = document.querySelector('div._8o0a') !== null
      const mediaType = hasVideo ? 'video' : hasCarousel ? 'carousel' : 'image'

      return { adCopy, headline, cta, mediaType }
    }).catch(() => ({ adCopy: null, headline: null, cta: null, mediaType: 'video' }))

    // If no video found and media type is image, extract the ad creative image
    let imageUrl = null
    if (!best && adContent.mediaType === 'image') {
      imageUrl = await page.evaluate(() => {
        // Target the ad creative container — Ad Library renders the ad preview
        // inside specific containers. Try multiple selectors.
        const adContainerSelectors = [
          'div._8o0a img',           // Ad preview carousel/image container
          'div._7jyr img',           // Ad body container image
          'div[data-testid="ad_creative"] img',
          'div._8jh1 img',           // Ad card image
          'div[class*="x1cy8zhl"] img',
        ]

        for (const sel of adContainerSelectors) {
          const imgs = Array.from(document.querySelectorAll(sel))
          const valid = imgs
            .filter((img) => {
              const w = img.naturalWidth || img.width || 0
              const h = img.naturalHeight || img.height || 0
              // Must be a real content image, not an icon
              return w > 200 && h > 200 && img.src && !img.src.includes('emoji')
            })
            .sort((a, b) => {
              const aArea = (a.naturalWidth || a.width) * (a.naturalHeight || a.height)
              const bArea = (b.naturalWidth || b.width) * (b.naturalHeight || b.height)
              return bArea - aArea
            })
          if (valid.length > 0) return valid[0].src
        }

        // Fallback: find largest image that looks like ad content
        // Exclude Facebook UI images (profile pics, icons, logos)
        const allImgs = Array.from(document.querySelectorAll('img'))
        const candidates = allImgs
          .filter((img) => {
            const w = img.naturalWidth || img.width || 0
            const h = img.naturalHeight || img.height || 0
            const src = img.src || ''
            if (w < 300 || h < 200) return false
            // Exclude common FB chrome patterns
            if (src.includes('rsrc.php')) return false
            if (src.includes('profile')) return false
            if (src.includes('emoji')) return false
            if (src.includes('/static/')) return false
            if (img.closest('header, nav, [role="banner"]')) return false
            return true
          })
          .map((img) => ({
            src: img.src,
            area: (img.naturalWidth || img.width) * (img.naturalHeight || img.height),
          }))
          .sort((a, b) => b.area - a.area)
        return candidates[0]?.src || null
      }).catch(() => null)
    }

    return {
      videoUrl: best?.url || null,
      imageUrl,
      kind: best?.kind || null,
      adCopy: adContent.adCopy || null,
      headline: adContent.headline || null,
      cta: adContent.cta || null,
      mediaType: adContent.mediaType || 'video',
      requestHeaders: {
        'user-agent': userAgent,
        referer: url,
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      meta: {
        page_title: title,
        candidate_count: candidates.length,
        selected_source: best?.source || null,
      },
    }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function downloadToFile(url, filePath, maxBytes, requestHeaders = {}) {
  const res = await fetch(url, { redirect: 'follow', headers: requestHeaders })
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

async function transcribeWhisper(openaiClient, audioPath) {
  const res = await openaiClient.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    response_format: 'text',
  })
  const text = typeof res === 'string' ? res : typeof res.text === 'string' ? res.text : ''
  return { text }
}

async function compressAudioForWhisper(inputPath, outputPath) {
  // Compress to mono 16kHz 64kbps MP3 (matches WinnersFinder approach)
  await runCommand('ffmpeg', [
    '-y', '-i', inputPath,
    '-vn',
    '-acodec', 'libmp3lame',
    '-ar', '16000',
    '-ac', '1',
    '-b:a', '64k',
    outputPath,
  ])
}

async function summarizeSwipe({ anthropicClient, system, prompt }) {
  const message = await anthropicClient.messages.create({
    model: SUMMARIZE_MODEL,
    max_tokens: 350,
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = message.content.find((c) => c.type === 'text')?.text || ''
  const cleaned = (text.match(/```json\s*([\s\S]*?)\s*```/) || [null, text])[1].trim()
  try {
    const parsed = JSON.parse(cleaned)
    return {
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, 140) : null,
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
    }
  } catch {
    return {
      title: null,
      summary: cleaned.slice(0, 800),
    }
  }
}

async function summarizeResearch({ anthropicClient, system, prompt }) {
  const message = await anthropicClient.messages.create({
    model: SUMMARIZE_MODEL,
    max_tokens: 350,
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  const content = message.content.find((c) => c.type === 'text')?.text || ''
  const cleaned = (content.match(/```json\s*([\s\S]*?)\s*```/) || [null, content])[1].trim()
  try {
    const parsed = JSON.parse(cleaned)
    return {
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, 140) : null,
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 8) : [],
    }
  } catch {
    return {
      title: null,
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

  const orgId = await getOrgIdForProduct(productId)
  const anthropicClient = await getAnthropicClient(orgId)
  const promptBlocks = await loadGlobalPromptBlocks()

  // Classify URL and route to appropriate scraper
  const urlType = classifySwipeUrl(url) || 'ad_library'
  log('Scraping URL...', url, 'type:', urlType)

  let scraped
  if (urlType === 'fb_post') {
    scraped = await scrapeFacebookPost(url)
  } else if (urlType === 'fb_reel') {
    scraped = await scrapeFacebookReel(url)
  } else {
    scraped = await scrapeMetaAdVideo(url)
  }

  const hasVideo = Boolean(scraped.videoUrl)
  const hasImage = Boolean(scraped.imageUrl)

  if (!hasVideo && !hasImage) {
    throw new Error('No video or image found on page')
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'brandlab-swipe-'))

  try {
    if (hasVideo) {
      // ---- VIDEO PATH ----
      const openaiClient = await getOpenAiClient(orgId)
      const mp4Path = path.join(tmpDir, 'source.mp4')
      const audioPath = path.join(tmpDir, 'audio.mp3')
      const maxBytes = 250 * 1024 * 1024

      const looksHls =
        scraped.kind === 'hls' || /\.m3u8(\?|$)/i.test(String(scraped.videoUrl || ''))

      if (looksHls) {
        log('Downloading HLS stream via ffmpeg...')
        const headerLines = Object.entries(scraped.requestHeaders || {})
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join('')
        const ffmpegArgs = ['-y']
        if (headerLines) ffmpegArgs.push('-headers', headerLines)
        ffmpegArgs.push(
          '-i', scraped.videoUrl,
          '-c:v', 'libx264', '-preset', 'veryfast',
          '-c:a', 'aac', '-movflags', '+faststart',
          mp4Path
        )
        await runCommand('ffmpeg', ffmpegArgs, { cwd: tmpDir })
      } else {
        log('Downloading MP4...')
        await downloadToFile(scraped.videoUrl, mp4Path, maxBytes, scraped.requestHeaders || {})
      }

      const downloaded = await fsp.stat(mp4Path)
      if (downloaded.size > maxBytes) {
        throw new Error(`Video too large after download (${downloaded.size} bytes)`)
      }

      const r2Key = `products/${productId}/swipes/${swipeId}/source.mp4`
      log('Uploading video to R2...', r2Key)
      await uploadToR2(r2Key, mp4Path, 'video/mp4')

      log('Extracting audio...')
      await runCommand('ffmpeg', ['-y', '-i', mp4Path, '-vn', '-acodec', 'mp3', '-b:a', '128k', audioPath], {
        cwd: tmpDir,
      })

      const audioStat = await fsp.stat(audioPath)
      const WHISPER_MAX = 25 * 1024 * 1024
      let whisperPath = audioPath
      if (audioStat.size > WHISPER_MAX) {
        log('Audio too large for Whisper, compressing...')
        const compressedPath = path.join(tmpDir, 'audio_compressed.mp3')
        await compressAudioForWhisper(mp4Path, compressedPath)
        whisperPath = compressedPath
      }

      log('Transcribing (Whisper)...')
      const transcript = await transcribeWhisper(openaiClient, whisperPath)

      log('Summarizing...')
      const swipeSystem = getPromptBlockContent(promptBlocks, 'swipe_summarizer_system')
      const swipePromptTemplate = getPromptBlockContent(promptBlocks, 'swipe_summarizer_prompt')
      const swipePrompt = applyTemplate(swipePromptTemplate, {
        url,
        transcript: transcript.text.slice(0, 12000),
      })
      const summary = await summarizeSwipe({ anthropicClient, system: swipeSystem, prompt: swipePrompt })

      const meta = {
        ...(scraped.meta || {}),
        video_url: scraped.videoUrl,
        video_kind: scraped.kind || null,
        url_type: urlType,
      }

      await pool.query(
        `
        UPDATE swipes
        SET status = 'ready',
            r2_video_key = $2,
            transcript = $3,
            title = COALESCE($4, title),
            summary = COALESCE($5, summary),
            headline = COALESCE($6, headline),
            ad_copy = COALESCE($7, ad_copy),
            cta = COALESCE($8, cta),
            media_type = COALESCE($9, media_type),
            metadata = metadata || $10::jsonb,
            error_message = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
        [swipeId, r2Key, transcript.text, summary.title, summary.summary,
         scraped.headline || null, scraped.adCopy || null, scraped.cta || null,
         scraped.mediaType || 'video', JSON.stringify(meta)]
      )

      await pool.query(
        `UPDATE media_jobs SET status = 'completed', output = $2, error_message = NULL, updated_at = NOW() WHERE id = $1`,
        [job.id, { swipe_id: swipeId, r2_video_key: r2Key, transcript_len: transcript.text.length, title: summary.title }]
      )
    } else {
      // ---- IMAGE PATH ----
      log('Processing image swipe...')
      const imageUrl = scraped.imageUrl
      const ext = /\.(png|gif|webp)/i.test(imageUrl) ? imageUrl.match(/\.(png|gif|webp)/i)[1].toLowerCase() : 'jpg'
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      const imagePath = path.join(tmpDir, `source.${ext}`)

      log('Downloading image...')
      await downloadToFile(imageUrl, imagePath, 50 * 1024 * 1024, scraped.requestHeaders || {})

      const r2ImageKey = `products/${productId}/swipes/${swipeId}/source.${ext}`
      log('Uploading image to R2...', r2ImageKey)
      await uploadToR2(r2ImageKey, imagePath, mime)

      // Summarize from ad copy text (no transcript for images)
      let summary = { title: null, summary: null }
      const adText = [scraped.headline, scraped.adCopy, scraped.cta].filter(Boolean).join('\n')
      if (adText.length > 10) {
        log('Summarizing from ad copy...')
        const swipeSystem = getPromptBlockContent(promptBlocks, 'swipe_summarizer_system')
        const swipePrompt = `Return JSON with keys: title, summary.\n\nURL: ${url}\n\nAd copy:\n${adText.slice(0, 6000)}`
        summary = await summarizeSwipe({ anthropicClient, system: swipeSystem, prompt: swipePrompt })
      } else if (scraped.title) {
        summary = { title: scraped.title.slice(0, 140), summary: null }
      }

      const meta = {
        ...(scraped.meta || {}),
        image_url: imageUrl,
        url_type: urlType,
      }

      await pool.query(
        `
        UPDATE swipes
        SET status = 'ready',
            r2_image_key = $2,
            r2_image_mime = $3,
            title = COALESCE($4, title),
            summary = COALESCE($5, summary),
            headline = COALESCE($6, headline),
            ad_copy = COALESCE($7, ad_copy),
            cta = COALESCE($8, cta),
            media_type = 'image',
            metadata = metadata || $9::jsonb,
            error_message = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
        [swipeId, r2ImageKey, mime, summary.title, summary.summary,
         scraped.headline || null, scraped.adCopy || null, scraped.cta || null,
         JSON.stringify(meta)]
      )

      await pool.query(
        `UPDATE media_jobs SET status = 'completed', output = $2, error_message = NULL, updated_at = NOW() WHERE id = $1`,
        [job.id, { swipe_id: swipeId, r2_image_key: r2ImageKey, title: summary.title }]
      )
    }

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

  const orgId = await getOrgIdForProduct(productId)
  const anthropicClient = await getAnthropicClient(orgId)
  const promptBlocks = await loadGlobalPromptBlocks()

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
    const researchSystem = getPromptBlockContent(promptBlocks, 'research_summarizer_system')
    const researchPromptTemplate = getPromptBlockContent(promptBlocks, 'research_summarizer_prompt')
    const researchPrompt = applyTemplate(researchPromptTemplate, {
      title: filename,
      text: text.slice(0, 14000),
    })
    const summary = await summarizeResearch({
      anthropicClient,
      system: researchSystem,
      prompt: researchPrompt,
    })

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
