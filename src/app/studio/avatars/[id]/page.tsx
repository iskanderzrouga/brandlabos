'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

interface Avatar {
  id: string
  name: string
  content: string
  is_active: boolean
  product_id: string
}

export default function EditAvatarPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [avatar, setAvatar] = useState<Avatar | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [generatingName, setGeneratingName] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/avatars/${id}`)
      .then(r => r.json())
      .then(data => {
        setAvatar(data)
        setName(data.name || '')
        setContent(data.content || '')
      })
      .catch(() => setError('Failed to load avatar'))
      .finally(() => setLoading(false))
  }, [id])

  async function handleGenerateName() {
    if (!avatar) return

    setGeneratingName(true)
    try {
      const res = await fetch('/api/generate-avatar-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          product_id: avatar.product_id,
        }),
      })
      const data = await res.json()
      if (data.name) {
        setName(data.name)
      }
    } catch (err) {
      console.error('Failed to generate name:', err)
    }
    setGeneratingName(false)
  }

  async function handleSave() {
    setSaving(true)
    setError('')

    try {
      let finalName = name.trim()

      // If no name provided, generate one using AI
      if (!finalName && avatar) {
        setGeneratingName(true)
        const nameRes = await fetch('/api/generate-avatar-name', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            product_id: avatar.product_id,
          }),
        })
        const nameData = await nameRes.json()
        finalName = nameData.name || 'unnamed-avatar'
        setGeneratingName(false)
      }

      const res = await fetch(`/api/avatars/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: finalName, content }),
      })

      if (res.ok) {
        router.push('/studio/avatars')
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save')
      }
    } catch (err) {
      setError('Failed to save avatar')
    }

    setSaving(false)
    setGeneratingName(false)
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  if (!avatar) {
    return (
      <div className="p-6">
        <p className="text-red-500">Avatar not found</p>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">Edit Avatar</h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.back()}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {saving
              ? generatingName
                ? 'Generating name...'
                : 'Saving...'
              : 'Save Changes'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm text-gray-600 mb-1">Name</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., frustrated-dieter-first-timer"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleGenerateName}
            disabled={generatingName}
            className="px-3 py-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg disabled:opacity-50"
          >
            {generatingName ? 'Generating...' : 'Auto-generate'}
          </button>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden">
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          className="w-full h-full p-4 font-mono text-sm text-gray-700 resize-none focus:outline-none"
          placeholder="Avatar content..."
        />
      </div>
    </div>
  )
}
