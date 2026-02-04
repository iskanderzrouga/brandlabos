'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAppContext } from '@/components/app-shell'
import { AVATAR_TEMPLATE } from '@/lib/avatar-template'

export default function NewAvatarPage() {
  const router = useRouter()
  const { selectedProduct } = useAppContext()
  const [name, setName] = useState('')
  const [content, setContent] = useState(AVATAR_TEMPLATE)
  const [saving, setSaving] = useState(false)
  const [generatingName, setGeneratingName] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!selectedProduct) {
      setError('Select a product first')
      return
    }

    setSaving(true)
    setError('')

    try {
      let finalName = name.trim()

      // If no name provided, generate one using AI
      if (!finalName) {
        setGeneratingName(true)
        const nameRes = await fetch('/api/generate-avatar-name', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            product_id: selectedProduct,
          }),
        })
        const nameData = await nameRes.json()
        finalName = nameData.name || 'unnamed-avatar'
        setGeneratingName(false)
      }

      const res = await fetch('/api/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          name: finalName,
          content,
        }),
      })

      if (res.ok) {
        router.push('/studio/avatars')
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to create avatar')
      }
    } catch (err) {
      setError('Failed to create avatar')
    }

    setSaving(false)
    setGeneratingName(false)
  }

  if (!selectedProduct) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Select a product from the top bar first</p>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">New Avatar</h1>
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
              : 'Save Avatar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm text-gray-600 mb-1">
          Name <span className="text-gray-400">(optional - will auto-generate if empty)</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g., frustrated-dieter-first-timer"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <p className="text-gray-500 text-sm mb-2">
        Fill in the template below. Replace the [bracketed placeholders] with your avatar details.
      </p>

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
