-- Add ad copy metadata columns to swipes
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS headline TEXT;
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS ad_copy TEXT;
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS cta TEXT;
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'video';
