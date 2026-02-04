// ============================================================================
// CONTENT TYPES - Different types of content that can be generated
// Templates are stored in the database (prompt_blocks table)
// ============================================================================

export interface ContentType {
  id: string
  label: string
  description: string
}

export const CONTENT_TYPES: ContentType[] = [
  {
    id: 'organic_static',
    label: 'Organic Static Ads',
    description: 'Static ad copy for Meta (Facebook/Instagram)',
  },
  {
    id: 'ugc_video_scripts',
    label: 'UGC Video Scripts',
    description: 'Scripts for user-generated content style videos',
  },
  {
    id: 'landing_page_copy',
    label: 'Landing Page Copy',
    description: 'Copy for landing pages and sales pages',
  },
  {
    id: 'advertorial_copy',
    label: 'Advertorial Copy',
    description: 'Native advertising and advertorial content',
  },
]
