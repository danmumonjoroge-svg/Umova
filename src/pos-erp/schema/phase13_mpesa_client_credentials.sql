-- ============================================================
-- Phase 13 -- Let a business owner set up their OWN Daraja credentials
-- from inside the app (closes the gap flagged in Phase 12's audit
-- entry: "Single Daraja app for the whole deployment, not per-tenant
-- credentials").
--
-- THE PROBLEM THIS FIXES: Phase 12 assumed one shared Daraja app for
-- the entire platform, with the consumer key/secret/passkey set once,
-- by whoever runs the deployment, via `supabase secrets set`. That
-- means no business owner could ever configure their own till/paybill's
-- M-Pesa integration themselves -- exactly the ease-of-use gap raised
-- in conversation.
--
-- THE FIX, and why it's a new table rather than new columns on the
-- existing lb_mpesa_config: lb_mpesa_config is a normal RLS-scoped
-- table -- any authenticated POS session for that business can read
-- every column of their own row via the normal Supabase client. That's
-- fine for a shortcode (customers already see it on receipts) but NOT
-- fine for a Daraja consumer secret or passkey -- brief section 34 is
-- explicit: "Do not expose sensitive credentials to normal frontend
-- code." A value any browser JS in that business's session can read
-- back is, for this purpose, exposed to frontend code, even if RLS
-- correctly keeps other TENANTS out.
--
-- So lb_mpesa_secrets below has RLS enabled with ZERO policies. In
-- Postgres RLS, that means default-deny for every role except the
-- table owner / service_role (which bypasses RLS entirely). No
-- anon-key or authenticated-JWT request -- from any tenant, including
-- the row's own business -- can SELECT, INSERT, or UPDATE this table
-- directly. The ONLY way in or out is through the two Edge Functions
-- below, both of which use the service-role key specifically to reach
-- past this wall, and neither of which ever sends a secret value back
-- to a browser once saved.
--
-- (A stronger alternative is Supabase Vault, which encrypts secrets at
-- rest with pgsodium. Not used here because Vault isn't enabled on
-- every Supabase plan/project by default, and this deny-all-RLS pattern
-- needs nothing beyond what every project already has. If Vault is
-- available in your project, migrating lb_mpesa_secrets's three columns
-- into vault.secrets is a reasonable future hardening step -- noted,
-- not required.)
--
-- Run order: migration #11, after phase12_mpesa.sql.
-- ============================================================

-- ---------- lb_mpesa_secrets ----------

CREATE TABLE IF NOT EXISTS lb_mpesa_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  consumer_key text,
  consumer_secret text,
  passkey text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (business_id)
);

ALTER TABLE lb_mpesa_secrets ENABLE ROW LEVEL SECURITY;
-- Deliberately NO CREATE POLICY statement here. See header note --
-- this is default-deny-for-everyone-but-service-role by design, not an
-- oversight. Do not add a permissive policy to this table.

-- ---------- lb_mpesa_config: status flags, no secret VALUES ----------
-- Lets the Settings screen show "Consumer secret: saved (updated 2
-- days ago)" without ever reading the secret itself back from
-- lb_mpesa_secrets -- these three booleans are the only thing that
-- crosses from the secrets table back into something the owner's
-- browser can query directly.

ALTER TABLE lb_mpesa_config ADD COLUMN IF NOT EXISTS has_consumer_key boolean NOT NULL DEFAULT false;
ALTER TABLE lb_mpesa_config ADD COLUMN IF NOT EXISTS has_consumer_secret boolean NOT NULL DEFAULT false;
ALTER TABLE lb_mpesa_config ADD COLUMN IF NOT EXISTS has_passkey boolean NOT NULL DEFAULT false;
ALTER TABLE lb_mpesa_config ADD COLUMN IF NOT EXISTS credentials_updated_at timestamptz;

COMMENT ON COLUMN lb_mpesa_config.has_consumer_secret IS
  'Whether a Daraja consumer secret is on file in lb_mpesa_secrets -- NEVER the value itself. Set only by the mpesa-save-config Edge Function.';
