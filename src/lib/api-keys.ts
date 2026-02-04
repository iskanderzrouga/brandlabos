import { sql } from '@/lib/db'
import { decryptSecret } from '@/lib/secrets'

export type ApiKeyProvider = 'openai' | 'anthropic'

const ENV_MAP: Record<ApiKeyProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

export function getEnvApiKey(provider: ApiKeyProvider): string | null {
  const envKey = process.env[ENV_MAP[provider]]
  return envKey && envKey.trim().length > 0 ? envKey.trim() : null
}

export async function getOrgApiKey(provider: ApiKeyProvider, orgId?: string | null): Promise<string | null> {
  if (!orgId) return getEnvApiKey(provider)

  const rows = await sql`
    SELECT api_key_encrypted
    FROM organization_api_keys
    WHERE organization_id = ${orgId}
      AND provider = ${provider}
    LIMIT 1
  `

  const encrypted = rows[0]?.api_key_encrypted as string | undefined
  if (encrypted) {
    return decryptSecret(encrypted)
  }

  return getEnvApiKey(provider)
}

export async function getOrgApiKeyStatus(orgId: string) {
  const rows = await sql`
    SELECT provider, last4
    FROM organization_api_keys
    WHERE organization_id = ${orgId}
  `

  const byProvider = new Map<string, { last4?: string | null }>()
  for (const row of rows as any[]) {
    byProvider.set(String(row.provider), { last4: row.last4 })
  }

  const providers: ApiKeyProvider[] = ['openai', 'anthropic']
  return providers.map((provider) => {
    const found = byProvider.get(provider)
    return {
      provider,
      has_db_key: Boolean(found),
      last4: found?.last4 || null,
      env_present: Boolean(getEnvApiKey(provider)),
    }
  })
}
