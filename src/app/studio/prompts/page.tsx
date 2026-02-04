'use client'

import { useState, useEffect } from 'react'
import { fetchPromptModules, savePromptModule, resetPromptModule, type PromptModule } from '@/lib/services/prompt-manager'
import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'

// Categories for better organization
const CATEGORIES = [
  {
    id: 'content_type',
    label: 'Content Templates',
    description: 'Templates for different content types',
  },
  {
    id: 'shared',
    label: 'Shared Rules',
    description: 'Used across all generations',
  },
  {
    id: 'targeting',
    label: 'Targeting Modes',
    description: 'Avatar targeting behavior',
  },
]

export default function PromptsPage() {
  const [modules, setModules] = useState<PromptModule[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('content_type')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editingModule, setEditingModule] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadModules()
  }, [])

  async function loadModules() {
    setLoading(true)
    try {
      const data = await fetchPromptModules()
      setModules(data)
      // Auto-select first module in category
      const firstInCategory = data.find(m => m.category === selectedCategory)
      if (firstInCategory) {
        setSelectedKey(firstInCategory.key)
      }
    } catch (err) {
      console.error('Failed to load modules:', err)
    }
    setLoading(false)
  }

  const modulesInCategory = modules.filter(m => m.category === selectedCategory)
  const selectedModule = modules.find(m => m.key === selectedKey)

  function startEditing(mod: PromptModule) {
    setEditingModule(mod.key)
    setEditContent(mod.content)
    setMessage(null)
  }

  async function handleSave() {
    if (!editingModule) return
    setSaving(true)
    setMessage(null)

    const result = await savePromptModule(editingModule, editContent, true)

    if (result.success) {
      await loadModules()
      setEditingModule(null)
      setMessage({ type: 'success', text: 'Saved successfully' })
    } else {
      setMessage({ type: 'error', text: result.error || 'Failed to save' })
    }

    setSaving(false)
  }

  async function handleReset() {
    if (!selectedKey) return
    if (!confirm('Reset this template to default? Your changes will be lost.')) return

    setSaving(true)
    setMessage(null)

    const result = await resetPromptModule(selectedKey)

    if (result.success) {
      await loadModules()
      setEditingModule(null)
      setMessage({ type: 'success', text: 'Reset to default' })
    } else {
      setMessage({ type: 'error', text: 'Failed to reset' })
    }

    setSaving(false)
  }

  function cancelEdit() {
    setEditingModule(null)
    setEditContent('')
    setMessage(null)
  }

  return (
    <div className="h-full flex">
      {/* Left Sidebar */}
      <div className="w-72 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <h1 className="text-lg font-semibold text-gray-900">Prompt Templates</h1>
          <p className="text-xs text-gray-500 mt-1">
            Edit the building blocks of your AI prompts
          </p>
        </div>

        {/* Category Tabs */}
        <div className="p-2 border-b border-gray-100">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => {
                setSelectedCategory(cat.id)
                const firstInCat = modules.find(m => m.category === cat.id)
                if (firstInCat) setSelectedKey(firstInCat.key)
                setEditingModule(null)
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="font-medium">{cat.label}</div>
              <div className="text-xs text-gray-400">{cat.description}</div>
            </button>
          ))}
        </div>

        {/* Modules in Category */}
        <div className="flex-1 overflow-auto p-2">
          {loading ? (
            <div className="p-4 text-gray-400 text-sm">Loading...</div>
          ) : (
            <div className="space-y-1">
              {modulesInCategory.map(mod => (
                <button
                  key={mod.key}
                  onClick={() => {
                    setSelectedKey(mod.key)
                    setEditingModule(null)
                    setMessage(null)
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedKey === mod.key
                      ? 'bg-indigo-100 text-indigo-800'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{mod.name}</span>
                    {mod.isCustomized && (
                      <span className="text-xs text-green-500">v{mod.version}</span>
                    )}
                  </div>
                  {!mod.isCustomized && (
                    <span className="text-xs text-gray-400">(default)</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-500">
            Changes made here become the default for all future generations.
            You can also make one-time changes on the Generate page.
          </p>
        </div>
      </div>

      {/* Right Panel - Editor */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {selectedModule ? (
          <>
            {/* Header */}
            <div className="bg-white border-b border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">{selectedModule.name}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">{selectedModule.description}</p>
                  <p className="text-xs mt-1">
                    {selectedModule.isCustomized ? (
                      <span className="text-green-600">Custom template (v{selectedModule.version})</span>
                    ) : (
                      <span className="text-amber-600">Using default template</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {editingModule === selectedModule.key ? (
                    <>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-1.5 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save as Default'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-4 py-1.5 text-gray-600 hover:text-gray-900 text-sm"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEditing(selectedModule)}
                        className="px-4 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                      >
                        Edit
                      </button>
                      {selectedModule.isCustomized && (
                        <button
                          onClick={handleReset}
                          disabled={saving}
                          className="px-4 py-1.5 text-amber-600 hover:text-amber-700 text-sm disabled:opacity-50"
                        >
                          Reset to Default
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Message */}
              {message && (
                <div className={`mt-3 p-2 rounded-lg text-sm ${
                  message.type === 'success'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {message.text}
                </div>
              )}
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-auto p-4">
              {editingModule === selectedModule.key ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full min-h-[500px] p-4 bg-white border border-gray-200 rounded-lg font-mono text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  placeholder="Enter template content..."
                />
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg p-4 h-full overflow-auto">
                  <pre className="font-mono text-sm text-gray-700 whitespace-pre-wrap">
                    {selectedModule.content}
                  </pre>
                </div>
              )}
            </div>

            {/* Footer Help */}
            <div className="bg-white border-t border-gray-200 p-4">
              <div className="text-xs text-gray-500">
                <span className="font-medium">How this template is used:</span>
                <span className="ml-2">
                  {selectedModule.category === 'content_type' &&
                    'This template defines how the AI generates this specific type of content.'}
                  {selectedModule.category === 'shared' &&
                    'This rule is applied to all content types during generation.'}
                  {selectedModule.category === 'targeting' &&
                    'This controls how the AI uses avatar data based on selection count.'}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Select a template from the left
          </div>
        )}
      </div>
    </div>
  )
}
