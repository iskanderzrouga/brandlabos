'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Organization {
  id: string
  name: string
  slug: string
  created_at: string
}

interface Brand {
  id: string
  organization_id: string
  name: string
  slug: string
}

interface Product {
  id: string
  brand_id: string
  name: string
  slug: string
}

export default function AdminDashboard() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      setLoading(true)
      const [orgsRes, brandsRes, productsRes] = await Promise.all([
        fetch('/api/organizations'),
        fetch('/api/brands'),
        fetch('/api/products'),
      ])

      if (!orgsRes.ok || !brandsRes.ok || !productsRes.ok) {
        throw new Error('Failed to fetch data')
      }

      setOrganizations(await orgsRes.json())
      setBrands(await brandsRes.json())
      setProducts(await productsRes.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">Error: {error}</p>
          <p className="text-zinc-500 text-sm">
            Make sure Supabase is configured in .env.local
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm mb-2 block">
              ← Back to Home
            </Link>
            <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Organizations */}
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Organizations</h2>
              <Link
                href="/admin/organizations/new"
                className="text-sm px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded"
              >
                + New
              </Link>
            </div>
            {organizations.length === 0 ? (
              <p className="text-zinc-500 text-sm">No organizations yet</p>
            ) : (
              <ul className="space-y-2">
                {organizations.map((org) => (
                  <li key={org.id}>
                    <Link
                      href={`/admin/organizations/${org.id}`}
                      className="block p-3 bg-zinc-800/50 rounded hover:bg-zinc-800 transition-colors"
                    >
                      <span className="font-medium">{org.name}</span>
                      <span className="text-zinc-500 text-sm ml-2">/{org.slug}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Brands */}
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Brands</h2>
              <Link
                href="/admin/brands/new"
                className="text-sm px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded"
              >
                + New
              </Link>
            </div>
            {brands.length === 0 ? (
              <p className="text-zinc-500 text-sm">No brands yet</p>
            ) : (
              <ul className="space-y-2">
                {brands.map((brand) => (
                  <li key={brand.id}>
                    <Link
                      href={`/admin/brands/${brand.id}`}
                      className="block p-3 bg-zinc-800/50 rounded hover:bg-zinc-800 transition-colors"
                    >
                      <span className="font-medium">{brand.name}</span>
                      <span className="text-zinc-500 text-sm ml-2">/{brand.slug}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Products */}
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Products</h2>
              <Link
                href="/admin/products/new"
                className="text-sm px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded"
              >
                + New
              </Link>
            </div>
            {products.length === 0 ? (
              <p className="text-zinc-500 text-sm">No products yet</p>
            ) : (
              <ul className="space-y-2">
                {products.map((product) => (
                  <li key={product.id}>
                    <Link
                      href={`/admin/products/${product.id}`}
                      className="block p-3 bg-zinc-800/50 rounded hover:bg-zinc-800 transition-colors"
                    >
                      <span className="font-medium">{product.name}</span>
                      <span className="text-zinc-500 text-sm ml-2">/{product.slug}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Quick Links */}
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/admin/users"
            className="p-4 bg-zinc-900 rounded-lg border border-purple-500/30 hover:border-purple-500/50 transition-colors"
          >
            <h3 className="font-semibold text-purple-400">User Management</h3>
            <p className="text-zinc-500 text-sm">Manage users, roles & access levels</p>
          </Link>
          <Link
            href="/admin/avatars"
            className="p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            <h3 className="font-semibold">Avatars</h3>
            <p className="text-zinc-500 text-sm">Customer personas with JTBD & psychology</p>
          </Link>
          <Link
            href="/admin/prompt-blocks"
            className="p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            <h3 className="font-semibold">Prompt Blocks</h3>
            <p className="text-zinc-500 text-sm">Versioned, scoped prompt components</p>
          </Link>
          <Link
            href="/admin/generation-runs"
            className="p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            <h3 className="font-semibold">Generation Runs</h3>
            <p className="text-zinc-500 text-sm">History of generation requests</p>
          </Link>
          <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
            <h3 className="font-semibold text-zinc-500">API Tester</h3>
            <p className="text-zinc-600 text-sm">Coming soon</p>
          </div>
        </div>
      </div>
    </div>
  )
}
