'use client'

import { useState } from 'react'
import { CONTENT_TYPES } from '@/lib/content-types'

// The workflow intent options
type WorkflowIntent = 'explore' | 'iterate' | 'scale'
type StartingPoint = 'swipe' | 'avatars' | 'pitch' | 'none'

interface GuidedStartFlowProps {
  hasAvatars: boolean
  hasPitches: boolean
  onComplete: (result: GuidedStartResult) => void
  onSkip: () => void
}

export interface GuidedStartResult {
  intent: WorkflowIntent
  startingPoint: StartingPoint
  contentType: string
  swipeContent?: string
  selectedAvatarIds?: string[]
  selectedPitchId?: string
  suggestedCount: number
}

export function GuidedStartFlow({ hasAvatars, hasPitches, onComplete, onSkip }: GuidedStartFlowProps) {
  const [step, setStep] = useState(1)
  const [intent, setIntent] = useState<WorkflowIntent | null>(null)
  const [startingPoint, setStartingPoint] = useState<StartingPoint | null>(null)
  const [contentType, setContentType] = useState('organic_static')
  const [swipeContent, setSwipeContent] = useState('')

  const handleIntentSelect = (selected: WorkflowIntent) => {
    setIntent(selected)
    setStep(2)
  }

  const handleStartingPointSelect = (selected: StartingPoint) => {
    setStartingPoint(selected)

    if (selected === 'swipe') {
      setStep(3) // Go to swipe input
    } else {
      // Complete with current selections
      completeFlow(selected)
    }
  }

  const handleSwipeSubmit = () => {
    if (swipeContent.trim()) {
      completeFlow('swipe')
    }
  }

  const completeFlow = (finalStartingPoint: StartingPoint) => {
    // Suggest different counts based on intent
    let suggestedCount = 3
    if (intent === 'explore') suggestedCount = 4
    if (intent === 'scale') suggestedCount = 6

    onComplete({
      intent: intent!,
      startingPoint: finalStartingPoint,
      contentType,
      swipeContent: finalStartingPoint === 'swipe' ? swipeContent : undefined,
      suggestedCount,
    })
  }

  return (
    <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {step === 1 && "What are you trying to do?"}
              {step === 2 && "What are you starting from?"}
              {step === 3 && "Paste your swipe/reference"}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {step === 1 && "This helps us tailor the workflow for you"}
              {step === 2 && "Start from whatever you have"}
              {step === 3 && "We'll analyze it to inform generation"}
            </p>
          </div>
          <button
            onClick={onSkip}
            className="text-gray-400 hover:text-gray-600 text-sm"
          >
            Skip
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Step 1: Intent */}
          {step === 1 && (
            <div className="space-y-3">
              <IntentOption
                icon="🔍"
                title="Explore something new"
                description="Discover new angles, test new avatars, or brainstorm fresh concepts"
                selected={intent === 'explore'}
                onClick={() => handleIntentSelect('explore')}
              />
              <IntentOption
                icon="🔄"
                title="Iterate on an existing idea"
                description="You have a swipe or angle that's working - create variations"
                selected={intent === 'iterate'}
                onClick={() => handleIntentSelect('iterate')}
              />
              <IntentOption
                icon="📈"
                title="Scale what's working"
                description="Generate volume and variations of proven concepts"
                selected={intent === 'scale'}
                onClick={() => handleIntentSelect('scale')}
              />
            </div>
          )}

          {/* Step 2: Starting Point */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Content Type Selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What type of content?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {CONTENT_TYPES.map(ct => (
                    <button
                      key={ct.id}
                      onClick={() => setContentType(ct.id)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        contentType === ct.id
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium text-sm text-gray-900">{ct.label}</div>
                      <div className="text-xs text-gray-500">{ct.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Start from...
                </label>
                <div className="space-y-2">
                  <StartingPointOption
                    icon="📋"
                    title="A swipe or reference"
                    description="Paste ad copy, a competitor example, or inspiration"
                    onClick={() => handleStartingPointSelect('swipe')}
                  />
                  {hasAvatars ? (
                    <StartingPointOption
                      icon="👤"
                      title="Your avatars"
                      description="Select from your existing avatar profiles"
                      onClick={() => handleStartingPointSelect('avatars')}
                    />
                  ) : (
                    <div className="p-4 rounded-lg border border-dashed border-gray-300 bg-gray-50">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl opacity-50">👤</span>
                        <div>
                          <div className="font-medium text-sm text-gray-500">No avatars yet</div>
                          <div className="text-xs text-gray-400">You can create avatars in the next step</div>
                        </div>
                      </div>
                    </div>
                  )}
                  {hasPitches && (
                    <StartingPointOption
                      icon="🎯"
                      title="A pitch or angle"
                      description="Start with a specific value proposition"
                      onClick={() => handleStartingPointSelect('pitch')}
                    />
                  )}
                  <StartingPointOption
                    icon="✨"
                    title="I'm not sure - help me decide"
                    description="We'll ask a few questions to find the right approach"
                    onClick={() => handleStartingPointSelect('none')}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Swipe Input */}
          {step === 3 && (
            <div className="space-y-4">
              <textarea
                value={swipeContent}
                onChange={(e) => setSwipeContent(e.target.value)}
                placeholder="Paste your ad copy, competitor example, or reference material here..."
                className="w-full h-48 p-4 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                autoFocus
              />
              <p className="text-xs text-gray-500">
                Tip: The more context you provide, the better we can match the style and approach.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="text-gray-600 hover:text-gray-900 text-sm"
            >
              ← Back
            </button>
          )}
          {step === 1 && <div />}

          <div className="flex items-center gap-2">
            {/* Progress dots */}
            <div className="flex gap-1 mr-4">
              {[1, 2, 3].map(s => (
                <div
                  key={s}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    s === step ? 'bg-indigo-500' : s < step ? 'bg-indigo-300' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>

            {step === 3 && (
              <button
                onClick={handleSwipeSubmit}
                disabled={!swipeContent.trim()}
                className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm hover:bg-indigo-600 disabled:opacity-50"
              >
                Continue
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function IntentOption({
  icon,
  title,
  description,
  selected,
  onClick
}: {
  icon: string
  title: string
  description: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border transition-all ${
        selected
          ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-4">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="font-medium text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
    </button>
  )
}

function StartingPointOption({
  icon,
  title,
  description,
  onClick
}: {
  icon: string
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="font-medium text-sm text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
      </div>
    </button>
  )
}
