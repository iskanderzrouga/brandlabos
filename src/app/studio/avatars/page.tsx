'use client'

import { useState, useEffect } from 'react'
import { useAppContext } from '@/components/app-shell'
import Link from 'next/link'

interface Avatar {
  id: string
  name: string
  content: string
  is_active: boolean
}

export default function AvatarsPage() {
  const { selectedProduct } = useAppContext()
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!selectedProduct) {
      setAvatars([])
      setLoading(false)
      return
    }

    setLoading(true)
    fetch(`/api/avatars?product_id=${selectedProduct}`)
      .then(r => r.json())
      .then(setAvatars)
      .finally(() => setLoading(false))
  }, [selectedProduct])

  async function toggleActive(id: string, currentState: boolean) {
    await fetch(`/api/avatars/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !currentState }),
    })
    setAvatars(prev => prev.map(a => a.id === id ? { ...a, is_active: !currentState } : a))
  }

  async function deleteAvatar(id: string) {
    if (!confirm('Delete this avatar?')) return
    await fetch(`/api/avatars/${id}`, { method: 'DELETE' })
    setAvatars(prev => prev.filter(a => a.id !== id))
  }

  function getPreview(content: string | undefined): string {
    if (!content) return 'No content'
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('['))
    return lines.slice(0, 2).join(' ').substring(0, 100) || 'No preview'
  }

  if (!selectedProduct) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Select a product from the top bar to see avatars</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Avatars</h1>
        <Link
          href="/studio/avatars/new"
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium transition-colors"
        >
          + New Avatar
        </Link>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : avatars.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500 mb-4">No avatars for this product</p>
          <Link href="/studio/avatars/new" className="text-blue-500 hover:underline">
            Create your first avatar
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {avatars.map(avatar => (
            <div
              key={avatar.id}
              className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-medium text-gray-900">{avatar.name}</h3>
                <button
                  onClick={() => toggleActive(avatar.id, avatar.is_active)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    avatar.is_active
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {avatar.is_active ? 'Active' : 'Inactive'}
                </button>
              </div>

              <p className="text-sm text-gray-500 mb-4 line-clamp-2">
                {getPreview(avatar.content)}
              </p>

              <div className="flex gap-2">
                <Link
                  href={`/studio/avatars/${avatar.id}`}
                  className="flex-1 text-center py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm transition-colors"
                >
                  Edit
                </Link>
                <button
                  onClick={() => deleteAvatar(avatar.id)}
                  className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
