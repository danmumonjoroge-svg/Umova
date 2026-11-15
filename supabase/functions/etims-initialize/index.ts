// supabase/functions/etims-initialize/index.ts
// Connects THIS business's device to KRA (spec: /selectInitOsdcInfo) and stores the communication key (cmcKey) under THIS business only.
// Deploy:  supabase functions deploy etims-initialize --use-api      (JWT verification stays ON)
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { admin, auditEtims, cors, failure, json, kraCall, kraMessage, resolveCaller } from "../_shared/etims.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, code: "METHOD" }, 405);
  try {
    const c = await resolveCaller(req, "settings.manage");     // tenant + business from the login, never from the body
    const cfg = c.config;
    const tin = String(cfg.kra_pin || ""), bhfId = String(cfg.branch_id || ""), dvcSrlNo = String(cfg.device_serial || "");
    // field sizes from the spec: tin 11, bhfId 2, dvcSrlNo up to 100
    if (tin.length !== 11) return json(req, { ok: false, code: "PIN_LENGTH", message: "A KRA PIN is 11 characters. Check it in Settings." }, 422);
    if (bhfId.length !== 2) return json(req, { ok: false, code: "BRANCH_LENGTH", message: "The branch ID from KRA is 2 characters (for example 00). Check it in Settings." }, 422);
    if (!dvcSrlNo || dvcSrlNo.length > 100) return json(req, { ok: false, code: "DEVICE_SERIAL", message: "Enter the device serial you registered with KRA." }, 422);

    const { body } = await kraCall(cfg.environment, "/selectInitOsdcInfo", { tin, bhfId, dvcSrlNo });
    const code = String(body?.resultCd ?? "");
    if (code !== "000") {
      const msg = kraMessage(code);
      await admin.from("lb_etims_config").update({ status: "NEEDS_ATTENTION", last_init_at: new Date().toISOString(), last_error: msg.slice(0, 300) }).eq("business_id", c.businessId);
      return json(req, { ok: false, code: code || "NO_ANSWER", message: msg }, 422);
    }
    const cmcKey = body?.data?.info?.cmcKey ?? body?.data?.cmcKey;     // spec: InitDevice.cmcKey (nesting verified in the sandbox)
    if (!cmcKey) return json(req, { ok: false, code: "NO_KEY", message: "KRA accepted the request but sent no key. Try again." }, 502);

    const { error: ke } = await admin.rpc("etims_set_key", { p_business: c.businessId, p_key: String(cmcKey) });
    if (ke) throw { status: 500, code: "KEY_STORE_FAILED" };
    // ACTIVE = connected. `enabled` stays false: no sale is queued until go-live is switched on in a later phase.
    await admin.from("lb_etims_config").update({
      status: "ACTIVE", last_init_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null,
    }).eq("business_id", c.businessId);
    await auditEtims(c, "ETIMS_CONNECTED");
    return json(req, { ok: true, status: "ACTIVE" });         // never returns the key
  } catch (e) { return failure(req, e); }
});
