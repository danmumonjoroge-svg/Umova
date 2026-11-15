// supabase/functions/etims-sync-codes/index.ts
// Downloads KRA's own code lists (spec: /selectCodeList, /selectItemClsList) into lb_etims_code_lists. Nothing is hard-coded here:
// every code a tenant can pick comes from KRA. The table is shared by all businesses of one environment, so a recent sync is reused.
// Deploy:  supabase functions deploy etims-sync-codes --use-api
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { admin, cors, failure, json, kraCall, kraMessage, loadOwnKey, resolveCaller } from "../_shared/etims.ts";

// KRA classification (cdCls) -> the list name pos_etims_set_item_codes checks against. Classes from spec section 4.
const CLASSES: Record<string, string> = { "04": "tax_type", "05": "country", "10": "unit", "17": "packaging" };
// First full download. The spec only shows 20180523000000 as an example; confirm the proper first value with KRA (audit J.2).
const FIRST_DOWNLOAD = "20180101000000";
const REUSE_MINUTES = 60;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, code: "METHOD" }, 405);
  try {
    const c = await resolveCaller(req, "settings.manage");
    const cfg = c.config, env = cfg.environment;
    const force = (await req.json().catch(() => ({})))?.force === true;

    if (!force) {
      const { data: last } = await admin.from("lb_etims_code_lists").select("synced_at").eq("environment", env).order("synced_at", { ascending: false }).limit(1).maybeSingle();
      if (last && Date.now() - new Date(last.synced_at).getTime() < REUSE_MINUTES * 60000) return json(req, { ok: true, reused: true });
    }
    const cmcKey = await loadOwnKey(c.businessId);                 // THIS business's own key only
    const base = { tin: cfg.kra_pin, bhfId: cfg.branch_id, cmcKey, lastReqDt: FIRST_DOWNLOAD };
    const rows: any[] = [];

    const codes = await kraCall(env, "/selectCodeList", base);
    if (String(codes.body?.resultCd) !== "000") return json(req, { ok: false, code: String(codes.body?.resultCd ?? "NO_ANSWER"), message: kraMessage(String(codes.body?.resultCd ?? "")) }, 422);
    const clsList: any[] = codes.body?.data?.clsList ?? [];
    for (const cls of clsList) {
      const list = CLASSES[String(cls.cdCls)];
      if (!list) continue;
      for (const d of (cls.dtlList ?? [])) {
        if (d.useYn && d.useYn !== "Y") continue;
        rows.push({ environment: env, list_name: list, code: String(d.cd), name: d.cdNm ?? null, extra: { desc: d.cdDesc ?? null, ord: d.srtOrd ?? null }, synced_at: new Date().toISOString() });
      }
    }
    const items = await kraCall(env, "/selectItemClsList", base);
    if (String(items.body?.resultCd) === "000") {
      for (const d of (items.body?.data?.itemClsList ?? [])) {
        if (d.useYn && d.useYn !== "Y") continue;
        rows.push({ environment: env, list_name: "item_class", code: String(d.itemClsCd), name: d.itemClsNm ?? null, extra: { level: d.itemClsLvl ?? null, taxTyCd: d.taxTyCd ?? null }, synced_at: new Date().toISOString() });
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("lb_etims_code_lists").upsert(rows.slice(i, i + 500), { onConflict: "environment,list_name,code" });
      if (error) throw { status: 500, code: "SAVE_FAILED" };
    }
    return json(req, { ok: true, saved: rows.length });
  } catch (e) { return failure(req, e); }
});
