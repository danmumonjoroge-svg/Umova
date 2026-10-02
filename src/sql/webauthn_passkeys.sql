-- webauthn_passkeys.sql — tables behind fingerprint / passkey sign-in for ALL three Umova apps.
-- Safe to run on a project that already has webauthn_credentials / webauthn_challenges: every step is additive.
--
-- kind = 'supabase' : user_id is an auth.users id  (SACCO member app, My Business/POS)
-- kind = 'chama'    : user_id is a chama_users id  (Chama has its own accounts, no Supabase session)
-- Because of the second kind, user_id can no longer be a foreign key to auth.users — the old FK (if it exists) is dropped.

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL DEFAULT 'supabase',
  user_id       uuid NOT NULL,
  credential_id text NOT NULL UNIQUE,            -- base64url, globally unique per passkey
  public_key    text NOT NULL,                   -- base64url of the COSE public key
  counter       bigint NOT NULL DEFAULT 0,
  transports    text[],
  device_type   text,
  backed_up     boolean,
  nickname      text,
  rp_id         text,                            -- the site this passkey is bound to
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL DEFAULT 'supabase',
  user_id    uuid,                               -- NULL for usernameless sign-in (who it is isn't known yet)
  email      text,
  challenge  text NOT NULL,
  type       text NOT NULL CHECK (type IN ('registration','authentication')),
  rp_id      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

-- additive upgrades for tables created by the earlier version
ALTER TABLE webauthn_credentials ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'supabase';
ALTER TABLE webauthn_credentials ADD COLUMN IF NOT EXISTS device_type text;
ALTER TABLE webauthn_credentials ADD COLUMN IF NOT EXISTS backed_up   boolean;
ALTER TABLE webauthn_credentials ADD COLUMN IF NOT EXISTS rp_id       text;
ALTER TABLE webauthn_credentials ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE webauthn_challenges  ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'supabase';
ALTER TABLE webauthn_challenges  ADD COLUMN IF NOT EXISTS rp_id       text;
ALTER TABLE webauthn_challenges  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE webauthn_challenges  ALTER COLUMN expires_at SET DEFAULT (now() + interval '5 minutes');

-- chama_users ids are not auth.users ids: drop any FK from user_id to another table
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.conrelid IN ('webauthn_credentials'::regclass, 'webauthn_challenges'::regclass)
      AND (SELECT attname FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = c.conkey[1]) = 'user_id'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

DO $$ BEGIN
  ALTER TABLE webauthn_credentials ADD CONSTRAINT webauthn_credentials_kind_chk CHECK (kind IN ('supabase','chama'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE webauthn_challenges ADD CONSTRAINT webauthn_challenges_kind_chk CHECK (kind IN ('supabase','chama'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_webauthn_cred_user      ON webauthn_credentials (kind, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webauthn_challenge ON webauthn_challenges (challenge);
CREATE INDEX IF NOT EXISTS idx_webauthn_chal_expiry    ON webauthn_challenges (expires_at);

-- ---------- row level security ----------
-- Credentials: the owner of a Supabase account may LIST and REMOVE their own devices. Nobody can insert or edit
-- from the browser (no policy = denied) — only the Edge Functions, with the service role, after a verified biometric.
-- Chama devices have no Supabase session, so they are never readable from the browser; webauthn-manage handles them.
ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webauthn_cred_select_own ON webauthn_credentials;
CREATE POLICY webauthn_cred_select_own ON webauthn_credentials FOR SELECT TO authenticated
  USING (kind = 'supabase' AND user_id = auth.uid());
DROP POLICY IF EXISTS webauthn_cred_delete_own ON webauthn_credentials;
CREATE POLICY webauthn_cred_delete_own ON webauthn_credentials FOR DELETE TO authenticated
  USING (kind = 'supabase' AND user_id = auth.uid());

-- Challenges: service role only.
ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webauthn_chal_none ON webauthn_challenges;  -- (intentionally no policies: browser access denied)
REVOKE ALL ON webauthn_challenges FROM anon, authenticated;
REVOKE INSERT, UPDATE ON webauthn_credentials FROM anon, authenticated;
REVOKE ALL ON webauthn_credentials FROM anon;
