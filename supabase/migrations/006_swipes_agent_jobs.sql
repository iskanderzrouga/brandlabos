-- ============================================================================
-- Migration: Swipes + Media Jobs + Agent Threads/Messages
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SWIPES - Source assets + transcript library (v1: Meta Ad Library only)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS swipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'meta_ad_library',
    source_url TEXT NOT NULL,
    source_id TEXT,
    status TEXT NOT NULL DEFAULT 'processing', -- processing | ready | failed
    title TEXT,
    summary TEXT,
    transcript TEXT,
    r2_video_key TEXT,
    r2_video_mime TEXT NOT NULL DEFAULT 'video/mp4',
    duration_seconds INT,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES app_users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swipes_product_created_at ON swipes(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swipes_product_status ON swipes(product_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_swipes_unique_source ON swipes(product_id, source, source_url);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_swipes_updated_at') THEN
    CREATE TRIGGER update_swipes_updated_at
      BEFORE UPDATE ON swipes
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- MEDIA JOBS - Simple Postgres-backed queue for heavy processing
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS media_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL, -- v1: ingest_meta_ad
    status TEXT NOT NULL DEFAULT 'queued', -- queued | running | completed | failed
    input JSONB NOT NULL,
    output JSONB,
    attempts INT NOT NULL DEFAULT 0,
    run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_jobs_status_run_after ON media_jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_media_jobs_type_status ON media_jobs(type, status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_media_jobs_updated_at') THEN
    CREATE TRIGGER update_media_jobs_updated_at
      BEFORE UPDATE ON media_jobs
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- AGENT THREADS / MESSAGES - Persisted chat + context
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_threads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    title TEXT,
    context JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_threads_user_product ON agent_threads(user_id, product_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_agent_threads_updated_at') THEN
    CREATE TRIGGER update_agent_threads_updated_at
      BEFORE UPDATE ON agent_threads
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id UUID NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL, -- user | assistant | tool
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_created_at ON agent_messages(thread_id, created_at);

