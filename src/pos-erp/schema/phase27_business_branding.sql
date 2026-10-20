-- ============================================================
-- Phase 27 -- business-logos bucket limits (server-side backstop).
-- The browser already validates + re-encodes logos (utils/logoImage.js),
-- but a client check is not a control. This makes Storage itself refuse
-- oversize files and non-raster types (so SVG/HTML/script uploads are
-- rejected even if someone calls the Storage API directly).
--
-- NOT DEPLOYED. Review and run manually after approval.
-- Idempotent. No-op if the bucket has not been created yet.
-- Policies from phase15 (tenant-folder write isolation) are unchanged.
-- ============================================================
UPDATE storage.buckets
   SET file_size_limit    = 1048576,                       -- 1 MB (client output is <=512px)
       allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']
 WHERE id = 'business-logos';
