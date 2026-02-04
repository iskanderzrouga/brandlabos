-- ============================================================================
-- Migration: User Access Management
-- Adds user roles and access control at org/brand level
-- ============================================================================

-- User roles enum
CREATE TYPE user_role AS ENUM (
    'super_admin',    -- Full access to everything
    'org_admin',      -- Admin access to specific organization(s)
    'brand_user'      -- Access to specific brand(s) only
);

-- ============================================================================
-- APP_USERS - Links Supabase Auth users to our access control
-- ============================================================================
CREATE TABLE app_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID NOT NULL UNIQUE,  -- References auth.users(id)
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    role user_role NOT NULL DEFAULT 'brand_user',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_app_users_auth_id ON app_users(auth_user_id);
CREATE INDEX idx_app_users_email ON app_users(email);
CREATE INDEX idx_app_users_role ON app_users(role);

-- ============================================================================
-- USER_ORGANIZATION_ACCESS - Org-level access for org_admin users
-- ============================================================================
CREATE TABLE user_organization_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, organization_id)
);

CREATE INDEX idx_user_org_access_user ON user_organization_access(user_id);
CREATE INDEX idx_user_org_access_org ON user_organization_access(organization_id);

-- ============================================================================
-- USER_BRAND_ACCESS - Brand-level access for brand_user users
-- ============================================================================
CREATE TABLE user_brand_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, brand_id)
);

CREATE INDEX idx_user_brand_access_user ON user_brand_access(user_id);
CREATE INDEX idx_user_brand_access_brand ON user_brand_access(brand_id);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================
CREATE TRIGGER update_app_users_updated_at
    BEFORE UPDATE ON app_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organization_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_brand_access ENABLE ROW LEVEL SECURITY;

-- Policies - super_admin can see all, others see only themselves
CREATE POLICY "Allow all for now" ON app_users FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON user_organization_access FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON user_brand_access FOR ALL USING (true);

-- ============================================================================
-- SEED: Create super admin user for iskander@bluebrands.co
-- Note: auth_user_id will need to be updated after first login
-- ============================================================================
INSERT INTO app_users (email, name, role, auth_user_id)
VALUES (
    'iskander@bluebrands.co',
    'Iskander',
    'super_admin',
    '00000000-0000-0000-0000-000000000000'  -- Placeholder, update after first login
) ON CONFLICT (email) DO UPDATE SET role = 'super_admin';
