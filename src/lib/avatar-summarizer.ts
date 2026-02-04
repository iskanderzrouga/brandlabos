// ============================================================================
// AVATAR SUMMARIZER - Converts raw avatar content into readable story cards
// ============================================================================

export interface AvatarStory {
  id: string
  name: string
  headline: string // One sentence summary
  keyPainPoints: string[] // 2-3 bullet points
  motivation: string // What drives them
  fullContent: string // Original content for advanced view
}

// Parse avatar content and extract a human-readable story
export function summarizeAvatar(avatar: { id: string; name: string; content: string }): AvatarStory {
  const content = avatar.content || ''
  
  // Extract key sections from the template format
  const painPoints = extractSection(content, 'Key Pain Points', 'Pain Triggers') ||
                     extractSection(content, 'Current State', 'The Struggle') ||
                     extractBulletPoints(content, ['frustrated', 'tired', 'struggling', 'worried', 'anxious'])
  
  const motivationSection = extractSection(content, 'Desired Outcome', 'What They Want') ||
                            extractSection(content, 'Dream State', 'Goals')
  const motivation = motivationSection.length > 0
    ? motivationSection[0]
    : extractFirstMeaningfulParagraph(content, ['want', 'need', 'dream', 'hope', 'wish'])
  
  const headline = generateHeadline(avatar.name, content)
  
  return {
    id: avatar.id,
    name: avatar.name,
    headline,
    keyPainPoints: painPoints.slice(0, 3),
    motivation: motivation || 'Looking for a solution to their problems',
    fullContent: content,
  }
}

function extractSection(content: string, ...sectionNames: string[]): string[] {
  const lines = content.split('\n')
  const results: string[] = []
  let inSection = false
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // Check if this line starts a target section
    if (sectionNames.some(name => 
      trimmed.toLowerCase().includes(name.toLowerCase()) && 
      (trimmed.startsWith('#') || trimmed.startsWith('##') || trimmed.endsWith(':'))
    )) {
      inSection = true
      continue
    }
    
    // Check if we've hit a new section
    if (inSection && (trimmed.startsWith('#') || (trimmed.endsWith(':') && trimmed.length < 50))) {
      break
    }
    
    // Collect bullet points or meaningful lines
    if (inSection && trimmed) {
      const cleaned = trimmed.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '')
      if (cleaned && cleaned.length > 10 && !cleaned.startsWith('[')) {
        results.push(cleaned)
      }
    }
  }
  
  return results
}

function extractBulletPoints(content: string, keywords: string[]): string[] {
  const lines = content.split('\n')
  const results: string[] = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    if ((trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) &&
        keywords.some(kw => trimmed.toLowerCase().includes(kw))) {
      const cleaned = trimmed.replace(/^[-*•]\s*/, '')
      if (cleaned.length > 10) {
        results.push(cleaned)
      }
    }
  }
  
  return results.slice(0, 5)
}

function extractFirstMeaningfulParagraph(content: string, keywords: string[]): string {
  const paragraphs = content.split('\n\n')
  
  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (trimmed.length > 30 && 
        !trimmed.startsWith('#') && 
        !trimmed.startsWith('[') &&
        keywords.some(kw => trimmed.toLowerCase().includes(kw))) {
      // Return first sentence or first 150 chars
      const firstSentence = trimmed.split(/[.!?]/)[0]
      return firstSentence.length > 150 ? firstSentence.substring(0, 150) + '...' : firstSentence
    }
  }
  
  return ''
}

function generateHeadline(name: string, content: string): string {
  // Try to extract a headline from the content
  const lines = content.split('\n')
  
  // Look for "Who They Are" or similar section
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.toLowerCase().includes('who they are') || 
        line.toLowerCase().includes('who is this') ||
        line.toLowerCase().includes('the person')) {
      // Get next non-empty line
      for (let j = i + 1; j < lines.length && j < i + 5; j++) {
        const nextLine = lines[j].trim()
        if (nextLine && !nextLine.startsWith('#') && !nextLine.startsWith('[') && nextLine.length > 10) {
          return nextLine.substring(0, 100)
        }
      }
    }
  }
  
  // Fall back to name-based headline
  const nameParts = name.split('-').map(p => p.trim())
  if (nameParts.length >= 2) {
    return `A ${nameParts[0]} who is ${nameParts.slice(1).join(' and ')}`
  }
  
  return `Avatar: ${name}`
}

// Batch summarize multiple avatars
export function summarizeAvatars(avatars: { id: string; name: string; content: string }[]): AvatarStory[] {
  return avatars.map(summarizeAvatar)
}
