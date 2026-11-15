// supabase/functions/comm-send/index.ts
//
// "The owner pressed Send." Body: { log_id }. Needs the user's login (verify-jwt ON, the default).
//
// 1. Reads the prepared outbox row AS THE USER (row-level security: only their own business's rows).
// 2. Checks they may send this kind of message (comm_can_send).
// 3. Re-checks the transaction is still current (debt not paid, goods not received, appointment not cancelled...).
// 4. Sends through the server-side provider and records exactly what the provider said.
//
// It never changes a sale, payment, stock or account. If a provider is not configured it answers 424 and the
// message stays "prepared": nothing is recorded as sent.
//
// NOT TESTED against live providers: no credentials were available.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendLogRow } from "../_shared/comm/sender.js";
import { isConfigured } from "../_shared/comm/providers.js";
import { composeForJob, evaluateJob } from "../_shared/comm/dispatcher.js";
import * as L from "../_shared/comm/loaders.js";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "METHOD" });
  const auth = req.headers.get("Authorization");
  if (!auth) return json(401, { error: "NO_LOGIN", message: "Please sign in again." });
  let logId: string | undefined;
  try { logId = (await req.json())?.log_id; } catch { /* */ }
  if (!logId) return json(400, { error: "BAD_REQUEST", message: "Missing message id." });

  const user = createClient(env("SUPABASE_URL")!, env("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: row, error } = await user.from("lb_communication_log").select("*").eq("id", logId).maybeSingle();
  if (error || !row) return json(404, { error: "NOT_FOUND", message: "That message was not found." });

  const can = await user.rpc("comm_can_send", { p_kind: row.recipient_kind || "CUSTOMER" });
  if (can.error || can.data !== true) return json(403, { error: "FORBIDDEN", message: "You do not have permission to send messages." });
  if (!["QUEUED", "FAILED", "OPENED"].includes(row.status) || (row.provider && row.provider !== "MANUAL" && row.status !== "FAILED")) return json(409, { error: "ALREADY_HANDLED", message: "This message has already been sent or closed." });
  if (!isConfigured(row.channel, env)) return json(424, { error: "PROVIDER_NOT_CONFIGURED", message: `${row.channel === "EMAIL" ? "Email" : row.channel === "SMS" ? "SMS" : "WhatsApp"} sending is not set up yet. You can send it from your own phone instead.` });

  // re-check the transaction is still current
  try {
    if (row.purpose && row.reference_id) {
      const biz = await L.loadBusiness(user, { tenantId: row.tenant_id, businessId: row.business_id });
      const prefs = await L.loadPrefs(user, { tenantId: row.tenant_id, businessId: row.business_id });
      const job = { tenant_id: row.tenant_id, purpose: row.purpose, channel: row.channel, customer_id: row.customer_id, supplier_id: row.supplier_id, recipient_kind: row.recipient_kind, reference_type: row.reference_type, reference_id: row.reference_id, dedupe_key: "" };
      const c = await composeForJob({ svc: user, job, biz, prefs, templates: [], now: new Date() });
      const ev = evaluateJob(c);
      if (ev.action === "SUPPRESS") return json(409, { error: "NO_LONGER_NEEDED", message: ev.reason });
    }
  } catch (e) { console.warn("[comm-send] recheck skipped", (e as Error)?.message); }

  const svc = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const biz = await L.loadBusiness(svc, { tenantId: row.tenant_id, businessId: row.business_id });
  const prefs = await L.loadPrefs(svc, { tenantId: row.tenant_id, businessId: row.business_id });
  const out = await sendLogRow({ svc, row, env, businessName: biz.name, senderId: prefs.sms_sender_id });
  if (out.state === "SUBMITTED") return json(200, { ok: true, status: "SUBMITTED" });
  return json(out.state === "FAILED" ? 502 : 424, { ok: false, error: out.code, message: out.message, retryable: !!out.transient });
});
