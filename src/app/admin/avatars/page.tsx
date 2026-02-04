'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Avatar {
  id: string
  product_id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  products?: {
    name: string
    slug: string
    brand_id: string
  }
}

export default function AvatarsPage() {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/avatars')
      .then((res) => res.json())
      .then(setAvatars)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <Link href="/admin" className="text-zinc-500 hover:text-zinc-300 text-sm mb-4 block">
          ← Back to Admin
        </Link>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Avatars</h1>
          <Link
            href="/admin/avatars/new"
            className="px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200"
          >
            + New Avatar
          </Link>
        </div>

        {avatars.length === 0 ? (
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
            <p className="text-zinc-400 mb-4">No avatars yet</p>
            <Link
              href="/admin/avatars/new"
              className="text-zinc-300 hover:underline"
            >
              Create your first avatar
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {avatars.map((avatar) => (
              <Link
                key={avatar.id}
                href={`/admin/avatars/${avatar.id}`}
                className="block bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{avatar.name}</h3>
                    {avatar.description && (
                      <p className="text-zinc-400 text-sm mt-1">{avatar.description}</p>
                    )}
                    {avatar.products && (
                      <p className="text-zinc-500 text-sm mt-2">
                        Product: {avatar.products.name}
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      avatar.is_active
                        ? 'bg-green-900/30 text-green-400'
                        : 'bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {avatar.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
