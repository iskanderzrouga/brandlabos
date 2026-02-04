-- ============================================================================
-- Migration: Research library (categories + items + files)
-- ============================================================================

CREATE TABLE IF NOT EXISTS research_categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES app_users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_categories_product_id_idx
  ON research_categories (product_id);

CREATE TABLE IF NOT EXISTS research_files (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime text,
  size_bytes int,
  r2_key text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_files_product_id_idx
  ON research_files (product_id);

CREATE TABLE IF NOT EXISTS research_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id uuid REFERENCES research_categories(id) ON DELETE SET NULL,
  type text NOT NULL,
  title text,
  summary text,
  content text,
  source_url text,
  file_id uuid REFERENCES research_files(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'inbox',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app_users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_items_product_id_idx
  ON research_items (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS research_items_status_idx
  ON research_items (product_id, status);

CREATE INDEX IF NOT EXISTS research_items_category_idx
  ON research_items (category_id, created_at DESC);
