'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Brand { id: string; name: string }
interface Product { id: string; name: string }

const TYPES = [
  { value: 'global_rules', label: 'Global Rules', description: 'System-wide rules (format, safety, style)' },
  { value: 'brand_voice', label: 'Brand Voice', description: 'Brand-specific tone and voice' },
  { value: 'product_context', label: 'Product Context', description: 'Product positioning instructions' },
  { value: 'avatar_context', label: 'Avatar Context', description: 'How to use avatar data' },
  { value: 'feature_template', label: 'Feature Template', description: 'Feature-specific instructions (e.g., static ads)' },
  { value: 'output_format', label: 'Output Format', description: 'JSON/structured output requirements' },
  { value: 'custom', label: 'Custom', description: 'User-defined blocks' },
]

const SCOPES = [
  { value: 'global', label: 'Global', description: 'Available to all brands' },
  { value: 'brand', label: 'Brand', description: 'Scoped to a specific brand' },
  { value: 'product', label: 'Product', description: 'Scoped to a specific product' },
  { value: 'feature', label: 'Feature', description: 'Scoped to a feature type' },
]

export default function NewPromptBlock() {
  const router = useRouter()
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [scope, setScope] = useState('global')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/brands').then(r => r.json()),
      fetch('/api/products').then(r => r.json()),
    ]).then(([b, p]) => {
      setBrands(b)
      setProducts(p)
    })
  }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const data = {
      name: formData.get('name') as string,
      type: formData.get('type') as string,
      scope: formData.get('scope') as string,
      scope_id: formData.get('scope_id') as string || null,
      content: formData.get('content') as string,
    }

    try {
      const res = await fetch('/api/prompt-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create')
      }

      router.push('/admin/prompt-blocks')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Link href="/admin/prompt-blocks" className="text-zinc-500 hover:text-zinc-300 text-sm mb-4 block">
          ← Back to Prompt Blocks
        </Link>

        <h1 className="text-2xl font-bold mb-6">New Prompt Block</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-2">Name *</label>
            <input
              type="text"
              id="name"
              name="name"
              required
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg"
              placeholder="e.g., Global Writing Rules v1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="type" className="block text-sm font-medium mb-2">Type *</label>
              <select
                id="type"
                name="type"
                required
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg"
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className="text-zinc-500 text-xs mt-1">
                {TYPES.find(t => t.value === 'global_rules')?.description}
              </p>
            </div>

            <div>
              <label htmlFor="scope" className="block text-sm font-medium mb-2">Scope *</label>
              <select
                id="scope"
                name="scope"
                required
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg"
              >
                {SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {scope === 'brand' && (
            <div>
              <label htmlFor="scope_id" className="block text-sm font-medium mb-2">Brand *</label>
              <select
                id="scope_id"
                name="scope_id"
                required
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg"
              >
                <option value="">Select brand...</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          {scope === 'product' && (
            <div>
              <label htmlFor="scope_id" className="block text-sm font-medium mb-2">Product *</label>
              <select
                id="scope_id"
                name="scope_id"
                required
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg"
              >
                <option value="">Select product...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {scope === 'feature' && (
            <div>
              <label htmlFor="scope_id" className="block text-sm font-medium mb-2">Feature Type *</label>
              <select
                id="scope_id"
                name="scope_id"
                required
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg"
              >
                <option value="">Select feature...</option>
                <option value="organic_static">Organic Static Ads</option>
                <option value="ugc_video_scripts">UGC Video Scripts</option>
                <option value="landing_page_copy">Landing Page Copy</option>
                <option value="advertorial_copy">Advertorial Copy</option>
              </select>
            </div>
          )}

          <div>
            <label htmlFor="content" className="block text-sm font-medium mb-2">Content *</label>
            <textarea
              id="content"
              name="content"
              required
              rows={15}
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg font-mono text-sm"
              placeholder="Enter the prompt block content...

Example for Global Rules:
## Writing Guidelines
- Write in first person, conversational tone
- Avoid jargon and technical terms
- Focus on emotional triggers over features
- Never use superlatives without proof
..."
            />
          </div>

          {error && (
            <div className="p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Block'}
            </button>
            <Link href="/admin/prompt-blocks" className="px-6 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
