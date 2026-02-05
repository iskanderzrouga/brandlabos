-- ============================================================================
-- Migration: Enforce one active prompt block per logical key + scope
-- ============================================================================

-- Step 1: Keep only the newest active row per logical key/scope bucket.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        scope,
        COALESCE(scope_id::text, ''),
        COALESCE(NULLIF(metadata->>'key', ''), type::text)
      ORDER BY
        updated_at DESC NULLS LAST,
        version DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM prompt_blocks
  WHERE is_active = true
)
UPDATE prompt_blocks pb
SET is_active = false,
    updated_at = NOW()
FROM ranked r
WHERE pb.id = r.id
  AND r.rn > 1;

-- Step 2: Prevent future duplicate active rows for the same logical key/scope.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_prompt_blocks_active_logical_key_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_prompt_blocks_active_logical_key_unique
      ON prompt_blocks (
        scope,
        COALESCE(scope_id::text, ''),
        COALESCE(NULLIF(metadata->>'key', ''), type::text)
      )
      WHERE is_active = true;
  END IF;
END $$;
