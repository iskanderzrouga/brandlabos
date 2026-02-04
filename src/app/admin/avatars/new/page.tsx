'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Product {
  id: string
  name: string
  slug: string
}

const AWARENESS_LEVELS = [
  { value: 1, label: 'unaware', description: 'Doesn\'t know they have a problem' },
  { value: 2, label: 'problem_aware', description: 'Knows the problem, not solutions' },
  { value: 3, label: 'solution_aware', description: 'Knows solutions exist' },
  { value: 4, label: 'product_aware', description: 'Knows your product' },
  { value: 5, label: 'most_aware', description: 'Ready to buy, needs final push' },
]

const SOPHISTICATION_LEVELS = [
  { value: 1, label: 'first_timer', description: 'Never tried anything before' },
  { value: 2, label: 'some_exposure', description: 'Tried 1-2 things' },
  { value: 3, label: 'experienced', description: 'Has tried multiple solutions' },
  { value: 4, label: 'jaded', description: 'Skeptical, seen it all' },
  { value: 5, label: 'expert', description: 'Deeply knowledgeable, very skeptical' },
]

export default function NewAvatar() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then(setProducts)
      .catch(console.error)
  }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)

    // Parse comma-separated fields into arrays
    const parseList = (key: string) => {
      const val = formData.get(key) as string
      return val ? val.split('\n').map((s) => s.trim()).filter(Boolean) : []
    }

    const awarenessLevel = parseInt(formData.get('awareness_level') as string) as 1|2|3|4|5
    const sophisticationLevel = parseInt(formData.get('sophistication_level') as string) as 1|2|3|4|5

    const data = {
      product_id: formData.get('product_id') as string,
      name: formData.get('name') as string,
      description: formData.get('description') as string || null,
      data: {
        identity: {
          age_range: formData.get('age_range') as string || undefined,
          gender: formData.get('gender') as string || undefined,
          occupation: formData.get('occupation') as string || undefined,
          lifestyle: formData.get('lifestyle') as string || undefined,
        },
        jtbd: {
          main_job: formData.get('main_job') as string,
          situation_trigger: formData.get('situation_trigger') as string || undefined,
          desired_outcome: formData.get('desired_outcome') as string || undefined,
        },
        four_forces: {
          push_forces: parseList('push_forces'),
          pull_forces: parseList('pull_forces'),
          anxieties: parseList('anxieties'),
          habits_inertia: parseList('habits_inertia'),
        },
        awareness: {
          level: awarenessLevel,
          level_label: AWARENESS_LEVELS.find(l => l.value === awarenessLevel)?.label as 'unaware' | 'problem_aware' | 'solution_aware' | 'product_aware' | 'most_aware',
          past_solutions_tried: parseList('past_solutions_tried'),
        },
        sophistication: {
          level: sophisticationLevel,
          level_label: SOPHISTICATION_LEVELS.find(l => l.value === sophisticationLevel)?.label as 'first_timer' | 'some_exposure' | 'experienced' | 'jaded' | 'expert',
          proof_requirements: parseList('proof_requirements'),
        },
        psychology: {
          pains: parseList('pains'),
          desires: parseList('desires'),
          objections: parseList('objections'),
          trust_triggers: parseList('trust_triggers'),
        },
        notes: formData.get('notes') as string || undefined,
      },
    }

    try {
      const res = await fetch('/api/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || JSON.stringify(err.details) || 'Failed to create avatar')
      }

      router.push('/admin/avatars')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Link href="/admin/avatars" className="text-zinc-500 hover:text-zinc-300 text-sm mb-4 block">
          ← Back to Avatars
        </Link>

        <h1 className="text-2xl font-bold mb-6">New Avatar</h1>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Info */}
          <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <h2 className="text-lg font-semibold mb-4">Basic Info</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="product_id" className="block text-sm font-medium mb-2">
                  Product *
                </label>
                <select
                  id="product_id"
                  name="product_id"
                  required
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
                >
                  <option value="">Select product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium mb-2">
                    Avatar Name *
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    required
                    className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
                    placeholder="The Frustrated Dieter"
                  />
                </div>
                <div>
                  <label htmlFor="description" className="block text-sm font-medium mb-2">
                    Short Description
                  </label>
                  <input
                    type="text"
                    id="description"
                    name="description"
                    className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
                    placeholder="40s woman who's tried everything"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Identity */}
          <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <h2 className="text-lg font-semibold mb-4">Identity</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="age_range" className="block text-sm font-medium mb-2">Age Range</label>
                <input type="text" id="age_range" name="age_range" className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg" placeholder="35-45" />
              </div>
              <div>
                <label htmlFor="gender" className="block text-sm font-medium mb-2">Gender</label>
                <input type="text" id="gender" name="gender" className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg" placeholder="Female" />
              </div>
              <div>
                <label htmlFor="occupation" className="block text-sm font-medium mb-2">Occupation</label>
                <input type="text" id="occupation" name="occupation" className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg" placeholder="Office Manager" />
              </div>
              <div>
                <label htmlFor="lifestyle" className="block text-sm font-medium mb-2">Lifestyle</label>
                <input type="text" id="lifestyle" name="lifestyle" className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg" placeholder="Busy professional, health-conscious" />
              </div>
            </div>
          </section>

          {/* JTBD */}
          <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <h2 className="text-lg font-semibold mb-4">Jobs To Be Done</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="main_job" className="block text-sm font-medium mb-2">Main Job *</label>
                <textarea
                  id="main_job"
                  name="main_job"
                  required
                  rows={2}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
                  placeholder="What is the core outcome they're trying to achieve?"
                />
              </div>
              <div>
                <label htmlFor="situation_trigger" className="block text-sm font-medium mb-2">Situation Trigger</label>
                <textarea
                  id="situation_trigger"
                  name="situation_trigger"
                  rows={2}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
                  placeholder="What situation or moment triggers this need?"
                />
              </div>
              <div>
                <label htmlFor="desired_outcome" className="block text-sm font-medium mb-2">Desired Outcome</label>
                <textarea
                  id="desired_outcome"
                  name="desired_outcome"
                  rows={2}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
                  placeholder="What does success look like for them?"
                />
              </div>
            </div>
          </section>

          {/* Four Forces */}
          <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <h2 className="text-lg font-semibold mb-4">Four Forces (Bob Moesta)</h2>
            <p className="text-zinc-400 text-sm mb-4">One item per line</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="push_forces" className="block text-sm font-medium mb-2">Push Forces *</label>
                <textarea
                  id="push_forces"
                  name="push_forces"
                  required
                  rows={3}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
                  placeholder="Problems pushing them away from status quo&#10;Frustrations with current state&#10;Pain points"
                />
              </div>
              <div>
                <label htmlFor="pull_forces" className="block text-sm font-medium mb-2">Pull Forces *</label>
                <textarea
                  id="pull_forces"
                  name="pull_forces"
                  required
                  rows={3}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
                  placeholder="Benefits attracting them&#10;Aspirations&#10;What they imagine could be"
                />
              </div>
              <div>
                <label htmlFor="anxieties" className="block text-sm font-medium mb-2">Anxieties</label>
                <textarea
                  id="anxieties"
                  name="anxieties"
                  rows={3}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
                  placeholder="Fears about making a change&#10;What if it doesn't work?&#10;Risk concerns"
                />
              </div>
              <div>
                <label htmlFor="habits_inertia" className="block text-sm font-medium mb-2">Habits / Inertia</label>
                <textarea
                  id="habits_inertia"
                  name="habits_inertia"
                  rows={3}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
                  placeholder="What keeps them in their current state&#10;Comfort zones&#10;'Good enough' rationalizations"
                />
              </div>
            </div>
          </section>

          {/* Awareness & Sophistication */}
          <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <h2 className="text-lg font-semibold mb-4">Awareness & Sophistication</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label htmlFor="awareness_level" className="block text-sm font-medium mb-2">Awareness Level *</label>
                <select
                  id="awareness_level"
                  name="awareness_level"
                  required
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
                >
                  {AWARENESS_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.value} - {level.label}: {level.description}
                    </option>
                  ))}
                </select>
                <div className="mt-3">
                  <label htmlFor="past_solutions_tried" className="block text-sm font-medium mb-2">Past Solutions Tried</label>
                  <textarea
                    id="past_solutions_tried"
                    name="past_solutions_tried"
                    rows={2}
                    className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
                    placeholder="Diets&#10;Gym memberships&#10;Supplements"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="sophistication_level" className="block text-sm font-medium mb-2">Sophistication Level *</label>
                <select
                  id="sophistication_level"
                  name="sophistication_level"
                  required
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
                >
                  {SOPHISTICATION_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.value} - {level.label}: {level.description}
                    </option>
                  ))}
                </select>
                <div className="mt-3">
                  <label htmlFor="proof_requirements" className="block text-sm font-medium mb-2">Proof Requirements</label>
                  <textarea
                    id="proof_requirements"
                    name="proof_requirements"
                    rows={2}
                    className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
                    placeholder="Clinical studies&#10;Real testimonials&#10;Money-back guarantee"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Psychology */}
          <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <h2 className="text-lg font-semibold mb-4">Psychology</h2>
            <p className="text-zinc-400 text-sm mb-4">One item per line</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="pains" className="block text-sm font-medium mb-2">Pains *</label>
                <textarea
                  id="pains"
                  name="pains"
                  required
                  rows={3}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
                  placeholder="Emotional pains&#10;Physical pains&#10;Social pains"
                />
              </div>
              <div>
                <label htmlFor="desires" className="block text-sm font-medium mb-2">Desires *</label>
                <textarea
                  id="desires"
                  name="desires"
                  required
                  rows={3}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
                  placeholder="What they truly want&#10;Deep aspirations&#10;Dreams"
                />
              </div>
              <div>
                <label htmlFor="objections" className="block text-sm font-medium mb-2">Common Objections</label>
                <textarea
                  id="objections"
                  name="objections"
                  rows={3}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
                  placeholder="It's too expensive&#10;I don't have time&#10;It probably won't work for me"
                />
              </div>
              <div>
                <label htmlFor="trust_triggers" className="block text-sm font-medium mb-2">Trust Triggers</label>
                <textarea
                  id="trust_triggers"
                  name="trust_triggers"
                  rows={3}
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
                  placeholder="What makes them trust&#10;Social proof types&#10;Credentials that matter"
                />
              </div>
            </div>
          </section>

          {/* Notes */}
          <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <h2 className="text-lg font-semibold mb-4">Notes</h2>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg"
              placeholder="Any additional notes about this avatar..."
            />
          </section>

          {error && (
            <div className="p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Avatar'}
            </button>
            <Link href="/admin/avatars" className="px-6 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
