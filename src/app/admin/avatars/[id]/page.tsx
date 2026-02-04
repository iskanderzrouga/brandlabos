'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Avatar {
  id: string
  product_id: string
  name: string
  description: string | null
  data: AvatarData
  is_active: boolean
  created_at: string
  updated_at: string
  products?: {
    name: string
    slug: string
  }
}

interface AvatarData {
  identity?: {
    age_range?: string
    gender?: string
    occupation?: string
    lifestyle?: string
  }
  jtbd?: {
    main_job: string
    situation_trigger?: string
    desired_outcome?: string
  }
  four_forces?: {
    push_forces: string[]
    pull_forces: string[]
    anxieties: string[]
    habits_inertia: string[]
  }
  awareness?: {
    level: number
    level_label: string
    past_solutions_tried?: string[]
  }
  sophistication?: {
    level: number
    level_label: string
    proof_requirements?: string[]
  }
  psychology?: {
    pains: string[]
    desires: string[]
    objections?: string[]
    trust_triggers?: string[]
  }
  notes?: string
}

export default function AvatarDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [avatar, setAvatar] = useState<Avatar | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/avatars/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error('Avatar not found')
        return res.json()
      })
      .then(setAvatar)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  async function handleDelete() {
    if (!confirm('Delete this avatar?')) return
    try {
      await fetch(`/api/avatars/${id}`, { method: 'DELETE' })
      router.push('/admin/avatars')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  async function toggleActive() {
    if (!avatar) return
    try {
      const res = await fetch(`/api/avatars/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !avatar.is_active }),
      })
      if (res.ok) {
        setAvatar({ ...avatar, is_active: !avatar.is_active })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    )
  }

  if (error || !avatar) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || 'Avatar not found'}</p>
          <Link href="/admin/avatars" className="text-zinc-400 hover:text-zinc-200">
            ← Back to Avatars
          </Link>
        </div>
      </div>
    )
  }

  const { data } = avatar

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <Link href="/admin/avatars" className="text-zinc-500 hover:text-zinc-300 text-sm mb-4 block">
          ← Back to Avatars
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">{avatar.name}</h1>
            {avatar.description && (
              <p className="text-zinc-400 mt-1">{avatar.description}</p>
            )}
            {avatar.products && (
              <p className="text-zinc-500 text-sm mt-2">Product: {avatar.products.name}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleActive}
              className={`px-3 py-1 rounded text-sm ${
                avatar.is_active
                  ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {avatar.is_active ? 'Active' : 'Inactive'}
            </button>
            <button
              onClick={handleDelete}
              className="px-3 py-1 bg-red-900/20 text-red-400 border border-red-800 rounded text-sm hover:bg-red-900/40"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Identity */}
          {data.identity && Object.keys(data.identity).length > 0 && (
            <Section title="Identity">
              <DataList items={[
                { label: 'Age Range', value: data.identity.age_range },
                { label: 'Gender', value: data.identity.gender },
                { label: 'Occupation', value: data.identity.occupation },
                { label: 'Lifestyle', value: data.identity.lifestyle },
              ]} />
            </Section>
          )}

          {/* JTBD */}
          {data.jtbd && (
            <Section title="Jobs To Be Done">
              <div className="space-y-3">
                <div>
                  <span className="text-zinc-500 text-sm">Main Job</span>
                  <p className="text-zinc-200">{data.jtbd.main_job}</p>
                </div>
                {data.jtbd.situation_trigger && (
                  <div>
                    <span className="text-zinc-500 text-sm">Trigger</span>
                    <p className="text-zinc-300">{data.jtbd.situation_trigger}</p>
                  </div>
                )}
                {data.jtbd.desired_outcome && (
                  <div>
                    <span className="text-zinc-500 text-sm">Desired Outcome</span>
                    <p className="text-zinc-300">{data.jtbd.desired_outcome}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Four Forces */}
          {data.four_forces && (
            <Section title="Four Forces" className="md:col-span-2">
              <div className="grid md:grid-cols-2 gap-4">
                <ForceList label="Push Forces" items={data.four_forces.push_forces} color="red" />
                <ForceList label="Pull Forces" items={data.four_forces.pull_forces} color="green" />
                <ForceList label="Anxieties" items={data.four_forces.anxieties} color="yellow" />
                <ForceList label="Habits / Inertia" items={data.four_forces.habits_inertia} color="gray" />
              </div>
            </Section>
          )}

          {/* Awareness */}
          {data.awareness && (
            <Section title="Awareness">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl font-bold">{data.awareness.level}/5</span>
                <span className="text-zinc-400">{data.awareness.level_label}</span>
              </div>
              {data.awareness.past_solutions_tried && data.awareness.past_solutions_tried.length > 0 && (
                <div>
                  <span className="text-zinc-500 text-sm">Past Solutions Tried</span>
                  <ul className="mt-1 space-y-1">
                    {data.awareness.past_solutions_tried.map((s, i) => (
                      <li key={i} className="text-zinc-300 text-sm">• {s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}

          {/* Sophistication */}
          {data.sophistication && (
            <Section title="Sophistication">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl font-bold">{data.sophistication.level}/5</span>
                <span className="text-zinc-400">{data.sophistication.level_label}</span>
              </div>
              {data.sophistication.proof_requirements && data.sophistication.proof_requirements.length > 0 && (
                <div>
                  <span className="text-zinc-500 text-sm">Proof Requirements</span>
                  <ul className="mt-1 space-y-1">
                    {data.sophistication.proof_requirements.map((p, i) => (
                      <li key={i} className="text-zinc-300 text-sm">• {p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}

          {/* Psychology */}
          {data.psychology && (
            <Section title="Psychology" className="md:col-span-2">
              <div className="grid md:grid-cols-2 gap-4">
                <ForceList label="Pains" items={data.psychology.pains} color="red" />
                <ForceList label="Desires" items={data.psychology.desires} color="green" />
                {data.psychology.objections && (
                  <ForceList label="Objections" items={data.psychology.objections} color="yellow" />
                )}
                {data.psychology.trust_triggers && (
                  <ForceList label="Trust Triggers" items={data.psychology.trust_triggers} color="blue" />
                )}
              </div>
            </Section>
          )}

          {/* Notes */}
          {data.notes && (
            <Section title="Notes" className="md:col-span-2">
              <p className="text-zinc-300 whitespace-pre-wrap">{data.notes}</p>
            </Section>
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-zinc-800 text-sm text-zinc-500">
          <p>Created: {new Date(avatar.created_at).toLocaleString()}</p>
          <p>Updated: {new Date(avatar.updated_at).toLocaleString()}</p>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 rounded-lg border border-zinc-800 p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-4">{title}</h3>
      {children}
    </div>
  )
}

function DataList({ items }: { items: { label: string; value?: string }[] }) {
  const filtered = items.filter((i) => i.value)
  if (filtered.length === 0) return <p className="text-zinc-500">No data</p>
  return (
    <dl className="space-y-2">
      {filtered.map((item, i) => (
        <div key={i}>
          <dt className="text-zinc-500 text-sm">{item.label}</dt>
          <dd className="text-zinc-200">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ForceList({ label, items, color }: { label: string; items?: string[]; color: string }) {
  if (!items || items.length === 0) return null
  const colorClasses: Record<string, string> = {
    red: 'border-red-900/50 bg-red-900/10',
    green: 'border-green-900/50 bg-green-900/10',
    yellow: 'border-yellow-900/50 bg-yellow-900/10',
    blue: 'border-blue-900/50 bg-blue-900/10',
    gray: 'border-zinc-700 bg-zinc-800/50',
  }
  return (
    <div className={`p-3 rounded border ${colorClasses[color] || colorClasses.gray}`}>
      <span className="text-zinc-400 text-sm font-medium">{label}</span>
      <ul className="mt-2 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-zinc-300 text-sm">• {item}</li>
        ))}
      </ul>
    </div>
  )
}
