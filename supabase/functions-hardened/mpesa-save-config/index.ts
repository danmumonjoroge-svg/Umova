// supabase/functions-hardened/mpesa-save-config/index.ts   (PROPOSAL - not deployed)
// Changes vs the repo version (all marked HARDENING):
//  1. caller client uses the ANON key + the caller's JWT (was: service-role key)
//  2. the JWT is verified with auth.getUser() before any claim is trusted
//  3. tenantId from the request body is IGNORED; tenant comes from the lb_businesses row RLS lets the caller see
//  4. caller must hold settings.manage (owner/manager by default) -- previously any signed-in staff of the business
//  5. field validation (shortcode format, environment allow-list, secret length caps); secrets never logged/echoed
//  6. no echo of err.message to the browser (could leak DB detail)
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in." }, 401);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
    const { businessId, shortcode, environment, isActive, consumerKey, consumerSecret, passkey } = body; // HARDENING: tenantId deliberately not read

    if (!UUID.test(String(businessId ?? "")) || !/^\d{5,7}$/.test(String(shortcode ?? ""))) {
      return json({ error: "A valid businessId and a 5-7 digit shortcode are required." }, 400);
    }
    const env = environment === "production" ? "production" : "sandbox";
    for (const [n, v] of [["consumerKey", consumerKey], ["consumerSecret", consumerSecret], ["passkey", passkey]] as const) {
      if (v !== undefined && v !== null && v !== "" && (typeof v !== "string" || v.length > 512)) return json({ error: `${n} is invalid.` }, 400);
    }

    // HARDENING: anon key + caller JWT -> every query below runs as the caller, under RLS
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await callerClient.auth.getUser(token);   // verifies signature + expiry with Auth
    if (userErr || !userData?.user) return json({ error: "Session expired. Sign in again." }, 401);

    // HARDENING: caller must be allowed to change settings (checked by the same DB function the triggers use)
    const { data: allowed, error: permErr } = await callerClient.rpc("pos_has_permission", { p_perm: "settings.manage" });
    if (permErr || allowed !== true) return json({ error: "You don't have permission to change M-Pesa settings." }, 403);

    // HARDENING: tenant derived from the business row visible to the caller (RLS + pos_session_live guard)
    const { data: biz, error: bizErr } = await callerClient.from("lb_businesses").select("id, tenant_id").eq("id", businessId).maybeSingle();
    if (bizErr || !biz?.tenant_id) return json({ error: "You don't have permission to configure M-Pesa for this business." }, 403);
    const tenantId = biz.tenant_id as string;

    const { error: configError } = await callerClient.from("lb_mpesa_config").upsert({
      tenant_id: tenantId, business_id: businessId, shortcode, environment: env, is_active: !!isActive,
      updated_at: new Date().toISOString(),
    }, { onConflict: "business_id" });
    if (configError) throw configError;

    // secrets: service role, only here and in mpesa-stk-push; merge so partial updates keep stored values
    const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const touchedAny = !!(consumerKey || consumerSecret || passkey);
    if (touchedAny) {
      const { data: existing } = await serviceClient.from("lb_mpesa_secrets")
        .select("consumer_key, consumer_secret, passkey").eq("business_id", businessId).eq("tenant_id", tenantId).maybeSingle();
      const { error: secretError } = await serviceClient.from("lb_mpesa_secrets").upsert({
        tenant_id: tenantId, business_id: businessId,
        consumer_key: consumerKey || existing?.consumer_key || null,
        consumer_secret: consumerSecret || existing?.consumer_secret || null,
        passkey: passkey || existing?.passkey || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "business_id" });
      if (secretError) throw secretError;
    }
    const { data: fin } = await serviceClient.from("lb_mpesa_secrets").select("consumer_key, consumer_secret, passkey").eq("business_id", businessId).maybeSingle();
    const flags = { has_consumer_key: !!fin?.consumer_key, has_consumer_secret: !!fin?.consumer_secret, has_passkey: !!fin?.passkey };
    await callerClient.from("lb_mpesa_config").update({ ...flags, ...(touchedAny ? { credentials_updated_at: new Date().toISOString() } : {}) }).eq("business_id", businessId);

    return json({ ok: true, ...flags });             // masked confirmation only
  } catch (err) {
    console.error("[mpesa-save-config] failed:", (err as Error)?.message);   // never log the request body
    return json({ error: "Could not save M-Pesa settings." }, 500);          // HARDENING: no internal detail to the browser
  }
});
