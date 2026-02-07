-- Add user_id column to prompt_blocks for user-level overrides
ALTER TABLE prompt_blocks ADD COLUMN user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;

CREATE INDEX idx_prompt_blocks_user_id ON prompt_blocks(user_id);

-- Rebuild unique index to include user_id dimension
DROP INDEX IF EXISTS idx_prompt_blocks_active_logical_key_unique;

CREATE UNIQUE INDEX idx_prompt_blocks_active_logical_key_unique
  ON prompt_blocks (
    scope,
    COALESCE(scope_id::text, ''),
    COALESCE(user_id::text, ''),
    COALESCE(NULLIF(metadata->>'key', ''), type::text)
  )
  WHERE is_active = true;
