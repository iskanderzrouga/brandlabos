export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ============================================================================
// AVATAR - Simple text block (sent directly to AI)
// ============================================================================

// Avatar is now just a text block - the user fills in a template
// and that content is sent directly to Claude. No parsing needed.

// ============================================================================
// PITCH TYPE
// ============================================================================

export interface Pitch {
  id: string
  product_id: string
  name: string
  content: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// ============================================================================
// PROMPT BLOCK TYPES
// ============================================================================

export type PromptBlockType =
  | 'global_rules'      // System-wide rules (format, safety, style)
  | 'brand_voice'       // Brand-specific tone and voice
  | 'product_context'   // Product positioning and claims
  | 'avatar_context'    // Avatar data formatting
  | 'feature_template'  // Feature-specific instructions (e.g., static_ads, scripts)
  | 'output_format'     // JSON/structured output requirements
  | 'custom'            // User-defined blocks

export type PromptBlockScope =
  | 'global'            // Available to all brands
  | 'brand'             // Scoped to a specific brand
  | 'product'           // Scoped to a specific product
  | 'feature'           // Scoped to a feature type

// ============================================================================
// GENERATION RUN TYPES
// ============================================================================

export type FeatureType =
  | 'organic_static'
  | 'ugc_video_scripts'
  | 'landing_page_copy'
  | 'advertorial_copy'

export type GenerationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'

export interface GenerationConfig {
  // Which avatars to use
  avatar_ids: string[]
  // User instructions (affects emergent zoom level)
  user_instructions?: string
  // Number of concepts to generate
  num_concepts?: number
  // Any feature-specific config
  feature_config?: Record<string, unknown>
}

// ============================================================================
// ASSET TYPES
// ============================================================================

export type AssetType =
  | 'concept_card'      // Full concept with image + copy variants
  | 'copy_variant'      // Individual copy piece
  | 'image_prompt'      // Image generation prompt
  | 'image'             // Generated image URL

export interface ConceptCardData {
  // Human-readable image description
  image_description: string
  // Technical prompt for image generation
  image_prompt: string
  // Multiple copy variants for this concept
  copy_variants: CopyVariant[]
}

export interface CopyVariant {
  headline?: string
  body: string
  hook?: string
  cta?: string
}

// ============================================================================
// DATABASE SCHEMA TYPES
// ============================================================================

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          created_at?: string
          updated_at?: string
        }
      }
      brands: {
        Row: {
          id: string
          organization_id: string
          name: string
          slug: string
          voice_guidelines: string | null
          logo_url: string | null
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          slug: string
          voice_guidelines?: string | null
          logo_url?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          slug?: string
          voice_guidelines?: string | null
          logo_url?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      products: {
        Row: {
          id: string
          brand_id: string
          name: string
          slug: string
          content: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          brand_id: string
          name: string
          slug: string
          content: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          brand_id?: string
          name?: string
          slug?: string
          content?: string
          created_at?: string
          updated_at?: string
        }
      }
      pitches: {
        Row: {
          id: string
          product_id: string
          name: string
          content: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          product_id: string
          name: string
          content: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          name?: string
          content?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      avatars: {
        Row: {
          id: string
          product_id: string
          name: string
          content: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          product_id: string
          name: string
          content: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          name?: string
          content?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      prompt_blocks: {
        Row: {
          id: string
          name: string
          type: PromptBlockType
          scope: PromptBlockScope
          scope_id: string | null
          content: string
          version: number
          is_active: boolean
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          type: PromptBlockType
          scope: PromptBlockScope
          scope_id?: string | null
          content: string
          version?: number
          is_active?: boolean
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          type?: PromptBlockType
          scope?: PromptBlockScope
          scope_id?: string | null
          content?: string
          version?: number
          is_active?: boolean
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      generation_runs: {
        Row: {
          id: string
          product_id: string
          feature_type: FeatureType
          status: GenerationStatus
          config: GenerationConfig
          assembled_prompt: string | null
          raw_response: Json | null
          error_message: string | null
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          product_id: string
          feature_type: FeatureType
          status?: GenerationStatus
          config: GenerationConfig
          assembled_prompt?: string | null
          raw_response?: Json | null
          error_message?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          product_id?: string
          feature_type?: FeatureType
          status?: GenerationStatus
          config?: GenerationConfig
          assembled_prompt?: string | null
          raw_response?: Json | null
          error_message?: string | null
          created_at?: string
          completed_at?: string | null
        }
      }
      assets: {
        Row: {
          id: string
          generation_run_id: string
          type: AssetType
          content: Json
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          generation_run_id: string
          type: AssetType
          content: Json
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          generation_run_id?: string
          type?: AssetType
          content?: Json
          metadata?: Json | null
          created_at?: string
        }
      }
    }
  }
}

// ============================================================================
// HELPER TYPES
// ============================================================================

export type Organization = Database['public']['Tables']['organizations']['Row']
export type Brand = Database['public']['Tables']['brands']['Row']
export type Product = Database['public']['Tables']['products']['Row']
export type Avatar = Database['public']['Tables']['avatars']['Row']
export type PromptBlock = Database['public']['Tables']['prompt_blocks']['Row']
export type GenerationRun = Database['public']['Tables']['generation_runs']['Row']
export type Asset = Database['public']['Tables']['assets']['Row']
export type PitchRow = Database['public']['Tables']['pitches']['Row']
