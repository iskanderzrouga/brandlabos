-- ============================================================================
-- Migration: Simplify Avatars to Text Block
-- Instead of structured JSONB data, avatars are now a single text block
-- that gets sent directly to Claude
-- ============================================================================

-- Drop the old data and description columns, add content column
ALTER TABLE avatars DROP COLUMN IF EXISTS description;
ALTER TABLE avatars DROP COLUMN IF EXISTS data;
ALTER TABLE avatars ADD COLUMN content TEXT NOT NULL DEFAULT '';
