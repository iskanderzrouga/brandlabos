// ============================================================================
// CENTRALIZED PROMPT MANAGER - Single Source of Truth for all prompts
// ============================================================================

import { DEFAULT_PROMPT_BLOCKS } from '@/lib/prompt-defaults'

export interface PromptModule {
  key: string
  name: string
  description: string
  category: 'content_type' | 'shared' | 'targeting'
  content: string
  isCustomized: boolean
  dbId?: string
  version?: number
}

export interface PromptOverride {
  key: string
  content: string
  isTemporary: boolean // true = one-off, false = save as default
}

// Fetch all prompt modules from the database
export async function fetchPromptModules(): Promise<PromptModule[]> {
  const res = await fetch('/api/prompt-blocks?scope=global')
  const dbBlocks = await res.json()
  
  const modules: PromptModule[] = []
  
  // Content type templates
  const contentTypes = [
    { key: 'organic_static', name: 'Organic Static Ads', category: 'content_type' as const },
    { key: 'ugc_video_scripts', name: 'UGC Video Scripts', category: 'content_type' as const },
    { key: 'landing_page_copy', name: 'Landing Page Copy', category: 'content_type' as const },
    { key: 'advertorial_copy', name: 'Advertorial Copy', category: 'content_type' as const },
  ]
  
  // Shared modules (writing rules only - output format is per content type now)
  const sharedModules = [
    { key: 'writing_rules', name: 'Writing Rules', category: 'shared' as const },
  ]

  // Output format modules (per content type)
  const outputFormatModules = [
    { key: 'output_format_organic_static', name: 'Output Format: Static Ads', category: 'shared' as const },
    { key: 'output_format_ugc_video_scripts', name: 'Output Format: UGC Scripts', category: 'shared' as const },
    { key: 'output_format_landing_page_copy', name: 'Output Format: Landing Page', category: 'shared' as const },
    { key: 'output_format_advertorial_copy', name: 'Output Format: Advertorial', category: 'shared' as const },
  ]
  
  // Targeting modules
  const targetingModules = [
    { key: 'zoom_deep', name: 'Deep Mode (Single Avatar)', category: 'targeting' as const },
    { key: 'zoom_broad', name: 'Broad Mode (Multi Avatar)', category: 'targeting' as const },
  ]
  
  const allModules = [...contentTypes, ...sharedModules, ...outputFormatModules, ...targetingModules]
  
  for (const mod of allModules) {
    const dbBlock = Array.isArray(dbBlocks) 
      ? dbBlocks.find((b: { metadata?: { key?: string } }) => b.metadata?.key === mod.key)
      : null
    const defaultBlock = DEFAULT_PROMPT_BLOCKS[mod.key as keyof typeof DEFAULT_PROMPT_BLOCKS]
    
    modules.push({
      key: mod.key,
      name: mod.name,
      description: getModuleDescription(mod.key),
      category: mod.category,
      content: dbBlock?.content || defaultBlock?.content || '',
      isCustomized: !!dbBlock,
      dbId: dbBlock?.id,
      version: dbBlock?.version,
    })
  }
  
  return modules
}

// Save a prompt module (create or update)
export async function savePromptModule(
  key: string,
  content: string,
  saveAsDefault: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!saveAsDefault) {
    // One-off changes are handled in memory, no DB save needed
    return { success: true }
  }

  try {
    // Fetch current modules to check if exists
    const res = await fetch('/api/prompt-blocks?scope=global')
    const dbBlocks = await res.json()
    console.log('Fetched prompt blocks:', dbBlocks?.length || 0, 'blocks')

    const existing = Array.isArray(dbBlocks)
      ? dbBlocks.find((b: { metadata?: { key?: string } }) => b.metadata?.key === key)
      : null

    console.log('Saving prompt module:', key, 'existing:', !!existing)

    if (existing) {
      // Update existing
      console.log('Updating existing prompt block:', existing.id, 'with content length:', content.length)
      const updateRes = await fetch(`/api/prompt-blocks/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const updateData = await updateRes.json()
      if (!updateRes.ok) {
        console.error('Failed to update prompt block:', updateData)
        throw new Error(updateData.error || JSON.stringify(updateData.details) || 'Failed to update')
      }
      console.log('Updated prompt block:', updateData.id)
    } else {
      // Create new - use 'custom' type which is valid in the enum
      const defaultBlock = DEFAULT_PROMPT_BLOCKS[key as keyof typeof DEFAULT_PROMPT_BLOCKS]
      const payload = {
        name: defaultBlock?.name || key,
        type: 'custom',
        scope: 'global',
        content,
        metadata: { key },
      }
      console.log('Creating prompt block with payload:', JSON.stringify(payload, null, 2))

      const createRes = await fetch('/api/prompt-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const createData = await createRes.json()
      if (!createRes.ok) {
        console.error('Failed to create prompt block:', createData)
        throw new Error(createData.error || JSON.stringify(createData.details) || 'Failed to create')
      }
      console.log('Created prompt block:', createData.id)
    }

    return { success: true }
  } catch (error) {
    console.error('savePromptModule error:', error)
    return { success: false, error: String(error) }
  }
}

// Reset a module to default
export async function resetPromptModule(key: string): Promise<{ success: boolean }> {
  const defaultBlock = DEFAULT_PROMPT_BLOCKS[key as keyof typeof DEFAULT_PROMPT_BLOCKS]
  if (!defaultBlock) return { success: false }
  
  return savePromptModule(key, defaultBlock.content, true)
}

function getModuleDescription(key: string): string {
  const descriptions: Record<string, string> = {
    organic_static: 'Template for generating static social media ad concepts',
    ugc_video_scripts: 'Template for user-generated content style video scripts',
    landing_page_copy: 'Template for landing page and sales page copy',
    advertorial_copy: 'Template for native advertising content',
    output_format_organic_static: 'JSON structure for static ad responses',
    output_format_ugc_video_scripts: 'JSON structure for UGC script responses',
    output_format_landing_page_copy: 'JSON structure for landing page responses',
    output_format_advertorial_copy: 'JSON structure for advertorial responses',
    writing_rules: 'Global writing style and tone guidelines',
    zoom_deep: 'Instructions for targeting a single avatar deeply',
    zoom_broad: 'Instructions for finding common ground across multiple avatars',
  }
  return descriptions[key] || ''
}
