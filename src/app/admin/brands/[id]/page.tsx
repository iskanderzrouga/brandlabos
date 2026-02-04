'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Brand {
  id: string
  organization_id: string
  name: string
  slug: string
  voice_guidelines: string | null
  created_at: string
  updated_at: string
  products?: { id: string; name: string; slug: string }[]
}

export default function EditBrand({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [brand, setBrand] = useState<Brand | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/brands/${id}`)
      .then((res) => res.json())
      .then(setBrand)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const data = {
      name: formData.get('name') as string,
      slug: formData.get('slug') as string,
      voice_guidelines: formData.get('voice_guidelines') as string || null,
    }

    try {
      const res = await fetch(`/api/brands/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update')
      }

      router.push('/admin')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this brand? All products and avatars will be deleted.')) return

    try {
      const res = await fetch(`/api/brands/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      router.push('/admin')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    )
  }

  if (!brand) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-red-400">Brand not found</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <Link href="/admin" className="text-zinc-500 hover:text-zinc-300 text-sm mb-4 block">
          ← Back to Admin
        </Link>

        <h1 className="text-2xl font-bold mb-6">Edit Brand: {brand.name}</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-2">
              Brand Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              defaultValue={brand.name}
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium mb-2">
              Slug
            </label>
            <input
              type="text"
              id="slug"
              name="slug"
              required
              pattern="[a-z0-9-]+"
              defaultValue={brand.slug}
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label htmlFor="voice_guidelines" className="block text-sm font-medium mb-2">
              Voice Guidelines
            </label>
            <textarea
              id="voice_guidelines"
              name="voice_guidelines"
              rows={4}
              defaultValue={brand.voice_guidelines || ''}
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
            />
          </div>

          {brand.products && brand.products.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Products</h3>
              <ul className="space-y-1">
                {brand.products.map((product) => (
                  <li key={product.id}>
                    <Link
                      href={`/admin/products/${product.id}`}
                      className="text-zinc-400 hover:text-zinc-200"
                    >
                      {product.name} (/{product.slug})
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="px-6 py-2 bg-red-900/20 text-red-400 border border-red-800 rounded-lg hover:bg-red-900/40"
            >
              Delete
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
