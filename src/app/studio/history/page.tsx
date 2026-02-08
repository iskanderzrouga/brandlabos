'use client'

import { useState, useEffect } from 'react'
import { useAppContext } from '@/components/app-shell'

interface GenerationRun {
  id: string
  product_id: string
  feature_type: string
  status: string
  config: {
    avatar_ids: string[]
    content_type?: string
    num_concepts?: number
    user_instructions?: string
  }
  raw_response?: {
    concepts?: Array<{
      concept_name: string
      headline?: string
      body?: string
      cta?: string
      hook?: string
      copy_variants?: Array<{
        hook?: string
        body?: string
        cta?: string
      }>
    }>
  }
  created_at: string
  completed_at: string | null
}

export default function HistoryPage() {
  const { selectedProduct } = useAppContext()
  const [runs, setRuns] = useState<GenerationRun[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedProduct) {
      setRuns([])
      setLoading(false)
      return
    }

    setLoading(true)
    fetch(`/api/generation-runs?product_id=${selectedProduct}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setRuns(data)
        } else {
          setRuns([])
        }
      })
      .catch(() => {
        setRuns([])
      })
      .finally(() => setLoading(false))
  }, [selectedProduct])

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    running: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }

  // Map database enum values to display labels
  const contentTypeLabels: Record<string, string> = {
    // Database enum values
    static_organic_ads: 'Static Ads',
    scripts: 'UGC Scripts',
    landing_pages: 'Landing Page',
    email_sequences: 'Email',
    social_posts: 'Social',
    // Frontend values (in case they slip through)
    organic_static: 'Static Ads',
    ugc_video_scripts: 'UGC Scripts',
    landing_page_copy: 'Landing Page',
    advertorial_copy: 'Advertorial',
  }

  if (!selectedProduct) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Select a product from the top bar to view history</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Generation History</h1>
        <p className="text-sm text-gray-500 mt-1">View your past generations and their results</p>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : runs.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-gray-500 mb-2">No generation runs yet</p>
          <p className="text-sm text-gray-400">Generate some content to see it here</p>
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map(run => (
            <div
              key={run.id}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden"
            >
              {/* Header */}
              <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
              >
                <div className="flex items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {contentTypeLabels[run.config.content_type || run.feature_type] || run.feature_type.replace(/_/g, ' ')}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[run.status]}`}>
                        {run.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {run.config.avatar_ids?.length || 0} avatar(s)
                      {run.config.num_concepts && ` • ${run.config.num_concepts} concepts`}
                      {run.config.user_instructions && ' • Has instructions'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm text-gray-600">
                      {new Date(run.created_at).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(run.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  <span className="text-gray-400">
                    {expandedRun === run.id ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {/* Expanded Content */}
              {expandedRun === run.id && run.raw_response?.concepts && (
                <div className="border-t border-gray-100 p-4 bg-gray-50">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {run.raw_response.concepts.map((concept, i) => {
                      // Get copy from either direct fields or copy_variants array
                      const firstVariant = concept.copy_variants?.[0]
                      const hook = concept.headline || concept.hook || firstVariant?.hook
                      const body = concept.body || firstVariant?.body
                      const cta = concept.cta || firstVariant?.cta

                      return (
                        <div key={i} className="bg-white p-4 rounded-lg border border-gray-200">
                          <h4 className="font-medium text-gray-900 text-sm mb-3">
                            {concept.concept_name}
                          </h4>
                          {hook && (
                            <div className="mb-2">
                              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Headline</span>
                              <p className="text-sm font-medium text-gray-800">
                                {hook}
                              </p>
                            </div>
                          )}
                          {body && (
                            <div className="mb-2">
                              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Body</span>
                              <p className="text-sm text-gray-600">
                                {body}
                              </p>
                            </div>
                          )}
                          {cta && (
                            <div>
                              <span className="text-[10px] text-gray-400 uppercase tracking-wider">CTA</span>
                              <p className="text-sm text-indigo-600 font-medium">
                                {cta}
                              </p>
                            </div>
                          )}
                          {/* Show additional variants if present */}
                          {concept.copy_variants && concept.copy_variants.length > 1 && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                              <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                                +{concept.copy_variants.length - 1} more variant{concept.copy_variants.length > 2 ? 's' : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {run.config.user_instructions && (
                    <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                      <span className="text-xs text-blue-600 font-medium uppercase">Instructions</span>
                      <p className="text-sm text-blue-800 mt-1">{run.config.user_instructions}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
