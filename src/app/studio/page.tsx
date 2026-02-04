'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAppContext } from '@/components/app-shell'
import { AVATAR_TEMPLATE } from '@/lib/avatar-template'
import { CONTENT_TYPES } from '@/lib/content-types'
import { summarizeAvatars, type AvatarStory } from '@/lib/avatar-summarizer'
import { AvatarStoryCard, AvatarStoryStack } from '@/components/avatars/AvatarStoryCard'
import { ModularPromptEditor } from '@/components/prompts/ModularPromptEditor'
import { GuidedStartFlow, type GuidedStartResult } from '@/components/workflow/GuidedStartFlow'

interface Avatar {
  id: string
  name: string
  content: string
  is_active: boolean
}

interface Pitch {
  id: string
  name: string
  content: string
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

const VERSION_OPTIONS = [1, 2, 3, 4, 5, 6]

export default function GeneratePage() {
  const { selectedProduct } = useAppContext()

  // Core state
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [avatarStories, setAvatarStories] = useState<AvatarStory[]>([])
  const [pitches, setPitches] = useState<Pitch[]>([])
  const [selectedAvatars, setSelectedAvatars] = useState<string[]>([])
  const [selectedPitch, setSelectedPitch] = useState<string | null>(null)
  const [selectedContentType, setSelectedContentType] = useState('organic_static')
  const [versionCount, setVersionCount] = useState(3)
  const [customInstructions, setCustomInstructions] = useState('')

  // Generation state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)

  // Workflow state
  const [showGuidedStart, setShowGuidedStart] = useState(false)
  const [showAvatarSelector, setShowAvatarSelector] = useState(false)
  const [showAvatarCreator, setShowAvatarCreator] = useState(false)
  const [avatarName, setAvatarName] = useState('')
  const [avatarContent, setAvatarContent] = useState(AVATAR_TEMPLATE)
  const [creatingAvatar, setCreatingAvatar] = useState(false)
  const [generatingName, setGeneratingName] = useState(false)

  // Prompt overrides (one-off changes)
  const [promptOverrides, setPromptOverrides] = useState<Map<string, string>>(new Map())

  // Editing state
  const [editingSelection, setEditingSelection] = useState<{
    text: string
    conceptIndex: number
    field: string
    variantIndex?: number
  } | null>(null)
  const [editInstruction, setEditInstruction] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  // Avatar/Pitch editing state
  const [editingAvatarId, setEditingAvatarId] = useState<string | null>(null)
  const [editingPitchId, setEditingPitchId] = useState<string | null>(null)
  const [editAvatarName, setEditAvatarName] = useState('')
  const [editAvatarContent, setEditAvatarContent] = useState('')
  const [editPitchName, setEditPitchName] = useState('')
  const [editPitchContent, setEditPitchContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Check if should show guided start (first time or no avatars)
  useEffect(() => {
    if (selectedProduct && avatars.length === 0 && !result) {
      // Could show guided start here, but let user opt-in
    }
  }, [selectedProduct, avatars.length, result])

  // Fetch avatars and pitches when product changes
  useEffect(() => {
    if (!selectedProduct) {
      setAvatars([])
      setAvatarStories([])
      setPitches([])
      setSelectedAvatars([])
      setSelectedPitch(null)
      return
    }

    fetchAvatars()
    fetchPitches()
  }, [selectedProduct])

  // Update avatar stories when avatars change
  useEffect(() => {
    setAvatarStories(summarizeAvatars(avatars))
  }, [avatars])

  async function fetchAvatars() {
    if (!selectedProduct) return
    const res = await fetch(`/api/avatars?product_id=${selectedProduct}`)
    const data = await res.json()
    setAvatars(Array.isArray(data) ? data : [])
    setSelectedAvatars([])
  }

  async function fetchPitches() {
    if (!selectedProduct) return
    const res = await fetch(`/api/pitches?product_id=${selectedProduct}&active_only=true`)
    const data = await res.json()
    setPitches(Array.isArray(data) ? data : [])
  }

  function toggleAvatar(id: string) {
    setSelectedAvatars((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  // Handle guided start completion
  function handleGuidedStartComplete(result: GuidedStartResult) {
    setSelectedContentType(result.contentType)
    setVersionCount(result.suggestedCount)

    if (result.swipeContent) {
      setCustomInstructions(`Reference/inspiration:\n${result.swipeContent}`)
    }

    if (result.startingPoint === 'avatars') {
      setShowAvatarSelector(true)
    } else if (result.startingPoint === 'none' && avatars.length === 0) {
      setShowAvatarCreator(true)
    }

    setShowGuidedStart(false)
  }

  // Handle prompt module changes (one-off or saved)
  function handlePromptModuleChange(key: string, content: string, isTemporary: boolean) {
    if (isTemporary) {
      setPromptOverrides(prev => new Map(prev).set(key, content))
    } else {
      // Saved changes clear the temporary override
      setPromptOverrides(prev => {
        const next = new Map(prev)
        next.delete(key)
        return next
      })
    }
  }

  async function handleGenerate() {
    if (!selectedProduct || selectedAvatars.length === 0) {
      setError('Select at least one avatar')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      // Build custom instructions with swipe if provided
      let instructions = customInstructions

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          avatar_ids: selectedAvatars,
          pitch_id: selectedPitch,
          content_type: selectedContentType,
          num_concepts: versionCount,
          user_instructions: instructions || undefined,
          prompt_overrides: promptOverrides.size > 0
            ? Object.fromEntries(promptOverrides)
            : undefined,
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

  // Quick avatar creation
  async function handleCreateAvatar() {
    if (!selectedProduct) return

    setCreatingAvatar(true)

    try {
      let finalName = avatarName.trim()

      if (!finalName) {
        setGeneratingName(true)
        const nameRes = await fetch('/api/generate-avatar-name', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: avatarContent,
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
          content: avatarContent,
        }),
      })

      if (res.ok) {
        const newAvatar = await res.json()
        await fetchAvatars()
        setSelectedAvatars([newAvatar.id])
        setShowAvatarCreator(false)
        setAvatarName('')
        setAvatarContent(AVATAR_TEMPLATE)
      }
    } catch (err) {
      console.error('Failed to create avatar:', err)
    } finally {
      setCreatingAvatar(false)
      setGeneratingName(false)
    }
  }

  // Handle text selection for inline editing
  const handleTextSelection = useCallback((
    conceptIndex: number,
    field: string,
    variantIndex?: number
  ) => {
    const selection = window.getSelection()
    const selectedText = selection?.toString().trim()

    if (selectedText && selectedText.length > 0) {
      setEditingSelection({
        text: selectedText,
        conceptIndex,
        field,
        variantIndex,
      })
    }
  }, [])

  // Apply inline edit
  async function handleApplyEdit() {
    if (!editingSelection || !editInstruction || !result) return

    setIsEditing(true)
    try {
      const res = await fetch('/api/edit-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_text: editingSelection.text,
          edit_instruction: editInstruction,
          context: {
            concept: result.concepts[editingSelection.conceptIndex],
            field: editingSelection.field,
          },
        }),
      })

      const data = await res.json()

      if (data.edited_text) {
        const newConcepts = [...result.concepts]
        const concept = newConcepts[editingSelection.conceptIndex]

        if (editingSelection.field === 'image_description') {
          concept.image_description = concept.image_description.replace(
            editingSelection.text,
            data.edited_text
          )
        } else if (editingSelection.variantIndex !== undefined) {
          const variant = concept.copy_variants[editingSelection.variantIndex]
          if (editingSelection.field === 'hook') {
            variant.hook = variant.hook.replace(editingSelection.text, data.edited_text)
          } else if (editingSelection.field === 'body') {
            variant.body = variant.body.replace(editingSelection.text, data.edited_text)
          } else if (editingSelection.field === 'cta') {
            variant.cta = variant.cta.replace(editingSelection.text, data.edited_text)
          }
        }

        setResult({ ...result, concepts: newConcepts })
      }
    } catch (err) {
      console.error('Edit failed:', err)
    } finally {
      setIsEditing(false)
      setEditingSelection(null)
      setEditInstruction('')
    }
  }

  const selectedPitchData = pitches.find(p => p.id === selectedPitch)
  const selectedAvatarStories = avatarStories.filter(s => selectedAvatars.includes(s.id))

  // Start editing an avatar
  function startEditingAvatar(avatarId: string) {
    const avatar = avatars.find(a => a.id === avatarId)
    if (avatar) {
      setEditingAvatarId(avatarId)
      setEditAvatarName(avatar.name)
      setEditAvatarContent(avatar.content)
    }
  }

  // Save avatar edits
  async function saveAvatarEdit() {
    if (!editingAvatarId) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/avatars/${editingAvatarId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editAvatarName,
          content: editAvatarContent,
        }),
      })
      if (res.ok) {
        await fetchAvatars()
        setEditingAvatarId(null)
      }
    } catch (err) {
      console.error('Failed to save avatar:', err)
    }
    setSavingEdit(false)
  }

  // Start editing a pitch
  function startEditingPitch(pitchId: string) {
    const pitch = pitches.find(p => p.id === pitchId)
    if (pitch) {
      setEditingPitchId(pitchId)
      setEditPitchName(pitch.name)
      setEditPitchContent(pitch.content)
    }
  }

  // Save pitch edits
  async function savePitchEdit() {
    if (!editingPitchId) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/pitches/${editingPitchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editPitchName,
          content: editPitchContent,
        }),
      })
      if (res.ok) {
        await fetchPitches()
        setEditingPitchId(null)
      }
    } catch (err) {
      console.error('Failed to save pitch:', err)
    }
    setSavingEdit(false)
  }

  return (
    <div className="h-full flex flex-col gap-4 px-6 py-5">
      {/* Guided Start Flow Modal */}
      {showGuidedStart && (
        <GuidedStartFlow
          hasAvatars={avatars.length > 0}
          hasPitches={pitches.length > 0}
          onComplete={handleGuidedStartComplete}
          onSkip={() => setShowGuidedStart(false)}
        />
      )}

      {/* Top Controls */}
      <section className="editor-panel p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="editor-tag editor-tag--note">Content</span>
            <div className="flex flex-wrap gap-2">
              {CONTENT_TYPES.map((ct) => (
                <button
                  key={ct.id}
                  onClick={() => setSelectedContentType(ct.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border uppercase tracking-[0.2em] ${
                    selectedContentType === ct.id
                      ? 'bg-[var(--editor-accent)] text-white border-[var(--editor-accent)] shadow-[0_12px_24px_-18px_rgba(47,103,255,0.9)]'
                      : 'bg-transparent text-[var(--editor-ink-muted)] border-[var(--editor-border)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)]'
                  }`}
                  title={ct.description}
                >
                  {ct.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-6 w-px bg-[var(--editor-border)]" />

          <div className="flex items-center gap-3">
            <span className="editor-tag editor-tag--note">Versions</span>
            <div className="flex flex-wrap gap-2">
              {VERSION_OPTIONS.map((num) => (
                <button
                  key={num}
                  onClick={() => setVersionCount(num)}
                  className={`w-10 h-10 rounded-2xl text-xs font-semibold transition-all border ${
                    versionCount === num
                      ? 'bg-[var(--editor-ink)] text-[var(--editor-rail-ink)] border-[var(--editor-ink)]'
                      : 'bg-transparent text-[var(--editor-ink-muted)] border-[var(--editor-border)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)]'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1" />

          <button
            onClick={() => setShowGuidedStart(true)}
            className="editor-button-ghost text-xs"
          >
            Help me decide
          </button>
        </div>

        {pitches.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="editor-tag editor-tag--note">Pitch</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedPitch(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                  !selectedPitch
                    ? 'bg-[var(--editor-accent)] text-white border-[var(--editor-accent)]'
                    : 'bg-transparent text-[var(--editor-ink-muted)] border-[var(--editor-border)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)]'
                }`}
              >
                None
              </button>
              {pitches.map((pitch) => (
                <div key={pitch.id} className="flex items-center">
                  <button
                    onClick={() => setSelectedPitch(pitch.id)}
                    className={`px-3 py-1.5 rounded-l-full text-xs font-semibold transition-all border ${
                      selectedPitch === pitch.id
                        ? 'bg-[var(--editor-accent)] text-white border-[var(--editor-accent)]'
                        : 'bg-transparent text-[var(--editor-ink-muted)] border-[var(--editor-border)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)]'
                    }`}
                  >
                    {pitch.name}
                  </button>
                  <button
                    onClick={() => startEditingPitch(pitch.id)}
                    className={`px-2 py-1.5 rounded-r-full text-xs border-l-0 transition-all border ${
                      selectedPitch === pitch.id
                        ? 'bg-[var(--editor-accent-strong)] text-white border-[var(--editor-accent-strong)]'
                        : 'bg-transparent text-[var(--editor-ink-muted)] border-[var(--editor-border)] hover:text-[var(--editor-ink)] hover:border-[var(--editor-ink)]'
                    }`}
                    title="Edit pitch"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">Direction</p>
                <h3 className="font-serif text-lg text-[var(--editor-ink)]">Custom Instructions</h3>
              </div>
              <span className="text-xs text-[var(--editor-ink-muted)]">Optional</span>
            </div>
            <div className="flex rounded-2xl border border-[var(--editor-border)] overflow-hidden bg-[var(--editor-panel)]">
              <div className="editor-gutter px-3 py-3 flex flex-col gap-2">
                {[1, 2, 3, 4].map((line) => (
                  <span key={line} className="leading-6">{String(line).padStart(2, '0')}</span>
                ))}
              </div>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Add context: reference copy, specific scenarios, tone adjustments..."
                rows={3}
                className="flex-1 bg-transparent p-3 font-mono text-sm leading-6 text-[var(--editor-ink)] focus:outline-none resize-none"
              />
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              onClick={handleGenerate}
              disabled={loading || !selectedProduct || selectedAvatars.length === 0}
              className="editor-button"
            >
              {loading ? 'Generating...' : 'Generate'}
            </button>
            <span className="text-xs text-[var(--editor-ink-muted)]">Requires at least one avatar.</span>
          </div>
        </div>

        {error && (
          <p className="text-red-500 text-sm">{error}</p>
        )}
      </section>

      {/* Main Content Area */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Left Panel: Avatar Selection + Prompt Editor */}
        <aside className="w-[320px] flex flex-col gap-4 overflow-hidden">
          <div className="editor-panel flex flex-col overflow-hidden">
            {/* Avatar Selection Section */}
            <div className="p-4 border-b border-[var(--editor-border)]">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">Targeting</p>
                  <h3 className="font-serif text-lg text-[var(--editor-ink)]">Avatars</h3>
                </div>
                <button
                  onClick={() => setShowAvatarCreator(true)}
                  className="editor-button-ghost text-xs"
                >
                  New Avatar
                </button>
              </div>

              {avatars.length === 0 ? (
                <div className="editor-panel-soft p-4 text-center">
                  <p className="text-sm text-[var(--editor-ink-muted)] mb-2">No avatars yet</p>
                  <button
                    onClick={() => setShowAvatarCreator(true)}
                    className="text-sm text-[var(--editor-accent)] font-semibold"
                  >
                    Create your first avatar
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-h-52 overflow-auto pr-1">
                  {avatarStories.map(story => (
                    <AvatarStoryCard
                      key={story.id}
                      story={story}
                      isSelected={selectedAvatars.includes(story.id)}
                      onToggle={() => toggleAvatar(story.id)}
                      onEdit={() => startEditingAvatar(story.id)}
                      compact
                    />
                  ))}
                </div>
              )}

              {selectedAvatars.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--editor-border)]">
                  <span className={`editor-tag ${
                    selectedAvatars.length > 1 ? 'editor-tag--warning' : 'editor-tag--note'
                  }`}>
                    {selectedAvatars.length > 1 ? `Broad Mode (${selectedAvatars.length})` : 'Deep Mode'}
                  </span>
                </div>
              )}
            </div>

            {/* Selected Avatar Stories */}
            {selectedAvatarStories.length > 0 && (
              <div className="p-4 border-b border-[var(--editor-border)] bg-[var(--editor-panel-muted)]/60">
                <AvatarStoryStack stories={selectedAvatarStories} />
              </div>
            )}

            {/* Modular Prompt Editor */}
            <div className="flex-1 overflow-hidden">
              <ModularPromptEditor
                activeContentType={selectedContentType}
                onModuleChange={handlePromptModuleChange}
                temporaryOverrides={promptOverrides}
              />
            </div>
          </div>
        </aside>

        {/* Results Area */}
        <section className="flex-1 flex flex-col overflow-hidden">
          <div className="editor-panel flex-1 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--editor-border)] flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">Output</p>
                <h2 className="font-serif text-xl text-[var(--editor-ink)]">
                  {result ? `Generated Concepts (${result.concepts.length})` : 'Draft Canvas'}
                </h2>
              </div>
              <span className="editor-tag editor-tag--note">Select text to edit</span>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {loading && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="relative w-12 h-12 mx-auto mb-4">
                      <div className="absolute inset-0 rounded-full border-2 border-[var(--editor-accent)] opacity-30"></div>
                      <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--editor-accent)] animate-spin"></div>
                    </div>
                    <p className="text-[var(--editor-ink-muted)] text-sm">Copy engine running...</p>
                  </div>
                </div>
              )}

              {result && result.concepts && !loading && (
                <div className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
                  {result.concepts.map((concept, i) => (
                    <ConceptCardComponent
                      key={i}
                      concept={concept}
                      index={i}
                      onTextSelect={handleTextSelection}
                    />
                  ))}
                </div>
              )}

              {!loading && !result && selectedAvatars.length > 0 && (
                <div className="flex items-center justify-center h-full text-[var(--editor-ink-muted)]">
                  Pick your settings and hit Generate to create new concepts.
                </div>
              )}

              {!loading && !result && selectedAvatars.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="text-center max-w-md">
                    <div className="text-5xl mb-4">🧠</div>
                    <h3 className="font-serif text-lg text-[var(--editor-ink)] mb-2">Select or create avatars</h3>
                    <p className="text-[var(--editor-ink-muted)] mb-4">
                      Avatars define who you're speaking to. The more specific, the better the output.
                    </p>
                    {avatars.length === 0 && (
                      <button
                        onClick={() => setShowAvatarCreator(true)}
                        className="editor-button"
                      >
                        Create your first avatar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Quick Avatar Creator Modal */}
      {showAvatarCreator && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="editor-panel w-[720px] max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-5 border-b border-[var(--editor-border)] flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">New Avatar</p>
                <h3 className="font-serif text-lg text-[var(--editor-ink)]">Create Avatar</h3>
              </div>
              <button
                onClick={() => {
                  setShowAvatarCreator(false)
                  setAvatarName('')
                  setAvatarContent(AVATAR_TEMPLATE)
                }}
                className="text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)] text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4 flex-1 overflow-auto">
              <div>
                <label className="block text-xs text-[var(--editor-ink-muted)] mb-1">
                  Name (optional - will auto-generate if empty)
                </label>
                <input
                  type="text"
                  value={avatarName}
                  onChange={(e) => setAvatarName(e.target.value)}
                  placeholder="e.g., frustrated-dieter-first-timer"
                  className="editor-input w-full text-sm"
                />
              </div>

              <div className="flex-1">
                <label className="block text-xs text-[var(--editor-ink-muted)] mb-1">Avatar Profile</label>
                <textarea
                  value={avatarContent}
                  onChange={(e) => setAvatarContent(e.target.value)}
                  className="w-full h-[400px] p-4 border border-[var(--editor-border)] rounded-2xl font-mono text-sm bg-[var(--editor-panel)] focus:outline-none focus:ring-2 focus:ring-[var(--editor-accent)]"
                  placeholder="Paste or fill in the avatar template..."
                />
              </div>
            </div>

            <div className="p-5 border-t border-[var(--editor-border)] flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowAvatarCreator(false)
                  setAvatarName('')
                  setAvatarContent(AVATAR_TEMPLATE)
                }}
                className="editor-button-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAvatar}
                disabled={creatingAvatar || !avatarContent.trim()}
                className="editor-button"
              >
                {creatingAvatar
                  ? generatingName
                    ? 'Generating name...'
                    : 'Creating...'
                  : 'Create & Select'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Edit Modal */}
      {editingSelection && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="editor-panel w-[520px] overflow-hidden">
            <div className="p-5 border-b border-[var(--editor-border)]">
              <h3 className="font-serif text-lg text-[var(--editor-ink)]">Edit Selection</h3>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-[var(--editor-ink-muted)] mb-1">Selected Text</label>
                <div className="p-3 rounded-xl text-sm text-[var(--editor-ink)] border border-[var(--editor-border)] bg-[var(--editor-panel-muted)]">
                  "{editingSelection.text}"
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--editor-ink-muted)] mb-1">What do you want to change?</label>
                <textarea
                  value={editInstruction}
                  onChange={(e) => setEditInstruction(e.target.value)}
                  placeholder="e.g., Make it more urgent, add humor, shorten it..."
                  className="editor-input w-full text-sm resize-none"
                  rows={3}
                  autoFocus
                />
              </div>
            </div>

            <div className="p-5 border-t border-[var(--editor-border)] flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditingSelection(null)
                  setEditInstruction('')
                }}
                className="editor-button-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyEdit}
                disabled={!editInstruction || isEditing}
                className="editor-button"
              >
                {isEditing ? 'Editing...' : 'Apply Edit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Avatar Edit Modal */}
      {editingAvatarId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="editor-panel w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-5 border-b border-[var(--editor-border)] flex items-center justify-between">
              <h3 className="font-serif text-lg text-[var(--editor-ink)]">Edit Avatar</h3>
              <button
                onClick={() => setEditingAvatarId(null)}
                className="text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)] text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4 flex-1 overflow-auto">
              <div>
                <label className="block text-sm font-medium text-[var(--editor-ink)] mb-1">Name</label>
                <input
                  type="text"
                  value={editAvatarName}
                  onChange={(e) => setEditAvatarName(e.target.value)}
                  className="editor-input w-full text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-[var(--editor-ink)] mb-1">Content</label>
                <textarea
                  value={editAvatarContent}
                  onChange={(e) => setEditAvatarContent(e.target.value)}
                  className="w-full h-[350px] p-4 border border-[var(--editor-border)] rounded-2xl font-mono text-sm bg-[var(--editor-panel)] focus:outline-none focus:ring-2 focus:ring-[var(--editor-accent)] resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-5 border-t border-[var(--editor-border)] flex justify-end gap-3">
              <button
                onClick={() => setEditingAvatarId(null)}
                className="editor-button-ghost"
              >
                Cancel
              </button>
              <button
                onClick={saveAvatarEdit}
                disabled={savingEdit}
                className="editor-button"
              >
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pitch Edit Modal */}
      {editingPitchId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="editor-panel w-full max-w-xl max-h-[70vh] flex flex-col overflow-hidden">
            <div className="px-6 py-5 border-b border-[var(--editor-border)] flex items-center justify-between">
              <h3 className="font-serif text-lg text-[var(--editor-ink)]">Edit Pitch</h3>
              <button
                onClick={() => setEditingPitchId(null)}
                className="text-[var(--editor-ink-muted)] hover:text-[var(--editor-ink)] text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4 flex-1 overflow-auto">
              <div>
                <label className="block text-sm font-medium text-[var(--editor-ink)] mb-1">Name</label>
                <input
                  type="text"
                  value={editPitchName}
                  onChange={(e) => setEditPitchName(e.target.value)}
                  className="editor-input w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--editor-ink)] mb-1">Content</label>
                <textarea
                  value={editPitchContent}
                  onChange={(e) => setEditPitchContent(e.target.value)}
                  className="w-full h-[220px] p-4 border border-[var(--editor-border)] rounded-2xl text-sm bg-[var(--editor-panel)] focus:outline-none focus:ring-2 focus:ring-[var(--editor-accent)] resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-5 border-t border-[var(--editor-border)] flex justify-end gap-3">
              <button
                onClick={() => setEditingPitchId(null)}
                className="editor-button-ghost"
              >
                Cancel
              </button>
              <button
                onClick={savePitchEdit}
                disabled={savingEdit}
                className="editor-button"
              >
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Concept Card Component
function ConceptCardComponent({
  concept,
  index,
  onTextSelect
}: {
  concept: ConceptCard
  index: number
  onTextSelect: (conceptIndex: number, field: string, variantIndex?: number) => void
}) {
  const lineNumbers = Array.from({ length: 12 }, (_, i) => i + 1)

  return (
    <div className="bg-[var(--editor-panel)] rounded-2xl border border-[var(--editor-border)] overflow-hidden shadow-[0_30px_60px_-50px_var(--editor-card-shadow)] transition-all hover:-translate-y-1 hover:shadow-[0_40px_70px_-45px_var(--editor-card-shadow)]">
      <div className="px-4 py-3 border-b border-[var(--editor-border)] bg-[var(--editor-panel-muted)]/70 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">Concept {index + 1}</p>
          <h3 className="font-serif text-base text-[var(--editor-ink)]">{concept.concept_name}</h3>
        </div>
        <span className="editor-tag editor-tag--note">Draft</span>
      </div>

      <div className="flex">
        <div className="editor-gutter px-3 py-4 flex flex-col gap-2">
          {lineNumbers.map((line) => (
            <span key={line} className="leading-6">{String(line).padStart(2, '0')}</span>
          ))}
        </div>

        <div className="flex-1 p-4 space-y-4">
          {/* Image Description */}
          <div>
            <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">Image</span>
            <p
              className="text-sm text-[var(--editor-ink)]/80 mt-2 cursor-text select-text leading-6"
              onMouseUp={() => onTextSelect(index, 'image_description')}
            >
              {concept.image_description}
            </p>
          </div>

          {/* Copy Variants */}
          <div className="space-y-3">
            <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--editor-ink-muted)]">Copy</span>
            {concept.copy_variants.map((variant, vi) => (
              <div key={vi} className="p-3 bg-[var(--editor-panel-muted)]/70 rounded-2xl border border-[var(--editor-border)] space-y-2">
                <p
                  className="font-semibold text-[var(--editor-ink)] text-sm cursor-text select-text"
                  onMouseUp={() => onTextSelect(index, 'hook', vi)}
                >
                  {variant.hook}
                </p>
                <p
                  className="text-sm text-[var(--editor-ink-muted)] cursor-text select-text"
                  onMouseUp={() => onTextSelect(index, 'body', vi)}
                >
                  {variant.body}
                </p>
                <p
                  className="text-xs uppercase tracking-[0.2em] text-[var(--editor-accent)] font-semibold cursor-text select-text"
                  onMouseUp={() => onTextSelect(index, 'cta', vi)}
                >
                  {variant.cta}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
