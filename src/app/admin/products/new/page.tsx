'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Brand {
  id: string
  name: string
  slug: string
}

export default function NewProduct() {
  const router = useRouter()
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/brands')
      .then((res) => res.json())
      .then(setBrands)
      .catch(console.error)
  }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)

    // Build claims arrays from comma-separated input
    const claimsStr = formData.get('claims') as string
    const claimsBoundariesStr = formData.get('claims_boundaries') as string
    const proofPointsStr = formData.get('proof_points') as string
    const ingredientsStr = formData.get('ingredients') as string

    const data = {
      brand_id: formData.get('brand_id') as string,
      name: formData.get('name') as string,
      slug: formData.get('slug') as string,
      context: {
        pitch: formData.get('pitch') as string,
        mechanism: formData.get('mechanism') as string || null,
        ingredients: ingredientsStr ? ingredientsStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
        claims: claimsStr ? claimsStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
        claims_boundaries: claimsBoundariesStr ? claimsBoundariesStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
        proof_points: proofPointsStr ? proofPointsStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
        competitive_angle: formData.get('competitive_angle') as string || null,
      },
    }

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create product')
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

        <h1 className="text-2xl font-bold mb-6">New Product</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="brand_id" className="block text-sm font-medium mb-2">
              Brand
            </label>
            <select
              id="brand_id"
              name="brand_id"
              required
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
            >
              <option value="">Select brand...</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-2">
                Product Name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
                placeholder="Weight Loss Supplement"
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
                placeholder="weight-loss-supplement"
              />
            </div>
          </div>

          <div className="border-t border-zinc-800 pt-6">
            <h2 className="text-lg font-semibold mb-4">Product Context</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="pitch" className="block text-sm font-medium mb-2">
                  Core Pitch *
                </label>
                <textarea
                  id="pitch"
                  name="pitch"
                  required
                  rows={3}
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
                  placeholder="The main promise and value proposition..."
                />
              </div>

              <div>
                <label htmlFor="mechanism" className="block text-sm font-medium mb-2">
                  Unique Mechanism
                </label>
                <textarea
                  id="mechanism"
                  name="mechanism"
                  rows={2}
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
                  placeholder="What makes this product work differently..."
                />
              </div>

              <div>
                <label htmlFor="ingredients" className="block text-sm font-medium mb-2">
                  Key Ingredients/Components
                </label>
                <input
                  type="text"
                  id="ingredients"
                  name="ingredients"
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
                  placeholder="Ingredient A, Ingredient B, Ingredient C"
                />
                <p className="text-zinc-500 text-sm mt-1">Comma-separated list</p>
              </div>

              <div>
                <label htmlFor="claims" className="block text-sm font-medium mb-2">
                  Claims We Can Make
                </label>
                <input
                  type="text"
                  id="claims"
                  name="claims"
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
                  placeholder="Claim 1, Claim 2, Claim 3"
                />
              </div>

              <div>
                <label htmlFor="claims_boundaries" className="block text-sm font-medium mb-2">
                  Claims Boundaries (DO NOT SAY)
                </label>
                <input
                  type="text"
                  id="claims_boundaries"
                  name="claims_boundaries"
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
                  placeholder="Never claim X, Avoid saying Y"
                />
              </div>

              <div>
                <label htmlFor="proof_points" className="block text-sm font-medium mb-2">
                  Proof Points
                </label>
                <input
                  type="text"
                  id="proof_points"
                  name="proof_points"
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
                  placeholder="Study A, 10000 reviews, Expert endorsement"
                />
              </div>

              <div>
                <label htmlFor="competitive_angle" className="block text-sm font-medium mb-2">
                  Competitive Angle
                </label>
                <textarea
                  id="competitive_angle"
                  name="competitive_angle"
                  rows={2}
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600"
                  placeholder="How we position against competitors..."
                />
              </div>
            </div>
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
              {loading ? 'Creating...' : 'Create Product'}
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
