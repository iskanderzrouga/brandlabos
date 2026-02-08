'use client'

import { useState, useEffect } from 'react'
import { useAppContext } from '@/components/app-shell'
import { PRODUCT_TEMPLATE } from '@/lib/product-template'

interface Product {
  id: string
  name: string
  slug: string
  content: string
}

export default function ProductsPage() {
  const { selectedBrand, setSelectedProduct, refreshProducts } = useAppContext()
  const [products, setProducts] = useState<Product[]>([])
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [content, setContent] = useState(PRODUCT_TEMPLATE)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!selectedBrand) return
    fetch(`/api/products?brand_id=${selectedBrand}`)
      .then(r => r.json())
      .then(setProducts)
  }, [selectedBrand])

  function resetForm() {
    setName('')
    setSlug('')
    setContent(PRODUCT_TEMPLATE)
  }

  function loadProductIntoForm(product: Product) {
    setName(product.name)
    setSlug(product.slug)
    setContent(product.content || PRODUCT_TEMPLATE)
  }

  async function handleCreate() {
    if (!selectedBrand) return
    setSaving(true)

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_id: selectedBrand,
          name,
          slug,
          content,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        setProducts(prev => [data, ...prev])
        setCreating(false)
        resetForm()
        setSelectedProduct(data.id)
        refreshProducts()
      } else {
        console.error('Failed to create product:', data)
        alert(`Failed to create product: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error creating product:', err)
      alert('Failed to create product - check console for details')
    }
    setSaving(false)
  }

  async function handleUpdate() {
    if (!editingId) return
    setSaving(true)

    const res = await fetch(`/api/products/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        slug,
        content,
      }),
    })

    if (res.ok) {
      const updated = await res.json()
      setProducts(prev => prev.map(p => p.id === editingId ? updated : p))
      setEditingId(null)
      resetForm()
      refreshProducts()
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this product and all its avatars/pitches?')) return
    await fetch(`/api/products/${id}`, { method: 'DELETE' })
    setProducts(prev => prev.filter(p => p.id !== id))
    refreshProducts()
  }

  if (!selectedBrand) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Select a brand first</p>
      </div>
    )
  }

  const isFormOpen = creating || editingId

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-1">Define your products with all their context</p>
        </div>
        {!isFormOpen && (
          <button
            onClick={() => {
              resetForm()
              setCreating(true)
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium transition-colors"
          >
            + New Product
          </button>
        )}
      </div>

      {/* Create/Edit Form */}
      {isFormOpen && (
        <div className="mb-6 p-5 bg-white rounded-xl border border-gray-200 space-y-4">
          <h2 className="font-medium text-gray-900">
            {creating ? 'New Product' : 'Edit Product'}
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Product Name</label>
              <input
                type="text"
                value={name}
                onChange={e => {
                  setName(e.target.value)
                  if (creating) {
                    setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
                  }
                }}
                placeholder="e.g., Fat Burner Pro"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Slug</label>
              <input
                type="text"
                value={slug}
                onChange={e => setSlug(e.target.value)}
                placeholder="fat-burner-pro"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Product Context</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full h-[500px] px-3 py-2 border border-gray-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Fill in the product template..."
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={creating ? handleCreate : handleUpdate}
              disabled={saving || !name.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : creating ? 'Create Product' : 'Save Changes'}
            </button>
            <button
              onClick={() => {
                setCreating(false)
                setEditingId(null)
                resetForm()
              }}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Product List */}
      <div className="space-y-3">
        {products.map(product => (
          <div
            key={product.id}
            className={`p-4 bg-white rounded-xl border transition-colors ${
              editingId === product.id ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-medium text-gray-900">{product.name}</h3>
                <p className="text-sm text-gray-500">/{product.slug}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditingId(product.id)
                    setCreating(false)
                    loadProductIntoForm(product)
                  }}
                  className="text-sm text-blue-500 hover:text-blue-600"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(product.id)}
                  className="text-sm text-red-500 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Show content preview */}
            {product.content && (
              <p className="mt-3 text-sm text-gray-600 line-clamp-3 whitespace-pre-wrap">
                {product.content.slice(0, 200)}...
              </p>
            )}
          </div>
        ))}

        {products.length === 0 && !creating && (
          <p className="text-gray-400 text-center py-8">No products yet. Create one to get started.</p>
        )}
      </div>
    </div>
  )
}
