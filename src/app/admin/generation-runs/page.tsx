'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface GenerationRun {
  id: string
  product_id: string
  feature_type: string
  status: string
  config: {
    avatar_ids: string[]
    user_instructions?: string
  }
  created_at: string
  completed_at: string | null
  products?: {
    name: string
    slug: string
  }
}

export default function GenerationRunsPage() {
  const [runs, setRuns] = useState<GenerationRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/generation-runs')
      .then((res) => res.json())
      .then(setRuns)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-900/30 text-yellow-400',
    running: 'bg-blue-900/30 text-blue-400',
    completed: 'bg-green-900/30 text-green-400',
    failed: 'bg-red-900/30 text-red-400',
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <Link href="/admin" className="text-zinc-500 hover:text-zinc-300 text-sm mb-4 block">
          ← Back to Admin
        </Link>

        <h1 className="text-2xl font-bold mb-6">Generation Runs</h1>

        {loading ? (
          <p className="text-zinc-400">Loading...</p>
        ) : runs.length === 0 ? (
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
            <p className="text-zinc-400 mb-4">No generation runs yet</p>
            <p className="text-zinc-500 text-sm">
              Generation runs are created when you use the ad generator (Phase 2)
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/admin/generation-runs/${run.id}`}
                className="block bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{run.feature_type}</span>
                      {run.products && (
                        <span className="text-zinc-500">• {run.products.name}</span>
                      )}
                    </div>
                    <p className="text-zinc-500 text-sm mt-1">
                      {run.config.avatar_ids.length} avatar(s)
                      {run.config.user_instructions && ' • Has custom instructions'}
                    </p>
                    <p className="text-zinc-600 text-xs mt-1">
                      {new Date(run.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs ${statusColors[run.status] || 'bg-zinc-800'}`}>
                    {run.status}
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
