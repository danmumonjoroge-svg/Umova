// supabase/functions/comm-dispatch/index.ts
//
// The scheduler. Called every 5 minutes by pg_cron + pg_net (phase51_comm_scheduler.sql) with the header
//   x-cron-secret: <COMM_COMMUNICATION_CRON_SECRET>   -> set as COMM_CRON_SECRET
// Deploy with --no-verify-jwt (the timer sends no user login; the shared secret is the credential).
//
// It runs whether or not anyone has the app open. All logic is in _shared/comm/dispatcher.js (unit-tested).
//
// Secrets (supabase secrets set ...):  COMM_CRON_SECRET (required)
//   SMS: AT_USERNAME, AT_API_KEY, [AT_SENDER_ID]   Email: RESEND_API_KEY, COMM_EMAIL_FROM   WhatsApp API (optional): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
// Without provider secrets nothing is sent automatically: AUTO jobs are left "ready to review" in the app.
//
// NOT TESTED against live providers or a live project: no credentials were available.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { runDispatch } from "../_shared/comm/dispatcher.js";
import { timingSafeEqual } from "../_shared/comm/webhooks.js";

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("COMM_CRON_SECRET");
  if (!secret || !timingSafeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return new Response("Unauthorized", { status: 401 });
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const stats = await runDispatch({ svc, env: (k: string) => Deno.env.get(k) });
    return new Response(JSON.stringify({ ok: true, ...stats }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[comm-dispatch] run failed", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
