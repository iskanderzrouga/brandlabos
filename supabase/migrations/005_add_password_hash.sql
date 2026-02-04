-- ============================================================================
-- Migration: Add password hashing for Neon auth
-- ============================================================================

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_password_reset_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_app_users_email_lower ON app_users (lower(email));
