import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { requireAuth } from '@/lib/require-auth'
import { signR2PutObjectUrl } from '@/lib/r2'

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const productId = String(body.product_id || '').trim()
    const filename = String(body.filename || '').trim()
    const mime = body.mime ? String(body.mime) : 'application/octet-stream'
    const size = body.size ? Number(body.size) : null

    if (!productId || !filename) {
      return NextResponse.json({ error: 'product_id and filename are required' }, { status: 400 })
    }

    const id = crypto.randomUUID()
    const key = `products/${productId}/research/${id}/${safeFilename(filename)}`
    const uploadUrl = await signR2PutObjectUrl(key, mime, 300)

    return NextResponse.json({
      upload_url: uploadUrl,
      r2_key: key,
      mime,
      size,
    })
  } catch (error) {
    console.error('Create research upload error:', error)
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 })
  }
}
