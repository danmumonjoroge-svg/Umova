-- phase51_etims_integration_token.sql   -- NOT YET RUN. Re-runnable. Needs phase48.
-- KRA's service-request form asks for an "Integration Token". Whether KRA validates it, and who must issue it, is NOT confirmed
-- (waiting on KRA's answer). This gives each business its OWN random token the owner can copy into that form. If KRA says the token
-- must come from somewhere else, nothing else in the system depends on this value.
-- Kept in its own table, deny-all RLS (cashiers cannot read it); only the owner/manager RPC below returns it.
-- ROLLBACK: DROP FUNCTION pos_etims_integration_token(uuid,boolean); DROP TABLE lb_etims_integration_tokens;
CREATE TABLE IF NOT EXISTS lb_etims_integration_tokens (
  business_id uuid PRIMARY KEY REFERENCES lb_businesses(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  token       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  rotated_at  timestamptz
);
ALTER TABLE lb_etims_integration_tokens ENABLE ROW LEVEL SECURITY;      -- no policies: nothing signed in can read it directly
REVOKE ALL ON lb_etims_integration_tokens FROM PUBLIC, anon, authenticated;

-- Returns THIS business's token, creating it the first time. p_rotate = true replaces it (the old one stops being ours).
CREATE OR REPLACE FUNCTION pos_etims_integration_token(p_business_id uuid, p_rotate boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_tok text;
BEGIN
  PERFORM pos_require('settings.manage');
  IF v_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'This business is not yours.' USING ERRCODE = '42501';
  END IF;
  SELECT token INTO v_tok FROM lb_etims_integration_tokens WHERE business_id = p_business_id;
  IF v_tok IS NOT NULL AND NOT p_rotate THEN RETURN v_tok; END IF;
  v_tok := upper(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));     -- 64 hex characters, random per business
  INSERT INTO lb_etims_integration_tokens (business_id, tenant_id, token) VALUES (p_business_id, v_tenant, v_tok)
    ON CONFLICT (business_id) DO UPDATE SET token = EXCLUDED.token, rotated_at = now();
  BEGIN
    INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id)
    VALUES (v_tenant, 'staff', nullif(auth.jwt() ->> 'pos_staff_id','')::uuid, CASE WHEN p_rotate THEN 'ETIMS_TOKEN_ROTATED' ELSE 'ETIMS_TOKEN_CREATED' END, 'lb_businesses', p_business_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN v_tok;
END $$;
REVOKE ALL ON FUNCTION pos_etims_integration_token(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_etims_integration_token(uuid,boolean) TO authenticated;
