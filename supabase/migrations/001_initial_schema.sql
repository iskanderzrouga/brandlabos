-- ============================================================================
-- BrandLab OS - Core Schema
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ORGANIZATIONS (top-level tenant)
-- ============================================================================
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- BRANDS (belongs to organization)
-- ============================================================================
CREATE TABLE brands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    voice_guidelines TEXT,
    logo_url TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, slug)
);

CREATE INDEX idx_brands_organization ON brands(organization_id);

-- ============================================================================
-- PRODUCTS (belongs to brand)
-- ============================================================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    -- JSONB for flexible product context
    context JSONB NOT NULL DEFAULT '{
        "pitch": "",
        "mechanism": null,
        "ingredients": [],
        "claims": [],
        "claims_boundaries": [],
        "proof_points": [],
        "voice_guidelines": null,
        "price_point": null,
        "competitive_angle": null
    }',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(brand_id, slug)
);

CREATE INDEX idx_products_brand ON products(brand_id);

-- ============================================================================
-- AVATARS (belongs to product)
-- Deep psychological profile stored in JSONB
-- ============================================================================
CREATE TABLE avatars (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    -- Full avatar data in JSONB for flexibility
    data JSONB NOT NULL DEFAULT '{
        "identity": {},
        "jtbd": {"main_job": ""},
        "four_forces": {"push_forces": [], "pull_forces": [], "anxieties": [], "habits_inertia": []},
        "awareness": {"level": 1, "level_label": "unaware"},
        "sophistication": {"level": 1, "level_label": "first_timer"},
        "psychology": {"pains": [], "desires": []}
    }',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_avatars_product ON avatars(product_id);
CREATE INDEX idx_avatars_active ON avatars(product_id, is_active);

-- ============================================================================
-- PROMPT BLOCKS (versioned, scoped prompt components)
-- The building blocks for the prompt compiler
-- ============================================================================
CREATE TYPE prompt_block_type AS ENUM (
    'global_rules',
    'brand_voice',
    'product_context',
    'avatar_context',
    'feature_template',
    'output_format',
    'custom'
);

CREATE TYPE prompt_block_scope AS ENUM (
    'global',
    'brand',
    'product',
    'feature'
);

CREATE TABLE prompt_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type prompt_block_type NOT NULL,
    scope prompt_block_scope NOT NULL,
    -- NULL for global scope, otherwise references brand/product/feature
    scope_id UUID,
    content TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prompt_blocks_type ON prompt_blocks(type);
CREATE INDEX idx_prompt_blocks_scope ON prompt_blocks(scope, scope_id);
CREATE INDEX idx_prompt_blocks_active ON prompt_blocks(is_active);

-- ============================================================================
-- GENERATION RUNS (tracks generation requests)
-- ============================================================================
CREATE TYPE feature_type AS ENUM (
    'static_organic_ads',
    'scripts',
    'landing_pages',
    'email_sequences',
    'social_posts'
);

CREATE TYPE generation_status AS ENUM (
    'pending',
    'running',
    'completed',
    'failed'
);

CREATE TABLE generation_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    feature_type feature_type NOT NULL,
    status generation_status DEFAULT 'pending',
    -- Config includes avatar_ids, user_instructions, etc.
    config JSONB NOT NULL DEFAULT '{"avatar_ids": []}',
    -- The fully assembled prompt sent to AI
    assembled_prompt TEXT,
    -- Raw response from AI
    raw_response JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_generation_runs_product ON generation_runs(product_id);
CREATE INDEX idx_generation_runs_status ON generation_runs(status);
CREATE INDEX idx_generation_runs_feature ON generation_runs(feature_type);

-- ============================================================================
-- ASSETS (generated outputs)
-- ============================================================================
CREATE TYPE asset_type AS ENUM (
    'concept_card',
    'copy_variant',
    'image_prompt',
    'image'
);

CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    generation_run_id UUID NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
    type asset_type NOT NULL,
    -- Flexible content storage
    content JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assets_run ON assets(generation_run_id);
CREATE INDEX idx_assets_type ON assets(type);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_brands_updated_at
    BEFORE UPDATE ON brands
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_avatars_updated_at
    BEFORE UPDATE ON avatars
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prompt_blocks_updated_at
    BEFORE UPDATE ON prompt_blocks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - Prepared for auth
-- ============================================================================
-- Enable RLS on all tables (policies will be added when auth is implemented)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE avatars ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

-- For local development, allow all operations (service role bypasses RLS)
-- These policies allow authenticated users full access for now
-- Will be refined when proper auth is added

CREATE POLICY "Allow all for now" ON organizations FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON brands FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON products FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON avatars FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON prompt_blocks FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON generation_runs FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON assets FOR ALL USING (true);
