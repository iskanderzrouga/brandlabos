-- ============================================================================
-- PITCHES (belongs to product)
-- Reusable pitch/angle blocks that can be selected during generation
-- ============================================================================
CREATE TABLE pitches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- The actual pitch content - the angle/hook/value proposition
    content TEXT NOT NULL,
    -- Optional metadata for categorization
    type TEXT DEFAULT 'general', -- e.g., 'general', 'pain-focused', 'benefit-focused', 'mechanism', 'social-proof'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pitches_product ON pitches(product_id);
CREATE INDEX idx_pitches_active ON pitches(product_id, is_active);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_pitches_updated_at BEFORE UPDATE ON pitches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
