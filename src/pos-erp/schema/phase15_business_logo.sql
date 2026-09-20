-- ============================================================
-- Phase 15 -- Business logo storage (Settings: upload a photo + set
-- business name). lb_businesses.logo_url already exists as a column
-- (settingsService.js's own header comment confirms it) -- what was
-- missing is somewhere to actually UPLOAD a file TO, so that column has
-- a real URL to hold.
--
-- Supabase Storage, not a database column holding raw image bytes: this
-- is a small, browser-uploaded image (a logo), and Storage is what
-- Supabase already provides for exactly this, with its own CDN-backed
-- public URLs -- no reason to invent a different mechanism.
--
-- BUCKET SETUP IS NOT SQL -- run this in the Supabase Dashboard
-- (Storage -> New bucket) or via the CLI, not as a migration:
--   Name: business-logos
--   Public: YES (a logo needs to render on receipts and the sidebar
--     without every viewer needing a signed URL/auth token -- it's a
--     public-facing brand asset, not sensitive data, same category as
--     the shortcode already treated as safe-to-read in Phase 13)
--
-- Path convention every upload MUST follow (enforced by the policies
-- below, not just a comment): `<business_id>/logo.<ext>` -- one logo
-- per business, so a re-upload naturally overwrites the old file
-- instead of accumulating orphaned images no code ever deletes.
--
-- Run order: migration #13, after phase14_receipts.sql. This one only
-- touches storage.objects policies -- run it AFTER creating the bucket
-- in the dashboard, or the policies will reference a bucket_id that
-- doesn't exist yet (harmless, just a no-op policy on a bucket with no
-- name to match, but confusing to leave that way).
-- ============================================================

-- Anyone can VIEW a logo (it's public-facing branding) -- but only a
-- member of the owning tenant can UPLOAD/REPLACE/DELETE one, and only
-- into their OWN business_id's folder. The folder-name check
-- ((storage.foldername(name))[1]) is what stops a business from
-- overwriting another business's logo even though the bucket itself is
-- public-read.

DROP POLICY IF EXISTS business_logos_public_read ON storage.objects;
CREATE POLICY business_logos_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'business-logos');

DROP POLICY IF EXISTS business_logos_tenant_write ON storage.objects;
CREATE POLICY business_logos_tenant_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'business-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()
    )
  );

DROP POLICY IF EXISTS business_logos_tenant_update ON storage.objects;
CREATE POLICY business_logos_tenant_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'business-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()
    )
  );

DROP POLICY IF EXISTS business_logos_tenant_delete ON storage.objects;
CREATE POLICY business_logos_tenant_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'business-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()
    )
  );

-- NOTE: these policies assume storage.objects RLS is already enabled
-- project-wide, which is Supabase's own default for every project and
-- not something this migration needs to turn on itself.
