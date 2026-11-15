// supabase/functions/etims-submit/index.ts
// The worker that sends queued tax invoices (spec: /saveTrnsSalesOsdc). Called by a schedule (every minute) with the worker secret,
// or by an owner pressing "Send now" (then it only touches that owner's business).
// Deploy:  supabase functions deploy etims-submit --use-api --no-verify-jwt        (the schedule has no user login; the secret below guards it)
// Secrets: ETIMS_WORKER_SECRET (long random string)
//
// SAFETY RULES (the database enforces the state machine; this file only reports what happened):
//   * Sends the STORED body with this business's OWN key (loaded by business_id). Nothing is rebuilt from live data.
//   * Failed to connect (nothing sent)        -> RETRY later, same invoice number and body.
//   * Timeout / lost connection after sending -> UNCONFIRMED: parked for the owner. Never auto-resent.
//   * KRA answered with a business rejection  -> REJECTED with KRA's reason, for the owner to fix and resend.
//   * KRA says it already has it (994) on a resend -> treated as accepted (KRA holds the invoice).
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { admin, cors, failure, json, kraCall, kraMessage, loadOwnKey, resolveCaller } from "../_shared/etims.ts";

const WORKER_SECRET = Deno.env.get("ETIMS_WORKER_SECRET") || "";
const BATCH = 20, PARALLEL = 5;

function sameSecret(a: string, b: string) {          // constant-time compare
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const AUTH_CODES = new Set(["900", "901", "902", "903"]);

async function sendOne(inv: any) {
  const t0 = Date.now();
  const rec = (outcome: string, http: number | null, code: string, msg: string, data: unknown = null) =>
    admin.rpc("etims_record_result", { p_invoice: inv.id, p_outcome: outcome, p_http: http, p_result_code: code, p_duration_ms: Date.now() - t0, p_message: msg, p_kra_data: data });
  try {
    const { data: cfg } = await admin.from("lb_etims_config").select("kra_pin,branch_id,environment,business_id").eq("business_id", inv.business_id).maybeSingle();
    if (!cfg) return await rec("AUTH", null, "NO_CONFIG", "Tax invoice settings are missing.");
    let cmcKey: string;
    try { cmcKey = await loadOwnKey(inv.business_id); } catch { return await rec("AUTH", null, "NO_KEY", "This business is not connected to KRA. Connect again in Settings."); }

    // credentials are added at send time only; they are never part of the stored body
    const payload = { tin: cfg.kra_pin, bhfId: cfg.branch_id, cmcKey, ...(inv.snapshot?.body ?? {}) };
    let res;
    try { res = await kraCall(cfg.environment, "/saveTrnsSalesOsdc", payload); }
    catch (e: any) {
      if (e?.code === "KRA_UNREACHABLE") return await rec("RETRY", null, "KRA_UNREACHABLE", "Could not reach KRA. It will try again.");
      return await rec("UNCONFIRMED", null, "KRA_TIMEOUT", "KRA did not answer. Check with KRA before sending again.");
    }
    const code = String(res.body?.resultCd ?? "");
    if (code === "000") {
      const d = res.body?.data ?? {};
      return await rec("ACCEPTED", res.httpStatus, "000", "Accepted by KRA", {
        curRcptNo: d.curRcptNo ?? null, totRcptNo: d.totRcptNo ?? null, intrlData: d.intrlData ?? null, rcptSign: d.rcptSign ?? null, sdcDateTime: d.sdcDateTime ?? null,
      });
    }
    if (code === "994" && inv.attempt_count > 1) return await rec("ACCEPTED", res.httpStatus, "994", "KRA already had this invoice.", null);
    if (AUTH_CODES.has(code)) return await rec("AUTH", res.httpStatus, code, kraMessage(code));
    if (code) return await rec("REJECTED", res.httpStatus, code, String(res.body?.resultMsg || kraMessage(code)));
    // no usable answer
    if ([502, 503, 504].includes(res.httpStatus)) return await rec("RETRY", res.httpStatus, `HTTP_${res.httpStatus}`, "KRA is unavailable. It will try again.");
    return await rec("UNCONFIRMED", res.httpStatus, `HTTP_${res.httpStatus}`, "KRA sent no usable answer. Check with KRA before sending again.");
  } catch (e: any) {
    console.error("[etims-submit] unexpected", e?.code || e?.message);
    return await rec("UNCONFIRMED", null, "WORKER_ERROR", "The send was interrupted. Check with KRA before sending again.");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, code: "METHOD" }, 405);
  try {
    let businessId: string | null = null;
    if (!sameSecret(req.headers.get("x-etims-worker-secret") || "", WORKER_SECRET)) {
      const c = await resolveCaller(req, "settings.manage");    // an owner pressing "Send now": only their own business
      businessId = c.businessId;
    }
    let q = admin.from("lb_etims_config").select("business_id").eq("enabled", true).eq("status", "ACTIVE");
    if (businessId) q = q.eq("business_id", businessId);
    const { data: biz } = await q.limit(200);
    for (const b of biz ?? []) await admin.rpc("etims_sweep", { p_business: b.business_id, p_limit: 50 });

    const { data: due, error } = await admin.rpc("etims_claim_due", { p_limit: BATCH, p_worker: crypto.randomUUID(), p_lease_seconds: 120, p_business: businessId });
    if (error) throw { status: 500, code: "CLAIM_FAILED" };
    const rows = due ?? [];
    for (let i = 0; i < rows.length; i += PARALLEL) await Promise.all(rows.slice(i, i + PARALLEL).map(sendOne));
    return json(req, { ok: true, processed: rows.length });
  } catch (e) { return failure(req, e); }
});
