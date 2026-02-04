'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface PromptBlock {
  id: string
  name: string
  type: string
  scope: string
  scope_id: string | null
  content: string
  version: number
  is_active: boolean
  created_at: string
}

export default function PromptBlocksPage() {
  const [blocks, setBlocks] = useState<PromptBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    const params = new URLSearchParams()
    if (filter !== 'all') {
      params.set('type', filter)
    }
    params.set('active_only', 'true')

    fetch(`/api/prompt-blocks?${params}`)
      .then((res) => res.json())
      .then(setBlocks)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filter])

  const types = [
    { value: 'all', label: 'All Types' },
    { value: 'global_rules', label: 'Global Rules' },
    { value: 'brand_voice', label: 'Brand Voice' },
    { value: 'product_context', label: 'Product Context' },
    { value: 'avatar_context', label: 'Avatar Context' },
    { value: 'feature_template', label: 'Feature Template' },
    { value: 'output_format', label: 'Output Format' },
    { value: 'custom', label: 'Custom' },
  ]

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <Link href="/admin" className="text-zinc-500 hover:text-zinc-300 text-sm mb-4 block">
          ← Back to Admin
        </Link>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Prompt Blocks</h1>
          <Link
            href="/admin/prompt-blocks/new"
            className="px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200"
          >
            + New Block
          </Link>
        </div>

        <div className="mb-6">
          <div className="flex gap-2 flex-wrap">
            {types.map((type) => (
              <button
                key={type.value}
                onClick={() => setFilter(type.value)}
                className={`px-3 py-1 rounded-lg text-sm ${
                  filter === type.value
                    ? 'bg-white text-black'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-zinc-400">Loading...</p>
        ) : blocks.length === 0 ? (
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
            <p className="text-zinc-400 mb-4">No prompt blocks yet</p>
            <Link href="/admin/prompt-blocks/new" className="text-zinc-300 hover:underline">
              Create your first prompt block
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {blocks.map((block) => (
              <div
                key={block.id}
                className="bg-zinc-900 rounded-lg border border-zinc-800 p-4"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold">{block.name}</h3>
                    <div className="flex gap-2 mt-1">
                      <span className="px-2 py-0.5 bg-zinc-800 rounded text-xs">
                        {block.type}
                      </span>
                      <span className="px-2 py-0.5 bg-zinc-800 rounded text-xs">
                        {block.scope}
                      </span>
                      <span className="px-2 py-0.5 bg-zinc-800 rounded text-xs">
                        v{block.version}
                      </span>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs ${
                    block.is_active ? 'bg-green-900/30 text-green-400' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {block.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <pre className="mt-3 p-3 bg-zinc-800 rounded text-xs text-zinc-400 overflow-x-auto max-h-32">
                  {block.content.slice(0, 300)}{block.content.length > 300 ? '...' : ''}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
