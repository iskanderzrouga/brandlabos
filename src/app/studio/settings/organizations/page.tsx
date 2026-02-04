'use client'

import { useState, useEffect } from 'react'
import { useAppContext } from '@/components/app-shell'

interface Organization {
  id: string
  name: string
  slug: string
}

export default function OrganizationsPage() {
  const { setSelectedOrg } = useAppContext()
  const [localOrgs, setLocalOrgs] = useState<Organization[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')

  useEffect(() => {
    fetch('/api/organizations')
      .then(r => r.json())
      .then(setLocalOrgs)
  }, [])

  async function handleCreate() {
    const res = await fetch('/api/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug }),
    })

    if (res.ok) {
      const newOrg = await res.json()
      setLocalOrgs(prev => [newOrg, ...prev])
      setCreating(false)
      setName('')
      setSlug('')
      setSelectedOrg(newOrg.id)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this organization and all its brands/products/avatars?')) return
    await fetch(`/api/organizations/${id}`, { method: 'DELETE' })
    setLocalOrgs(prev => prev.filter(o => o.id !== id))
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Organizations</h1>
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
            placeholder="Organization name"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder="slug"
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
        {localOrgs.map(org => (
          <div
            key={org.id}
            className="flex items-center justify-between p-4 bg-white rounded-xl border border-gray-200"
          >
            <div>
              <h3 className="font-medium text-gray-900">{org.name}</h3>
              <p className="text-sm text-gray-500">/{org.slug}</p>
            </div>
            <button
              onClick={() => handleDelete(org.id)}
              className="text-sm text-red-500 hover:text-red-600"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
