-- ============================================================================
-- Migration: Organization API Keys + org-only access cleanup
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ORGANIZATION API KEYS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    last4 TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_org_api_keys_org ON organization_api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_api_keys_provider ON organization_api_keys(provider);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_org_api_keys_updated_at') THEN
    CREATE TRIGGER update_org_api_keys_updated_at
      BEFORE UPDATE ON organization_api_keys
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ACCESS MODEL CLEANUP (org-only)
-- ---------------------------------------------------------------------------
-- Promote any brand_user to org_admin
UPDATE app_users
SET role = 'org_admin'
WHERE role = 'brand_user';

-- Clear brand access records to avoid confusion (optional cleanup)
DELETE FROM user_brand_access;
