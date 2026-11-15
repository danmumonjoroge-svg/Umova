-- ============================================================
-- Phase 51 — server-side scheduler for communication (run after phase50)
--
-- Scheduled messages must happen when nobody has the app open, so nothing here depends on a browser. A database
-- timer (pg_cron) calls the `comm-dispatch` Edge Function every 5 minutes; the function scans, re-checks every item
-- against fresh data, and sends or prepares messages.
--
-- 1. comm_claim_jobs()   safe for two dispatchers at once (FOR UPDATE SKIP LOCKED). Service role only.
-- 2. comm_install_schedule(url)  one-time setup of the timer. Needs the pg_cron and pg_net extensions
--    (Supabase: Database > Extensions) and a secret named comm_cron_secret in Vault that matches the function's
--    COMM_CRON_SECRET. See DEPLOYMENT notes in COMMUNICATION_ENGINE.md.
-- ============================================================

CREATE OR REPLACE FUNCTION comm_claim_jobs(p_limit integer DEFAULT 25)
RETURNS SETOF lb_comm_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A run that died after claiming a job, and may or may not have reached the provider, is NOT retried blindly
  -- (that could message a customer twice). It is parked as FAILED for a person to check.
  UPDATE lb_comm_jobs SET status = 'FAILED', last_error = 'The send was interrupted and the outcome is unknown. Check the message history before sending again.', updated_at = now()
   WHERE status = 'PROCESSING' AND claimed_at < now() - interval '15 minutes';

  RETURN QUERY
  WITH due AS (
    SELECT id FROM lb_comm_jobs
     WHERE status = 'PENDING' AND run_at <= now() AND COALESCE(next_attempt_at, run_at) <= now()
     ORDER BY COALESCE(next_attempt_at, run_at)
     LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE lb_comm_jobs j SET status = 'PROCESSING', claimed_at = now(), attempts = j.attempts + 1, updated_at = now()
    FROM due WHERE j.id = due.id
  RETURNING j.*;
END $$;
REVOKE ALL ON FUNCTION comm_claim_jobs(integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION comm_install_schedule(p_function_url text, p_every text DEFAULT '*/5 * * * *')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regnamespace('net') IS NULL THEN
    RAISE EXCEPTION 'Enable the pg_cron and pg_net extensions first (Database > Extensions).';
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'comm_cron_secret') THEN
    RAISE EXCEPTION 'Create a Vault secret named comm_cron_secret first (same value as the function''s COMM_CRON_SECRET).';
  END IF;
  PERFORM cron.unschedule('comm-dispatch') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'comm-dispatch');
  PERFORM cron.schedule('comm-dispatch', p_every, format($job$
    SELECT net.http_post(url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'comm_cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 55000)
  $job$, p_function_url));
  RETURN 'scheduled: ' || p_every;
END $$;
REVOKE ALL ON FUNCTION comm_install_schedule(text, text) FROM PUBLIC, anon, authenticated;
