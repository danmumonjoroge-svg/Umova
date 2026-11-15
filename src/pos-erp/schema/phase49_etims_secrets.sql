-- phase49_etims_secrets.sql   -- NOT YET RUN. STAGING first. Re-runnable. Needs phase48.
-- Per-business KRA communication key storage. Multi-tenant rule: a key is stored and read ONLY by business_id; there is no
-- platform-wide key and no fallback. Browser roles (anon/authenticated) have NO access of any kind; only service_role (Edge Functions).
-- Storage: Supabase Vault when the extension is enabled (key encrypted at rest, only a reference id kept here); otherwise the
-- same deny-all-table pattern as lb_mpesa_secrets. The choice is automatic; callers never see the difference.
-- ROLLBACK: DROP FUNCTION etims_set_key(uuid,text), etims_get_key(uuid), etims_clear_key(uuid); DROP TABLE lb_etims_secrets;

DO $$ BEGIN
  IF to_regclass('public.lb_etims_config') IS NULL THEN RAISE EXCEPTION 'Run phase48_etims_foundation.sql first.'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS lb_etims_secrets (
  business_id     uuid PRIMARY KEY REFERENCES lb_businesses(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  comm_key        text,            -- only used when Vault is not available
  vault_secret_id uuid,            -- only used when Vault is available
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lb_etims_secrets ENABLE ROW LEVEL SECURITY;           -- RLS on, NO policies: nothing signed in can read or write
REVOKE ALL ON lb_etims_secrets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION etims_set_key(p_business uuid, p_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid; v_vault boolean := to_regclass('vault.secrets') IS NOT NULL; v_id uuid; v_old uuid;
BEGIN
  IF coalesce(btrim(p_key),'') = '' THEN RAISE EXCEPTION 'KEY_EMPTY' USING ERRCODE = '22023'; END IF;
  SELECT tenant_id INTO v_tenant FROM lb_etims_config WHERE business_id = p_business;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'ETIMS_NOT_SET_UP' USING ERRCODE = 'P0001'; END IF;
  IF v_vault THEN
    SELECT vault_secret_id INTO v_old FROM lb_etims_secrets WHERE business_id = p_business;
    EXECUTE 'SELECT vault.create_secret($1, $2)' INTO v_id USING p_key, 'etims:' || p_business::text || ':' || gen_random_uuid()::text;
    INSERT INTO lb_etims_secrets (business_id, tenant_id, vault_secret_id, comm_key) VALUES (p_business, v_tenant, v_id, NULL)
      ON CONFLICT (business_id) DO UPDATE SET vault_secret_id = EXCLUDED.vault_secret_id, comm_key = NULL, updated_at = now();
    IF v_old IS NOT NULL THEN EXECUTE 'DELETE FROM vault.secrets WHERE id = $1' USING v_old; END IF;
  ELSE
    INSERT INTO lb_etims_secrets (business_id, tenant_id, comm_key) VALUES (p_business, v_tenant, p_key)
      ON CONFLICT (business_id) DO UPDATE SET comm_key = EXCLUDED.comm_key, updated_at = now();
  END IF;
  UPDATE lb_etims_config SET has_comm_key = true, updated_at = now() WHERE business_id = p_business;
END $$;

-- Returns THIS business's key, or NULL. There is no other source: a business without its own key gets NULL, never a default.
CREATE OR REPLACE FUNCTION etims_get_key(p_business uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r lb_etims_secrets; v text;
BEGIN
  SELECT * INTO r FROM lb_etims_secrets WHERE business_id = p_business;
  IF r.business_id IS NULL THEN RETURN NULL; END IF;
  IF r.vault_secret_id IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1' INTO v USING r.vault_secret_id;
    RETURN v;
  END IF;
  RETURN r.comm_key;
END $$;

CREATE OR REPLACE FUNCTION etims_clear_key(p_business uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old uuid;
BEGIN
  SELECT vault_secret_id INTO v_old FROM lb_etims_secrets WHERE business_id = p_business;
  IF v_old IS NOT NULL THEN EXECUTE 'DELETE FROM vault.secrets WHERE id = $1' USING v_old; END IF;
  DELETE FROM lb_etims_secrets WHERE business_id = p_business;
  UPDATE lb_etims_config SET has_comm_key = false, enabled = false, updated_at = now() WHERE business_id = p_business;
END $$;

REVOKE ALL ON FUNCTION etims_set_key(uuid,text), etims_get_key(uuid), etims_clear_key(uuid) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION etims_set_key(uuid,text), etims_get_key(uuid), etims_clear_key(uuid) TO service_role;
  END IF;
END $$;
