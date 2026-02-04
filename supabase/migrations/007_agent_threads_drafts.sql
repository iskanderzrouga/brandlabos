-- ============================================================================
-- Migration: Agent thread draft persistence
-- ============================================================================

ALTER TABLE agent_threads
  ADD COLUMN IF NOT EXISTS draft_content TEXT,
  ADD COLUMN IF NOT EXISTS draft_title TEXT;
