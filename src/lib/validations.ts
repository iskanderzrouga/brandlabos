import { z } from 'zod'

// ============================================================================
// ORGANIZATION SCHEMAS
// ============================================================================

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
})

export const updateOrganizationSchema = createOrganizationSchema.partial()

// ============================================================================
// BRAND SCHEMAS
// ============================================================================

export const createBrandSchema = z.object({
  organization_id: z.string().uuid(),
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  voice_guidelines: z.string().optional().nullable(),
  logo_url: z.string().url().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const updateBrandSchema = createBrandSchema.partial().omit({ organization_id: true })

// ============================================================================
// PRODUCT SCHEMAS (Simple text block like avatars)
// ============================================================================

export const createProductSchema = z.object({
  brand_id: z.string().uuid(),
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  content: z.string().min(1, 'Content is required'),
})

export const updateProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/).optional(),
  content: z.string().min(1).optional(),
})

// ============================================================================
// AVATAR SCHEMAS (Simple text block)
// ============================================================================

export const createAvatarSchema = z.object({
  product_id: z.string().uuid(),
  name: z.string().min(1, 'Name is required').max(100),
  content: z.string().min(1, 'Content is required'),
  is_active: z.boolean().optional(),
})

export const updateAvatarSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
})

// ============================================================================
// PROMPT BLOCK SCHEMAS
// ============================================================================

export const promptBlockTypeEnum = z.enum([
  'global_rules',
  'brand_voice',
  'product_context',
  'avatar_context',
  'feature_template',
  'output_format',
  'custom',
])

export const promptBlockScopeEnum = z.enum([
  'global',
  'brand',
  'product',
  'feature',
])

export const createPromptBlockSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  type: promptBlockTypeEnum,
  scope: promptBlockScopeEnum,
  scope_id: z.string().uuid().optional().nullable(),
  content: z.string().min(1, 'Content is required'),
  is_active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const updatePromptBlockSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// ============================================================================
// GENERATION RUN SCHEMAS
// ============================================================================

export const featureTypeEnum = z.enum([
  'static_organic_ads',
  'scripts',
  'landing_pages',
  'email_sequences',
  'social_posts',
])

export const generationConfigSchema = z.object({
  avatar_ids: z.array(z.string().uuid()).min(1, 'At least one avatar is required'),
  user_instructions: z.string().optional(),
  num_concepts: z.number().int().min(1).max(10).optional(),
  feature_config: z.record(z.string(), z.unknown()).optional(),
})

export const createGenerationRunSchema = z.object({
  product_id: z.string().uuid(),
  feature_type: featureTypeEnum,
  config: generationConfigSchema,
})

// ============================================================================
// ASSET SCHEMAS
// ============================================================================

export const assetTypeEnum = z.enum([
  'concept_card',
  'copy_variant',
  'image_prompt',
  'image',
])

export const createAssetSchema = z.object({
  generation_run_id: z.string().uuid(),
  type: assetTypeEnum,
  content: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type CreateOrganization = z.infer<typeof createOrganizationSchema>
export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>
export type CreateBrand = z.infer<typeof createBrandSchema>
export type UpdateBrand = z.infer<typeof updateBrandSchema>
export type CreateProduct = z.infer<typeof createProductSchema>
export type UpdateProduct = z.infer<typeof updateProductSchema>
export type CreateAvatar = z.infer<typeof createAvatarSchema>
export type UpdateAvatar = z.infer<typeof updateAvatarSchema>
export type CreatePromptBlock = z.infer<typeof createPromptBlockSchema>
export type UpdatePromptBlock = z.infer<typeof updatePromptBlockSchema>
export type CreateGenerationRun = z.infer<typeof createGenerationRunSchema>
export type GenerationConfig = z.infer<typeof generationConfigSchema>
export type CreateAsset = z.infer<typeof createAssetSchema>

// ============================================================================
// USER MANAGEMENT SCHEMAS
// ============================================================================

export const userRoleEnum = z.enum(['super_admin', 'org_admin', 'brand_user'])

export const createAppUserSchema = z.object({
  email: z.string().email('Valid email required'),
  name: z.string().min(1, 'Name is required').max(100).optional(),
  role: userRoleEnum,
  is_active: z.boolean().optional(),
})

export const updateAppUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: userRoleEnum.optional(),
  is_active: z.boolean().optional(),
})

export const userOrganizationAccessSchema = z.object({
  user_id: z.string().uuid(),
  organization_id: z.string().uuid(),
})

export const userBrandAccessSchema = z.object({
  user_id: z.string().uuid(),
  brand_id: z.string().uuid(),
})

export type UserRole = z.infer<typeof userRoleEnum>
export type CreateAppUser = z.infer<typeof createAppUserSchema>
export type UpdateAppUser = z.infer<typeof updateAppUserSchema>
