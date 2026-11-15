-- ============================================================
-- ELIMU 003 — guardians (parents / carers)
--
-- Run AFTER 002. Additive and re-runnable.
--
--   elimu_guardians                  one row per PERSON, however many children they have
--   elimu_guardian_contacts          any number of phones / emails, normalised and validated by the database
--   elimu_guardian_channel_consent   per-channel permission to be contacted (SMS / EMAIL / WHATSAPP / PHONE)
--   elimu_student_guardians          the many-to-many link, with relationship, rank (1 = primary, 2 = secondary),
--                                    emergency-contact flag and per-topic communication flags
--
-- REUSE, NOT DUPLICATION
--   * No user accounts are created. A guardian is a contact record; guardians do not sign in to the POS (see INTEGRATION.md,
--     "Parent portal").
--   * elimu_guardians.customer_id optionally points at the existing lb_customers row so the Fees module can reuse the
--     receivables ledger, M-Pesa matching and statements. Contact details are NOT copied there; Elimu keeps its own because a
--     guardian has several, each with its own consent.
--
-- DUPLICATE PREVENTION
--   One phone number (or email) can be the PRIMARY contact of only one guardian in a school. A second guardian who genuinely
--   shares the family phone adds it as a non-primary contact. elimu_find_guardian_matches() lets the app warn before creating a
--   second record for the same person.
-- ============================================================

-- Mirrors normalizeMsisdn() in supabase/functions/_shared/comm/render.js (a test proves they agree on a table of inputs).
CREATE OR REPLACE FUNCTION elimu_normalize_msisdn(p_raw text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; d text; intl text;
BEGIN
  IF p_raw IS NULL THEN RETURN NULL; END IF;
  s := btrim(p_raw);
  d := regexp_replace(s, '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF length(d) = 12 AND d LIKE '254%' AND substr(d, 4, 1) IN ('7','1') THEN RETURN d; END IF;
  IF length(d) = 10 AND d LIKE '0%' AND substr(d, 2, 1) IN ('7','1') THEN RETURN '254' || substr(d, 2); END IF;
  IF length(d) = 9 AND substr(d, 1, 1) IN ('7','1') THEN RETURN '254' || d; END IF;
  IF (s LIKE '+%' OR s LIKE '00%') AND d NOT LIKE '254%' THEN
    intl := CASE WHEN s LIKE '00%' THEN substr(d, 3) ELSE d END;
    IF length(intl) BETWEEN 8 AND 15 AND intl NOT LIKE '0%' THEN RETURN intl; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION elimu_normalize_email(p_raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_raw ~ '^\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}\s*$' THEN lower(btrim(p_raw)) END
$$;

CREATE TABLE IF NOT EXISTS elimu_guardians (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  business_id        uuid NOT NULL REFERENCES lb_businesses(id),
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  preferred_channel  text CHECK (preferred_channel IS NULL OR preferred_channel IN ('SMS','EMAIL','WHATSAPP','PHONE')),
  secondary_channels text[] NOT NULL DEFAULT '{}' CHECK (secondary_channels <@ ARRAY['SMS','EMAIL','WHATSAPP','PHONE']),
  customer_id        uuid REFERENCES lb_customers(id),   -- optional link for fees / receivables
  notes              text,
  archived_at        timestamptz,
  created_by uuid, updated_by uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_guardian_names_chk CHECK (length(btrim(first_name)) > 0 AND length(btrim(last_name)) > 0),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_elimu_guardians_name ON elimu_guardians (tenant_id, lower(last_name), lower(first_name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_guardian_customer ON elimu_guardians (tenant_id, customer_id) WHERE customer_id IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS elimu_guardian_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  guardian_id      uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('PHONE','EMAIL')),
  value            text NOT NULL,                    -- as typed (trimmed)
  value_normalized text NOT NULL,                    -- phones: digits with country code, no plus (254712345678); emails: lower case
  label            text CHECK (label IS NULL OR label IN ('MOBILE','WORK','HOME','OTHER')),
  is_primary       boolean NOT NULL DEFAULT false,
  is_whatsapp      boolean NOT NULL DEFAULT false,   -- this number is used on WhatsApp (phones only)
  created_by uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, guardian_id) REFERENCES elimu_guardians (tenant_id, id),
  CONSTRAINT elimu_contact_valid_chk CHECK (
    (kind = 'PHONE' AND value_normalized ~ '^[0-9]{8,15}$') OR
    (kind = 'EMAIL' AND value_normalized ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$')),
  CONSTRAINT elimu_contact_whatsapp_chk CHECK (kind = 'PHONE' OR NOT is_whatsapp),
  UNIQUE (tenant_id, guardian_id, kind, value_normalized)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_contact_one_primary ON elimu_guardian_contacts (tenant_id, guardian_id, kind) WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_contact_primary_identity ON elimu_guardian_contacts (tenant_id, kind, value_normalized) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_elimu_contacts_lookup ON elimu_guardian_contacts (tenant_id, kind, value_normalized);

CREATE TABLE IF NOT EXISTS elimu_guardian_channel_consent (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  guardian_id uuid NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('SMS','EMAIL','WHATSAPP','PHONE')),
  status      text NOT NULL DEFAULT 'NOT_ASKED' CHECK (status IN ('ALLOWED','OPTED_OUT','NOT_ASKED')),
  source      text CHECK (source IS NULL OR source IN ('ADMISSION_FORM','GUARDIAN_REQUEST','SCHOOL_RECORD','OTHER')),
  note        text,
  decided_at  timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid,
  FOREIGN KEY (tenant_id, guardian_id) REFERENCES elimu_guardians (tenant_id, id),
  UNIQUE (tenant_id, guardian_id, channel)
);
COMMENT ON TABLE elimu_guardian_channel_consent IS 'No row = NOT_ASKED. OPTED_OUT always blocks (except emergencies when the school switch allows). Each change is audited in pos_audit_log with the old and new status.';

CREATE TABLE IF NOT EXISTS elimu_student_guardians (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  student_id       uuid NOT NULL,
  guardian_id      uuid NOT NULL,
  relationship     text NOT NULL CHECK (relationship IN ('MOTHER','FATHER','GUARDIAN','GRANDPARENT','AUNT','UNCLE','SIBLING','SPONSOR','OTHER')),
  relationship_note text,
  guardian_rank    smallint CHECK (guardian_rank BETWEEN 1 AND 9),   -- 1 primary, 2 secondary, 3+ others; NULL on insert = next free rank (trigger), never NULL afterwards
  is_emergency_contact boolean NOT NULL DEFAULT false,
  receives_general_communications  boolean NOT NULL DEFAULT true,
  receives_fee_communications      boolean NOT NULL DEFAULT true,
  receives_academic_communications boolean NOT NULL DEFAULT true,
  started_on       date NOT NULL DEFAULT current_date,
  ended_on         date,                                -- a link is ended, never deleted
  created_by uuid, updated_by uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_id)  REFERENCES elimu_students (tenant_id, id),
  FOREIGN KEY (tenant_id, guardian_id) REFERENCES elimu_guardians (tenant_id, id),
  CONSTRAINT elimu_sg_dates_chk CHECK (ended_on IS NULL OR ended_on >= started_on),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_sg_active_pair ON elimu_student_guardians (tenant_id, student_id, guardian_id) WHERE ended_on IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_sg_rank ON elimu_student_guardians (tenant_id, student_id, guardian_rank) WHERE ended_on IS NULL AND guardian_rank IN (1, 2);
CREATE INDEX IF NOT EXISTS idx_elimu_sg_guardian ON elimu_student_guardians (tenant_id, guardian_id) WHERE ended_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_sg_student ON elimu_student_guardians (tenant_id, student_id) WHERE ended_on IS NULL;

-- ---------- rules ----------
CREATE OR REPLACE FUNCTION elimu_guardian_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.first_name := btrim(NEW.first_name);
  NEW.last_name  := btrim(NEW.last_name);
  NEW.notes      := nullif(btrim(coalesce(NEW.notes, '')), '');
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lb_customers c WHERE c.id = NEW.customer_id AND c.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'That customer record does not belong to this school.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION elimu_contact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.value := btrim(NEW.value);
  NEW.value_normalized := CASE NEW.kind WHEN 'PHONE' THEN elimu_normalize_msisdn(NEW.value) WHEN 'EMAIL' THEN elimu_normalize_email(NEW.value) END;
  IF NEW.value_normalized IS NULL THEN
    IF NEW.kind = 'PHONE' THEN RAISE EXCEPTION 'That is not a valid phone number.' USING ERRCODE = '22023'; END IF;
    RAISE EXCEPTION 'That is not a valid email address.' USING ERRCODE = '22023';
  END IF;
  -- the first contact of a kind becomes primary, unless another guardian already uses it as their primary
  IF TG_OP = 'INSERT' AND NOT NEW.is_primary
     AND NOT EXISTS (SELECT 1 FROM elimu_guardian_contacts c WHERE c.tenant_id = NEW.tenant_id AND c.guardian_id = NEW.guardian_id AND c.kind = NEW.kind AND c.is_primary)
     AND NOT EXISTS (SELECT 1 FROM elimu_guardian_contacts c WHERE c.tenant_id = NEW.tenant_id AND c.kind = NEW.kind AND c.value_normalized = NEW.value_normalized AND c.is_primary) THEN
    NEW.is_primary := true;
  END IF;
  -- choosing a new primary demotes the old one (same guardian, same kind)
  IF NEW.is_primary THEN
    UPDATE elimu_guardian_contacts SET is_primary = false, updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND guardian_id = NEW.guardian_id AND kind = NEW.kind AND is_primary AND id <> NEW.id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION elimu_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.decided_at := now();
  NEW.recorded_by := auth.uid();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION elimu_sg_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_rank smallint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.guardian_rank IS NULL THEN   -- next free rank: 1, 2, then 3 and up
      SELECT min(g) INTO v_rank FROM generate_series(1, 9) g
       WHERE NOT EXISTS (SELECT 1 FROM elimu_student_guardians x WHERE x.tenant_id = NEW.tenant_id AND x.student_id = NEW.student_id AND x.ended_on IS NULL AND x.guardian_rank = g AND g IN (1, 2));
      NEW.guardian_rank := coalesce(v_rank, 9);
    END IF;
  ELSE
    IF NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.guardian_id IS DISTINCT FROM OLD.guardian_id THEN
      RAISE EXCEPTION 'A link cannot be moved to another student or guardian; end it and add a new one.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION elimu_sg_rank_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.guardian_rank IS NULL THEN RAISE EXCEPTION 'guardian_rank is required.' USING ERRCODE = '23502'; END IF; RETURN NEW; END $$;

-- ---------- triggers ----------
DO $$
DECLARE r record; t text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('elimu_guardians','guardians.manage','elimu_guardian_guard'),
      ('elimu_guardian_contacts','guardians.manage','elimu_contact_guard'),
      ('elimu_guardian_channel_consent','guardians.manage','elimu_consent_guard'),
      ('elimu_student_guardians','guardians.manage','elimu_sg_guard')) AS v(tbl, perm, guard)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_1tenant ON %1$s', r.tbl);
    EXECUTE format('CREATE TRIGGER trg_%1$s_1tenant BEFORE INSERT OR UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION elimu_tenant_guard()', r.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_2perm ON %1$s', r.tbl);
    EXECUTE format('CREATE TRIGGER trg_%1$s_2perm BEFORE INSERT OR UPDATE OR DELETE ON %1$s FOR EACH ROW EXECUTE FUNCTION elimu_enforce(%2$L)', r.tbl, r.perm);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_3guard ON %1$s', r.tbl);
    EXECUTE format('CREATE TRIGGER trg_%1$s_3guard BEFORE INSERT OR UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION %2$I()', r.tbl, r.guard);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['elimu_guardians','elimu_guardian_contacts','elimu_student_guardians'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_4updated ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_4updated BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION elimu_set_updated_at()', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_student_guardians_5rank ON elimu_student_guardians;
CREATE TRIGGER trg_elimu_student_guardians_5rank BEFORE INSERT OR UPDATE ON elimu_student_guardians FOR EACH ROW EXECUTE FUNCTION elimu_sg_rank_required();

DROP TRIGGER IF EXISTS trg_elimu_guardians_audit ON elimu_guardians;
CREATE TRIGGER trg_elimu_guardians_audit AFTER INSERT OR UPDATE ON elimu_guardians FOR EACH ROW EXECUTE FUNCTION elimu_audit('guardian');
DROP TRIGGER IF EXISTS trg_elimu_guardian_contacts_audit ON elimu_guardian_contacts;
CREATE TRIGGER trg_elimu_guardian_contacts_audit AFTER INSERT OR UPDATE OR DELETE ON elimu_guardian_contacts FOR EACH ROW EXECUTE FUNCTION elimu_audit('guardian_contact', 'kind', 'is_primary');
DROP TRIGGER IF EXISTS trg_elimu_guardian_consent_audit ON elimu_guardian_channel_consent;
CREATE TRIGGER trg_elimu_guardian_consent_audit AFTER INSERT OR UPDATE ON elimu_guardian_channel_consent FOR EACH ROW EXECUTE FUNCTION elimu_audit('guardian_consent', 'channel', 'status');
DROP TRIGGER IF EXISTS trg_elimu_student_guardians_audit ON elimu_student_guardians;
CREATE TRIGGER trg_elimu_student_guardians_audit AFTER INSERT OR UPDATE ON elimu_student_guardians FOR EACH ROW EXECUTE FUNCTION elimu_audit('student_guardian', 'guardian_rank', 'ended_on');

-- ---------- row level security ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('elimu_guardians','guardians.view', false), ('elimu_guardian_contacts','guardians.view', true),
      ('elimu_guardian_channel_consent','guardians.view', true), ('elimu_student_guardians','students.view', false)) AS v(tbl, view_action, can_delete)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_select', r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = (SELECT get_current_tenant_id()) AND (SELECT elimu_can(%L)))', r.tbl || '_select', r.tbl, r.view_action);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_insert', r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = (SELECT get_current_tenant_id()))', r.tbl || '_insert', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_update', r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = (SELECT get_current_tenant_id())) WITH CHECK (tenant_id = (SELECT get_current_tenant_id()))', r.tbl || '_update', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_delete', r.tbl);
    IF r.can_delete THEN   -- contact numbers and consent rows are plain attributes; guardians and links are archived / ended instead
      EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (tenant_id = (SELECT get_current_tenant_id()))', r.tbl || '_delete', r.tbl);
    END IF;
  END LOOP;
END $$;

-- ---------- helpers ----------
-- Swap which guardian is primary for a student without tripping the one-primary rule.
CREATE OR REPLACE FUNCTION elimu_set_primary_guardian(p_student uuid, p_guardian uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t elimu_student_guardians; o elimu_student_guardians;
BEGIN
  PERFORM elimu_require('guardians.manage');
  SELECT * INTO t FROM elimu_student_guardians WHERE tenant_id = get_current_tenant_id() AND student_id = p_student AND guardian_id = p_guardian AND ended_on IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That guardian is not linked to this student.' USING ERRCODE = 'P0002'; END IF;
  IF t.guardian_rank = 1 THEN RETURN; END IF;
  SELECT * INTO o FROM elimu_student_guardians WHERE tenant_id = t.tenant_id AND student_id = p_student AND ended_on IS NULL AND guardian_rank = 1 FOR UPDATE;
  IF FOUND THEN UPDATE elimu_student_guardians SET guardian_rank = 9 WHERE id = o.id; END IF;
  UPDATE elimu_student_guardians SET guardian_rank = 1 WHERE id = t.id;
  IF o.id IS NOT NULL THEN UPDATE elimu_student_guardians SET guardian_rank = t.guardian_rank WHERE id = o.id; END IF;
END $$;

-- Possible existing records for the same person (phone/email on any contact, or the same name). SECURITY INVOKER, so RLS applies.
CREATE OR REPLACE FUNCTION elimu_find_guardian_matches(p_first text DEFAULT NULL, p_last text DEFAULT NULL, p_phone text DEFAULT NULL, p_email text DEFAULT NULL, p_exclude uuid DEFAULT NULL)
RETURNS TABLE (guardian_id uuid, first_name text, last_name text, matched_on text)
LANGUAGE sql STABLE AS $$
  SELECT g.id, g.first_name, g.last_name, 'PHONE'::text FROM elimu_guardians g
   WHERE g.tenant_id = (SELECT get_current_tenant_id()) AND g.archived_at IS NULL AND (p_exclude IS NULL OR g.id <> p_exclude)
     AND elimu_normalize_msisdn(p_phone) IS NOT NULL
     AND EXISTS (SELECT 1 FROM elimu_guardian_contacts c WHERE c.tenant_id = g.tenant_id AND c.guardian_id = g.id AND c.kind = 'PHONE' AND c.value_normalized = elimu_normalize_msisdn(p_phone))
  UNION ALL
  SELECT g.id, g.first_name, g.last_name, 'EMAIL' FROM elimu_guardians g
   WHERE g.tenant_id = (SELECT get_current_tenant_id()) AND g.archived_at IS NULL AND (p_exclude IS NULL OR g.id <> p_exclude)
     AND elimu_normalize_email(p_email) IS NOT NULL
     AND EXISTS (SELECT 1 FROM elimu_guardian_contacts c WHERE c.tenant_id = g.tenant_id AND c.guardian_id = g.id AND c.kind = 'EMAIL' AND c.value_normalized = elimu_normalize_email(p_email))
  UNION ALL
  SELECT g.id, g.first_name, g.last_name, 'NAME' FROM elimu_guardians g
   WHERE g.tenant_id = (SELECT get_current_tenant_id()) AND g.archived_at IS NULL AND (p_exclude IS NULL OR g.id <> p_exclude)
     AND p_first IS NOT NULL AND p_last IS NOT NULL AND lower(g.first_name) = lower(btrim(p_first)) AND lower(g.last_name) = lower(btrim(p_last))
$$;

SELECT elimu_apply_grants();
