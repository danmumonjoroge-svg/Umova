// supabase/functions/etims-register-item/index.ts
// Tells KRA about one product (spec: /saveItem) using the codes the owner picked from KRA's own lists.
// Deploy:  supabase functions deploy etims-register-item --use-api
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { admin, cors, failure, json, kraCall, kraMessage, loadOwnKey, resolveCaller } from "../_shared/etims.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, code: "METHOD" }, 405);
  try {
    const c = await resolveCaller(req, "products.manage");
    const productId = String((await req.json().catch(() => ({})))?.productId || "");
    if (!productId) return json(req, { ok: false, code: "NO_PRODUCT" }, 400);

    // the product must belong to THIS tenant
    const { data: p } = await admin.from("lb_products").select("id,name,barcode,selling_price,track_inventory").eq("id", productId).eq("tenant_id", c.tenantId).maybeSingle();
    if (!p) return json(req, { ok: false, code: "ITEM_NOT_FOUND" }, 404);
    const { data: m } = await admin.from("lb_etims_item_map").select("*").eq("product_id", productId).eq("business_id", c.businessId).maybeSingle();
    const need = ["tax_code", "item_class_code", "unit_code", "packaging_code", "origin_country_code"].filter((k) => !m?.[k]);
    if (!m || need.length) return json(req, { ok: false, code: "CODES_MISSING", message: "Pick the tax type, item class, unit, packaging and country for this item first." }, 422);

    // KRA's item code (max 20 chars): ours is the product id without dashes, cut to 20. Chosen by us; stable, so re-sending updates the same item.
    const itemCd = m.kra_item_code || productId.replace(/-/g, "").slice(0, 20);
    const who = String(c.staffId || "umova").slice(0, 20);
    const cmcKey = await loadOwnKey(c.businessId);
    await admin.from("lb_etims_item_map").update({ registration_status: "PENDING", registration_error: null }).eq("id", m.id);

    let body: any;
    try { ({ body } = await kraCall(c.config.environment, "/saveItem", {
      tin: c.config.kra_pin, bhfId: c.config.branch_id, cmcKey,
      itemClsCd: m.item_class_code, itemCd, itemTyCd: p.track_inventory === false ? "3" : "2",   // spec 4.3: 2 finished product, 3 service without stock
      itemNm: String(p.name).slice(0, 200), orgnNatCd: m.origin_country_code, pkgUnitCd: m.packaging_code, qtyUnitCd: m.unit_code,
      taxTyCd: m.tax_code, bcd: p.barcode ? String(p.barcode).slice(0, 20) : null, dftPrc: Number(p.selling_price || 0),
      isrcAplcbYn: "N", useYn: "Y", regrId: who, regrNm: "Umova", modrId: who, modrNm: "Umova",
    })); } catch (e) {
      await admin.from("lb_etims_item_map").update({ registration_status: "NOT_REGISTERED" }).eq("id", m.id);   // KRA unreachable: nothing was sent, try again later
      throw e;
    }
    const code = String(body?.resultCd ?? "");
    if (code === "000") {
      await admin.from("lb_etims_item_map").update({ registration_status: "REGISTERED", kra_item_code: itemCd, registration_error: null }).eq("id", m.id);
      return json(req, { ok: true, registration_status: "REGISTERED" });
    }
    const msg = kraMessage(code);
    await admin.from("lb_etims_item_map").update({ registration_status: "REJECTED", registration_error: msg.slice(0, 300) }).eq("id", m.id);
    return json(req, { ok: false, code: code || "NO_ANSWER", message: msg }, 422);
  } catch (e) { return failure(req, e); }
});
