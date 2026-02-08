-- Add image storage columns to swipes table
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS r2_image_key TEXT;
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS r2_image_mime TEXT;
