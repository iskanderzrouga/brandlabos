'use client'

import { useState, useEffect } from 'react'
import { useAppContext } from '@/components/app-shell'

interface Pitch {
  id: string
  name: string
  content: string
  is_active: boolean
  created_at: string
}

export default function PitchesPage() {
  const { selectedProduct } = useAppContext()
  const [pitches, setPitches] = useState<Pitch[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!selectedProduct) {
      setPitches([])
      setLoading(false)
      return
    }

    setLoading(true)
    fetch(`/api/pitches?product_id=${selectedProduct}`)
      .then(r => r.json())
      .then(data => {
        setPitches(Array.isArray(data) ? data : [])
      })
      .catch(() => setPitches([]))
      .finally(() => setLoading(false))
  }, [selectedProduct])

  function resetForm() {
    setName('')
    setContent('')
  }

  function loadPitchIntoForm(pitch: Pitch) {
    setName(pitch.name)
    setContent(pitch.content)
  }

  async function handleCreate() {
    if (!selectedProduct) return
    setSaving(true)

    try {
      const res = await fetch('/api/pitches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          name,
          content,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        setPitches(prev => [data, ...prev])
        setCreating(false)
        resetForm()
      } else {
        console.error('Failed to create pitch:', data)
        alert(`Failed to create pitch: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error creating pitch:', err)
      alert('Failed to create pitch - check console for details')
    }
    setSaving(false)
  }

  async function handleUpdate() {
    if (!editingId) return
    setSaving(true)

    const res = await fetch(`/api/pitches/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    })

    if (res.ok) {
      const updated = await res.json()
      setPitches(prev => prev.map(p => p.id === editingId ? updated : p))
      setEditingId(null)
      resetForm()
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this pitch?')) return
    await fetch(`/api/pitches/${id}`, { method: 'DELETE' })
    setPitches(prev => prev.filter(p => p.id !== id))
  }

  async function handleToggleActive(pitch: Pitch) {
    const res = await fetch(`/api/pitches/${pitch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !pitch.is_active }),
    })

    if (res.ok) {
      const updated = await res.json()
      setPitches(prev => prev.map(p => p.id === pitch.id ? updated : p))
    }
  }

  if (!selectedProduct) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Select a product from the top bar first</p>
      </div>
    )
  }

  const isFormOpen = creating || editingId

  return (
    <div className="p-6 h-full flex flex-col max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Pitches</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create different angles and value propositions for your ads
          </p>
        </div>
        {!isFormOpen && (
          <button
            onClick={() => {
              resetForm()
              setCreating(true)
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium transition-colors"
          >
            + New Pitch
          </button>
        )}
      </div>

      {/* Create/Edit Form */}
      {isFormOpen && (
        <div className="mb-6 p-5 bg-white rounded-xl border border-gray-200 space-y-4">
          <h2 className="font-medium text-gray-900">
            {creating ? 'New Pitch' : 'Edit Pitch'}
          </h2>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Morning Routine Angle"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Pitch Content <span className="text-gray-400">(the angle/hook/value proposition)</span>
            </label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Start your day right with a metabolism boost that works while you work. No jitters, no crash - just steady energy and gradual fat burn throughout the day..."
              rows={6}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={creating ? handleCreate : handleUpdate}
              disabled={saving || !name.trim() || !content.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : creating ? 'Create Pitch' : 'Save Changes'}
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

      {/* Pitches List */}
      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <div className="flex-1 overflow-auto space-y-3">
          {pitches.map(pitch => (
            <div
              key={pitch.id}
              className={`p-4 bg-white rounded-xl border transition-all ${
                !pitch.is_active ? 'opacity-50 border-gray-100' : 'border-gray-200'
              } ${editingId === pitch.id ? 'ring-2 ring-blue-100 border-blue-300' : ''}`}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-medium text-gray-900">{pitch.name}</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleActive(pitch)}
                    className={`text-xs px-2 py-1 rounded ${
                      pitch.is_active
                        ? 'text-green-600 hover:bg-green-50'
                        : 'text-gray-400 hover:bg-gray-100'
                    }`}
                  >
                    {pitch.is_active ? 'Active' : 'Inactive'}
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(pitch.id)
                      setCreating(false)
                      loadPitchIntoForm(pitch)
                    }}
                    className="text-sm text-blue-500 hover:text-blue-600"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(pitch.id)}
                    className="text-sm text-red-500 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{pitch.content}</p>
            </div>
          ))}

          {pitches.length === 0 && !creating && (
            <div className="text-center py-12">
              <p className="text-gray-400 mb-2">No pitches yet</p>
              <p className="text-sm text-gray-400">
                Create pitches to define different angles for your ad copy
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
