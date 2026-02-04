'use client'

import { useState } from 'react'
import type { AvatarStory } from '@/lib/avatar-summarizer'

interface AvatarStoryCardProps {
  story: AvatarStory
  isSelected: boolean
  onToggle: () => void
  onEdit?: () => void
  compact?: boolean
}

export function AvatarStoryCard({ story, isSelected, onToggle, onEdit, compact = false }: AvatarStoryCardProps) {
  const [expanded, setExpanded] = useState(false)

  if (compact) {
    return (
      <div
        className={`text-left p-3 rounded-2xl border transition-all ${
          isSelected
            ? 'border-[var(--editor-accent)] bg-[var(--editor-accent-soft)]/60 shadow-[0_14px_30px_-24px_rgba(47,103,255,0.8)]'
            : 'border-[var(--editor-border)] bg-[var(--editor-panel)] hover:border-[var(--editor-ink)]'
        }`}
      >
        <div className="flex items-start gap-3">
          <button onClick={onToggle} className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 ${
              isSelected ? 'bg-[var(--editor-accent)] text-white' : 'bg-[var(--editor-panel-muted)] text-[var(--editor-ink-muted)]'
            }`}>
              {story.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <h4 className="font-medium text-[var(--editor-ink)] text-sm truncate">{story.name}</h4>
              <p className="text-xs text-[var(--editor-ink-muted)] line-clamp-1">{story.headline}</p>
            </div>
          </button>
          <div className="flex items-center gap-1 flex-shrink-0">
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit()
                }}
                className="p-1 text-[var(--editor-ink-muted)] hover:text-[var(--editor-accent)] hover:bg-[var(--editor-accent-soft)]/60 rounded transition-colors"
                title="Edit avatar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
            {isSelected && (
              <span className="text-[var(--editor-accent)]">✓</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`rounded-2xl border transition-all ${
        isSelected
          ? 'border-[var(--editor-accent)] bg-[var(--editor-accent-soft)]/40 shadow-[0_18px_40px_-30px_rgba(47,103,255,0.8)]'
          : 'border-[var(--editor-border)] bg-[var(--editor-panel)] hover:border-[var(--editor-ink)]'
      }`}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full text-left p-4"
      >
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-medium ${
            isSelected ? 'bg-[var(--editor-accent)] text-white' : 'bg-[var(--editor-panel-muted)] text-[var(--editor-ink-muted)]'
          }`}>
            {story.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-[var(--editor-ink)]">{story.name}</h4>
              {isSelected && (
                <span className="px-2 py-0.5 bg-[var(--editor-accent)] text-white text-xs rounded-full">Selected</span>
              )}
            </div>
            <p className="text-sm text-[var(--editor-ink-muted)] mt-1">{story.headline}</p>
          </div>
        </div>
      </button>

      {/* Story Summary */}
      <div className="px-4 pb-4">
        {/* Pain Points */}
        {story.keyPainPoints.length > 0 && (
          <div className="mb-3">
            <span className="text-xs text-[var(--editor-ink-muted)] uppercase tracking-[0.3em]">Pain Points</span>
            <ul className="mt-1 space-y-1">
              {story.keyPainPoints.map((point, i) => (
                <li key={i} className="text-sm text-[var(--editor-ink)] flex items-start gap-2">
                  <span className="text-[var(--editor-warning)] mt-0.5">•</span>
                  <span className="line-clamp-2">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Motivation */}
        {story.motivation && (
          <div className="mb-3">
            <span className="text-xs text-[var(--editor-ink-muted)] uppercase tracking-[0.3em]">Motivation</span>
            <p className="text-sm text-[var(--editor-ink)] mt-1 flex items-start gap-2">
              <span className="text-[var(--editor-success)] mt-0.5">→</span>
              <span>{story.motivation}</span>
            </p>
          </div>
        )}

        {/* Expand/Collapse Full Content */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(!expanded)
          }}
          className="text-xs text-[var(--editor-accent)] hover:text-[var(--editor-accent-strong)] mt-2"
        >
          {expanded ? '↑ Hide full profile' : '↓ Show full profile'}
        </button>

        {expanded && (
          <div className="mt-3 p-3 bg-[var(--editor-panel-muted)] rounded-2xl max-h-60 overflow-auto border border-[var(--editor-border)]">
            <pre className="text-xs text-[var(--editor-ink-muted)] whitespace-pre-wrap font-mono">
              {story.fullContent}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// Stack of selected avatar cards for quick reference
export function AvatarStoryStack({ stories }: { stories: AvatarStory[] }) {
  if (stories.length === 0) return null

  return (
    <div className="space-y-2">
      <span className="text-xs text-[var(--editor-ink-muted)] uppercase tracking-[0.3em]">
        Targeting {stories.length} Avatar{stories.length > 1 ? 's' : ''}
      </span>
      <div className="space-y-2">
        {stories.map(story => (
          <div key={story.id} className="p-3 bg-[var(--editor-panel)] border border-[var(--editor-border)] rounded-2xl">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-[var(--editor-accent)] text-white flex items-center justify-center text-xs font-medium">
                {story.name.charAt(0).toUpperCase()}
              </div>
              <span className="font-medium text-sm text-[var(--editor-ink)]">{story.name}</span>
            </div>
            <p className="text-xs text-[var(--editor-ink-muted)] mt-1 line-clamp-2">{story.headline}</p>
          </div>
        ))}
      </div>
      {stories.length > 1 && (
        <p className="text-xs text-[var(--editor-warning)] bg-[rgba(244,163,64,0.18)] p-2 rounded-2xl border border-[rgba(244,163,64,0.35)]">
          Multi-avatar mode: AI will find common ground across all selected avatars
        </p>
      )}
    </div>
  )
}
