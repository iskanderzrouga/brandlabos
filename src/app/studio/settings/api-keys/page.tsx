'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/components/app-shell'

type ProviderStatus = {
  provider: 'openai' | 'anthropic'
  has_db_key: boolean
  last4: string | null
  env_present: boolean
}

const PROVIDERS = [
  {
    id: 'openai' as const,
    label: 'OpenAI',
    description: 'Used for Whisper transcription in swipe ingestion.',
  },
  {
    id: 'anthropic' as const,
    label: 'Anthropic',
    description: 'Used for the writer agent + research organization/summaries.',
  },
]

export default function ApiKeysPage() {
  const { selectedOrg, openContextDrawer } = useAppContext()
  const [loading, setLoading] = useState(true)
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState<string | null>(null)

  const statusByProvider = useMemo(() => {
    const map = new Map(statuses.map((s) => [s.provider, s]))
    return (provider: ProviderStatus['provider']) => map.get(provider)
  }, [statuses])

  async function load() {
    if (!selectedOrg) return
    setLoading(true)
    try {
      const res = await fetch(`/api/settings/api-keys?org_id=${selectedOrg}`)
      const data = await res.json()
      setStatuses(Array.isArray(data?.providers) ? data.providers : [])
    } catch {
      setStatuses([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setMessage(null)
    if (selectedOrg) load()
  }, [selectedOrg])

  async function saveKey(provider: ProviderStatus['provider']) {
    if (!selectedOrg) return
    const apiKey = values[provider]?.trim()
    if (!apiKey) return

    setSaving((prev) => ({ ...prev, [provider]: true }))
    setMessage(null)

    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: selectedOrg, provider, api_key: apiKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to save key')
      setValues((prev) => ({ ...prev, [provider]: '' }))
      await load()
      setMessage('API key saved.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save key')
    } finally {
      setSaving((prev) => ({ ...prev, [provider]: false }))
    }
  }

  async function clearKey(provider: ProviderStatus['provider']) {
    if (!selectedOrg) return
    if (!confirm('Remove the stored key for this provider?')) return

    setSaving((prev) => ({ ...prev, [provider]: true }))
    setMessage(null)

    try {
      const res = await fetch(
        `/api/settings/api-keys?org_id=${selectedOrg}&provider=${provider}`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to clear key')
      await load()
      setMessage('API key removed.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to clear key')
    } finally {
      setSaving((prev) => ({ ...prev, [provider]: false }))
    }
  }

  if (!selectedOrg) {
    return (
      <div className="h-full flex items-center justify-center p-10">
        <div className="editor-panel p-8 max-w-lg w-full text-center">
          <p className="font-serif text-2xl">Select an organization</p>
          <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
            API keys are stored per organization.
          </p>
          <button onClick={openContextDrawer} className="editor-button mt-6">
            Open Context
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">
            Settings
          </p>
          <h1 className="font-serif text-3xl leading-tight">API Keys</h1>
          <p className="text-sm text-[var(--editor-ink-muted)] mt-2">
            Stored keys override environment variables. If no key is stored, the env fallback is used.
          </p>
        </div>

        {message && (
          <div className="editor-panel p-4 text-sm text-[var(--editor-ink)]">{message}</div>
        )}

        {loading ? (
          <div className="text-sm text-[var(--editor-ink-muted)]">Loading...</div>
        ) : (
          <div className="space-y-4">
            {PROVIDERS.map((provider) => {
              const status = statusByProvider(provider.id)
              return (
                <div key={provider.id} className="editor-panel p-5">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-[var(--editor-ink-muted)]">
                        {provider.label}
                      </p>
                      <p className="text-sm text-[var(--editor-ink)] mt-2 font-medium">
                        {provider.description}
                      </p>
                      <div className="text-xs text-[var(--editor-ink-muted)] mt-2">
                        {status?.has_db_key
                          ? `Stored • last4 ${status.last4 || '----'}`
                          : 'Not stored'}
                        {status?.env_present && ' • Env fallback available'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {status?.has_db_key && (
                        <button
                          onClick={() => clearKey(provider.id)}
                          disabled={saving[provider.id]}
                          className="editor-button-ghost text-xs"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        onClick={() => saveKey(provider.id)}
                        disabled={saving[provider.id] || !values[provider.id]?.trim()}
                        className="editor-button text-xs"
                      >
                        {saving[provider.id] ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-xs text-[var(--editor-ink-muted)] mb-1">
                      New API Key
                    </label>
                    <input
                      type="password"
                      value={values[provider.id] || ''}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [provider.id]: e.target.value }))
                      }
                      placeholder={`Paste ${provider.label} key`}
                      className="editor-input w-full text-sm"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
