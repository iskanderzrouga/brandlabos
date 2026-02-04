'use client'

import { useState, useEffect } from 'react'
import { useAppContext } from '@/components/app-shell'

interface Brand {
  id: string
  name: string
  slug: string
  voice_guidelines: string | null
}

export default function BrandsPage() {
  const { selectedOrg, setSelectedBrand } = useAppContext()
  const [brands, setBrands] = useState<Brand[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [voice, setVoice] = useState('')

  useEffect(() => {
    if (!selectedOrg) return
    fetch(`/api/brands?organization_id=${selectedOrg}`)
      .then(r => r.json())
      .then(setBrands)
  }, [selectedOrg])

  async function handleCreate() {
    if (!selectedOrg) return
    const res = await fetch('/api/brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: selectedOrg,
        name,
        slug,
        voice_guidelines: voice || null,
      }),
    })

    if (res.ok) {
      const newBrand = await res.json()
      setBrands(prev => [newBrand, ...prev])
      setCreating(false)
      setName('')
      setSlug('')
      setVoice('')
      setSelectedBrand(newBrand.id)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this brand and all its products/avatars?')) return
    await fetch(`/api/brands/${id}`, { method: 'DELETE' })
    setBrands(prev => prev.filter(b => b.id !== id))
  }

  if (!selectedOrg) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Select an organization first</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Brands</h1>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium transition-colors"
        >
          + New
        </button>
      </div>

      {creating && (
        <div className="mb-6 p-4 bg-white rounded-xl border border-gray-200 space-y-4">
          <input
            type="text"
            value={name}
            onChange={e => {
              setName(e.target.value)
              setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
            }}
            placeholder="Brand name"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder="slug"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <textarea
            value={voice}
            onChange={e => setVoice(e.target.value)}
            placeholder="Voice guidelines (optional)"
            rows={3}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
              Create
            </button>
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-gray-600 hover:text-gray-900">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {brands.map(brand => (
          <div
            key={brand.id}
            className="p-4 bg-white rounded-xl border border-gray-200"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{brand.name}</h3>
                <p className="text-sm text-gray-500">/{brand.slug}</p>
              </div>
              <button
                onClick={() => handleDelete(brand.id)}
                className="text-sm text-red-500 hover:text-red-600"
              >
                Delete
              </button>
            </div>
            {brand.voice_guidelines && (
              <p className="text-sm text-gray-500 mt-2 line-clamp-2">{brand.voice_guidelines}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
