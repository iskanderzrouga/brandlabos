import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

function resolveKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set')

  const trimmed = raw.trim()
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed)
  if (isHex && trimmed.length === 64) {
    const key = Buffer.from(trimmed, 'hex')
    if (key.length === 32) return key
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

export function encryptSecret(value: string): string {
  const key = resolveKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptSecret(payload: string): string {
  const key = resolveKey()
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted payload')
  }
  const iv = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const data = Buffer.from(parts[3], 'base64')
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return decrypted.toString('utf8')
}
