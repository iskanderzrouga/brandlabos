// ============================================================================
// AVATAR TEMPLATE - The text block users fill in
// Sent directly to Claude - no parsing needed
// ============================================================================

export const AVATAR_TEMPLATE = `## Name
[Avatar name - e.g., "The Frustrated Dieter"]

## Description
[One-line description]

---

## Identity
Age: [e.g., 35-45]
Gender: [e.g., Female]
Occupation: [e.g., Office Manager]
Lifestyle: [e.g., Busy professional, health-conscious]

---

## Jobs To Be Done

### Main Job
[What core outcome are they trying to achieve?]

### Trigger Situation
[What situation or moment triggers this need?]

### Desired Outcome
[What does success look like for them?]

---

## Four Forces

### Push Forces (problems driving them away from status quo)
- [Problem 1]
- [Problem 2]
- [Problem 3]

### Pull Forces (benefits attracting them to a solution)
- [Benefit 1]
- [Benefit 2]
- [Benefit 3]

### Anxieties (fears about making a change)
- [Fear 1]
- [Fear 2]

### Habits / Inertia (what keeps them stuck)
- [Habit 1]
- [Habit 2]

---

## Awareness & Sophistication

### Awareness Level
[1-5, where 1=Unaware, 2=Problem Aware, 3=Solution Aware, 4=Product Aware, 5=Most Aware]

### Past Solutions Tried
- [Solution 1]
- [Solution 2]

### Sophistication Level
[1-5, where 1=First Timer, 2=Some Exposure, 3=Experienced, 4=Jaded, 5=Expert]

### Proof They Need
- [Proof type 1]
- [Proof type 2]

---

## Psychology

### Pains
- [Pain 1]
- [Pain 2]
- [Pain 3]

### Desires
- [Desire 1]
- [Desire 2]
- [Desire 3]

### Common Objections
- [Objection 1]
- [Objection 2]

### Trust Triggers
- [What makes them trust 1]
- [What makes them trust 2]

---

## Notes
[Any additional context about this avatar]
`

// Helper to extract name from content
export function extractNameFromContent(content: string): string {
  const nameMatch = content.match(/## Name\s*\n+([^\n\[]+)/)
  if (nameMatch && nameMatch[1].trim()) {
    return nameMatch[1].trim()
  }
  return 'Unnamed Avatar'
}
