-- ============================================================
-- Phase 27 -- Business branding: owner-only identity changes + upload limits
--
-- NOT YET RUN ANYWHERE. Review on staging first. Safe to re-run.
-- Run AFTER phase1 (pos_staff, get_pos_profile) and phase15 (bucket policies).
--
-- What this enforces IN THE DATABASE (not just in the UI):
--   1. Only a POS *owner* can upload / replace / delete a business logo.
--      (Before: any staff member of the tenant could, incl. cashiers.)
--   2. Only a POS owner can change business identity columns on
--      lb_businesses (name, phone, email, address, currency, time_zone,
--      logo_url).
--   3. The business-logos bucket itself refuses anything but PNG/JPEG
--      and anything over 2 MB, regardless of what a client claims.
--
-- What it deliberately does NOT change:
--   * Non-POS sessions (main Umova app admins, service role) behave as
--     before: the guards only apply when the JWT carries `pos_staff_id`.
--   * Public READ of logos stays (logos are public-facing brand assets and
--     must render on shared receipts). Object paths contain the business
--     UUID, so they are not listable by guessing, but they ARE readable by
--     anyone who has the URL. Do not store anything sensitive as a logo.
--   * Per-staff permissions. Until the permissions step (Step 2) adds a
--     "change business settings" permission, "owner only" is the safe
--     default. Managers lose the ability to edit these fields.
-- ============================================================

-- A POS session is one whose JWT carries a pos_staff_id claim
-- (stamped by pos_custom_access_token_hook at login).
CREATE OR REPLACE FUNCTION is_pos_session() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT nullif(auth.jwt() ->> 'pos_staff_id', '') IS NOT NULL $$;

-- True only for an ACTIVE staff member whose role is 'owner'. Reads the
-- live pos_staff row, not a JWT claim, so a demoted/disabled owner loses
-- access immediately rather than at token expiry.
CREATE OR REPLACE FUNCTION is_pos_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pos_staff s
    WHERE s.id = nullif(auth.jwt() ->> 'pos_staff_id', '')::uuid
      AND s.role = 'owner'
      AND s.status = 'active'
  )
$$;

REVOKE ALL ON FUNCTION is_pos_session(), is_pos_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_pos_session(), is_pos_owner() TO authenticated;

-- ---- Storage policies: same tenant/folder rule as phase15, PLUS owner-only for POS sessions.
DROP POLICY IF EXISTS business_logos_tenant_write ON storage.objects;
CREATE POLICY business_logos_tenant_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'business-logos'
    AND (NOT is_pos_session() OR is_pos_owner())
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()
    )
  );

DROP POLICY IF EXISTS business_logos_tenant_update ON storage.objects;
CREATE POLICY business_logos_tenant_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'business-logos'
    AND (NOT is_pos_session() OR is_pos_owner())
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()
    )
  )
  WITH CHECK (
    bucket_id = 'business-logos'
    AND (NOT is_pos_session() OR is_pos_owner())
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()
    )
  );

DROP POLICY IF EXISTS business_logos_tenant_delete ON storage.objects;
CREATE POLICY business_logos_tenant_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'business-logos'
    AND (NOT is_pos_session() OR is_pos_owner())
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()
    )
  );

-- ---- Bucket-level limits (enforced by Supabase Storage, independent of the client).
-- SVG is intentionally absent: it can carry script.
UPDATE storage.buckets
   SET file_size_limit = 2097152,
       allowed_mime_types = ARRAY['image/png', 'image/jpeg']
 WHERE id = 'business-logos';

-- ---- lb_businesses identity guard.
CREATE OR REPLACE FUNCTION guard_business_identity() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF is_pos_session() AND NOT is_pos_owner() THEN
    IF (NEW.name, NEW.phone, NEW.email, NEW.address, NEW.currency, NEW.time_zone, NEW.logo_url)
       IS DISTINCT FROM
       (OLD.name, OLD.phone, OLD.email, OLD.address, OLD.currency, OLD.time_zone, OLD.logo_url) THEN
      RAISE EXCEPTION 'Only the business owner can change business details.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_business_identity ON lb_businesses;
CREATE TRIGGER trg_guard_business_identity
  BEFORE UPDATE ON lb_businesses
  FOR EACH ROW EXECUTE FUNCTION guard_business_identity();

-- ASSUMPTIONS TO CONFIRM ON STAGING (not verifiable from source):
--   * lb_businesses has columns name, phone, email, address, currency,
--     time_zone, logo_url (settingsService already reads/writes all of them).
--   * pos_staff.status = 'active' / role = 'owner' (matches register_pos_tenant()).
--   * Existing UPDATE RLS on lb_businesses scopes to the caller's tenant.
--     This trigger is an ADDITIONAL guard, not a replacement for that.
