import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { encryptSecret } from '@/lib/secrets'
import { getOrgApiKeyStatus, ApiKeyProvider } from '@/lib/api-keys'
import { requireAuth } from '@/lib/require-auth'

const PROVIDERS: ApiKeyProvider[] = ['openai', 'anthropic']

function assertProvider(value: string): value is ApiKeyProvider {
  return PROVIDERS.includes(value as ApiKeyProvider)
}

export async function GET(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const orgId = String(searchParams.get('org_id') || '').trim()
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 })

  try {
    const providers = await getOrgApiKeyStatus(orgId)
    return NextResponse.json({ org_id: orgId, providers })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load API keys' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const orgId = String(body.org_id || '').trim()
    const providerRaw = String(body.provider || '').trim().toLowerCase()
    const apiKey = String(body.api_key || '').trim()

    if (!orgId || !providerRaw || !apiKey) {
      return NextResponse.json({ error: 'org_id, provider, and api_key are required' }, { status: 400 })
    }

    if (!assertProvider(providerRaw)) {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
    }

    const encrypted = encryptSecret(apiKey)
    const last4 = apiKey.slice(-4)

    const rows = await sql`
      INSERT INTO organization_api_keys (organization_id, provider, api_key_encrypted, last4)
      VALUES (${orgId}, ${providerRaw}, ${encrypted}, ${last4})
      ON CONFLICT (organization_id, provider)
      DO UPDATE SET api_key_encrypted = EXCLUDED.api_key_encrypted,
                    last4 = EXCLUDED.last4,
                    updated_at = NOW()
      RETURNING id
    `

    return NextResponse.json({ success: true, id: rows[0]?.id || null, last4 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to save API key' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const orgId = String(searchParams.get('org_id') || '').trim()
  const providerRaw = String(searchParams.get('provider') || '').trim().toLowerCase()

  if (!orgId || !providerRaw) {
    return NextResponse.json({ error: 'org_id and provider are required' }, { status: 400 })
  }

  if (!assertProvider(providerRaw)) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
  }

  try {
    await sql`
      DELETE FROM organization_api_keys
      WHERE organization_id = ${orgId}
        AND provider = ${providerRaw}
    `
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to delete API key' }, { status: 500 })
  }
}
