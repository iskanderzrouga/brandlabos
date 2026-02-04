'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Organization {
  id: string
  name: string
  slug: string
}

export default function NewBrand() {
  const router = useRouter()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/organizations')
      .then((res) => res.json())
      .then(setOrganizations)
      .catch(console.error)
  }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const data = {
      organization_id: formData.get('organization_id') as string,
      name: formData.get('name') as string,
      slug: formData.get('slug') as string,
      voice_guidelines: formData.get('voice_guidelines') as string || null,
    }

    try {
      const res = await fetch('/api/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create brand')
      }

      router.push('/admin')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <Link href="/admin" className="text-zinc-500 hover:text-zinc-300 text-sm mb-4 block">
          ← Back to Admin
        </Link>

        <h1 className="text-2xl font-bold mb-6">New Brand</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="organization_id" className="block text-sm font-medium mb-2">
              Organization
            </label>
            <select
              id="organization_id"
              name="organization_id"
              required
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
            >
              <option value="">Select organization...</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            {organizations.length === 0 && (
              <p className="text-zinc-500 text-sm mt-1">
                <Link href="/admin/organizations/new" className="text-zinc-300 hover:underline">
                  Create an organization first
                </Link>
              </p>
            )}
          </div>

          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-2">
              Brand Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
              placeholder="My Brand"
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
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
              placeholder="my-brand"
            />
          </div>

          <div>
            <label htmlFor="voice_guidelines" className="block text-sm font-medium mb-2">
              Voice Guidelines (optional)
            </label>
            <textarea
              id="voice_guidelines"
              name="voice_guidelines"
              rows={4}
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
              placeholder="Describe the brand's tone of voice, style, and personality..."
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
              {loading ? 'Creating...' : 'Create Brand'}
            </button>
            <Link href="/admin" className="px-6 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
