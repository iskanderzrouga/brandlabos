'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Product {
  id: string
  name: string
  slug: string
}

interface Avatar {
  id: string
  name: string
  description: string | null
  product_id: string
  is_active: boolean
}

interface CopyVariant {
  hook: string
  body: string
  cta: string
}

interface ConceptCard {
  concept_name: string
  image_description: string
  image_prompt: string
  copy_variants: CopyVariant[]
}

interface GenerationResult {
  success: boolean
  run_id?: string
  concepts: ConceptCard[]
  metadata: {
    avatarCount: number
    zoomBehavior: 'intersection' | 'deep_dive'
  }
}

export default function GeneratePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [selectedProduct, setSelectedProduct] = useState<string>('')
  const [selectedAvatars, setSelectedAvatars] = useState<string[]>([])
  const [instructions, setInstructions] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)

  // Fetch products on mount
  useEffect(() => {
    fetch('/api/products')
      .then((r) => r.json())
      .then(setProducts)
      .catch(console.error)
  }, [])

  // Fetch avatars when product changes
  useEffect(() => {
    if (!selectedProduct) {
      setAvatars([])
      setSelectedAvatars([])
      return
    }

    fetch(`/api/avatars?product_id=${selectedProduct}&active_only=true`)
      .then((r) => r.json())
      .then((data) => {
        setAvatars(data)
        setSelectedAvatars([])
      })
      .catch(console.error)
  }, [selectedProduct])

  function toggleAvatar(id: string) {
    setSelectedAvatars((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  async function handleGenerate() {
    if (!selectedProduct || selectedAvatars.length === 0) {
      setError('Select a product and at least one avatar')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          avatar_ids: selectedAvatars,
          user_instructions: instructions || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Generation failed')
      }

      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Link href="/admin" className="text-zinc-500 hover:text-zinc-300 text-sm mb-4 block">
          ← Back to Admin
        </Link>

        <h1 className="text-3xl font-bold mb-8">Generate Static Organic Ads</h1>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column: Controls */}
          <div className="space-y-6">
            {/* Product Select */}
            <div>
              <label className="block text-sm font-medium mb-2">Product</label>
              <select
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-lg"
              >
                <option value="">Select a product...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Avatar Multi-Select */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Avatars {selectedAvatars.length > 0 && `(${selectedAvatars.length} selected)`}
              </label>
              {!selectedProduct ? (
                <p className="text-zinc-500 text-sm">Select a product first</p>
              ) : avatars.length === 0 ? (
                <p className="text-zinc-500 text-sm">No avatars for this product</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {avatars.map((avatar) => (
                    <button
                      key={avatar.id}
                      onClick={() => toggleAvatar(avatar.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedAvatars.includes(avatar.id)
                          ? 'bg-white text-black border-white'
                          : 'bg-zinc-900 border-zinc-700 hover:border-zinc-500'
                      }`}
                    >
                      <div className="font-medium">{avatar.name}</div>
                      {avatar.description && (
                        <div className={`text-sm ${selectedAvatars.includes(avatar.id) ? 'text-zinc-600' : 'text-zinc-400'}`}>
                          {avatar.description}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {selectedAvatars.length > 1 && (
                <p className="text-yellow-500 text-sm mt-2">
                  Multiple avatars → Copy will find common ground (broader targeting)
                </p>
              )}
              {selectedAvatars.length === 1 && (
                <p className="text-green-500 text-sm mt-2">
                  Single avatar → Copy will be highly specific (deep targeting)
                </p>
              )}
            </div>

            {/* Instructions */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Custom Instructions (optional)
              </label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg"
                placeholder="e.g., Focus on the morning routine angle, make it feel urgent, target people who've tried keto..."
              />
            </div>

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={loading || !selectedProduct || selectedAvatars.length === 0}
              className="w-full py-4 bg-white text-black font-bold text-xl rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'GENERATING...' : 'GENERATE'}
            </button>

            {error && (
              <div className="p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-400">
                {error}
              </div>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-2">
            {loading && (
              <div className="flex items-center justify-center h-64 bg-zinc-900 rounded-lg border border-zinc-800">
                <div className="text-center">
                  <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
                  <p className="text-zinc-400">Generating concepts with Claude...</p>
                </div>
              </div>
            )}

            {result && result.concepts && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">
                    Generated Concepts ({result.concepts.length})
                  </h2>
                  <span className="text-sm text-zinc-500">
                    Mode: {result.metadata.zoomBehavior === 'deep_dive' ? 'Deep Specificity' : 'Broad Resonance'}
                  </span>
                </div>

                <div className="grid gap-6">
                  {result.concepts.map((concept, i) => (
                    <ConceptCardDisplay key={i} concept={concept} index={i} />
                  ))}
                </div>
              </div>
            )}

            {!loading && !result && (
              <div className="flex items-center justify-center h-64 bg-zinc-900/50 rounded-lg border border-zinc-800 border-dashed">
                <p className="text-zinc-500">Select avatars and click Generate to create ads</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ConceptCardDisplay({ concept, index }: { concept: ConceptCard; index: number }) {
  const [showImagePrompt, setShowImagePrompt] = useState(false)

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-800/50">
        <h3 className="font-bold text-lg">
          Concept {index + 1}: {concept.concept_name}
        </h3>
      </div>

      <div className="p-6 space-y-6">
        {/* Image Description */}
        <div>
          <h4 className="text-sm font-medium text-zinc-400 mb-2">Image Description</h4>
          <p className="text-zinc-200">{concept.image_description}</p>

          <button
            onClick={() => setShowImagePrompt(!showImagePrompt)}
            className="text-sm text-zinc-500 hover:text-zinc-300 mt-2"
          >
            {showImagePrompt ? 'Hide' : 'Show'} Image Prompt
          </button>

          {showImagePrompt && (
            <pre className="mt-2 p-3 bg-zinc-800 rounded text-xs text-zinc-400 overflow-x-auto">
              {concept.image_prompt}
            </pre>
          )}
        </div>

        {/* Copy Variants */}
        <div>
          <h4 className="text-sm font-medium text-zinc-400 mb-3">Copy Variants</h4>
          <div className="space-y-4">
            {concept.copy_variants.map((variant, vi) => (
              <div key={vi} className="p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
                <div className="space-y-2">
                  <div>
                    <span className="text-xs text-zinc-500 uppercase">Hook</span>
                    <p className="text-white font-medium">{variant.hook}</p>
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500 uppercase">Body</span>
                    <p className="text-zinc-300">{variant.body}</p>
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500 uppercase">CTA</span>
                    <p className="text-zinc-400">{variant.cta}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
