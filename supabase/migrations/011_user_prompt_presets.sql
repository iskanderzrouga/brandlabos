-- Add user_id column to prompt_blocks for user-level overrides
ALTER TABLE prompt_blocks ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_prompt_blocks_user_id ON prompt_blocks(user_id);

-- Rebuild unique index to include user_id dimension
DROP INDEX IF EXISTS idx_prompt_blocks_active_logical_key_unique;

-- Need IMMUTABLE function wrapper because Neon doesn't allow jsonb ->> or enum::text in index expressions directly
CREATE OR REPLACE FUNCTION prompt_block_logical_key_enum(meta jsonb, block_type prompt_block_type)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(NULLIF(meta ->> 'key', ''), block_type::text)
$$;

CREATE UNIQUE INDEX idx_prompt_blocks_active_logical_key_unique
  ON prompt_blocks (
    scope,
    COALESCE(scope_id::text, ''),
    COALESCE(user_id::text, ''),
    prompt_block_logical_key_enum(metadata, type)
  )
  WHERE is_active = true;
