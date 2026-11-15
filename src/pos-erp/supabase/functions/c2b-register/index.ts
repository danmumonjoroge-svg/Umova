// supabase/functions/c2b-register/index.ts
//
// Owner presses "Turn on" in M-Pesa -> Setup -> "Receive payments made to my till". This function:
//   1. checks the caller may change settings (pos_require settings.manage) and owns the business,
//   2. makes (or keeps) this business's secret hook token in lb_mpesa_secrets (never sent back to the browser),
//   3. registers <functions-url>/c2b-hook/<token>/confirmation|validation with Safaricom (C2B v2, ResponseType "Completed"),
//   4. sets lb_mpesa_config.c2b_enabled / c2b_registered_at.
// Body: { businessId, enable: boolean }.  Reply: { ok, enabled, registeredAt }.
// Turning OFF only stops us storing payments (the database refuses them); Safaricom keeps the URL registered.
// NOTE: on production a shortcode can register its URLs once; changing them later may need Safaricom's support.
// NOT TESTED against a live Daraja.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const base = (env: string) => (env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke");
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, "0")).join("");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { businessId, enable } = await req.json();
    if (!businessId) return json({ error: "businessId is required." }, 400);
    const caller = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { error: permError } = await caller.rpc("pos_require", { p_perms: ["settings.manage"] });
    if (permError) return json({ error: permError.code === "42501" ? "Only the owner or a manager can change M-Pesa settings." : "Could not check your permission." }, 403);
    const { data: own } = await caller.from("lb_businesses").select("id, tenant_id").eq("id", businessId).maybeSingle();
    if (!own) return json({ error: "You don't have permission to configure M-Pesa for this business." }, 403);

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: cfg } = await svc.from("lb_mpesa_config").select("shortcode, environment, is_active, has_consumer_key, has_consumer_secret, c2b_registered_at").eq("business_id", businessId).maybeSingle();
    if (!cfg?.shortcode || !cfg.has_consumer_key || !cfg.has_consumer_secret) return json({ error: "Finish the M-Pesa setup first (shortcode, consumer key and secret)." }, 400);

    if (!enable) {
      await svc.from("lb_mpesa_config").update({ c2b_enabled: false, updated_at: new Date().toISOString() }).eq("business_id", businessId);
      return json({ ok: true, enabled: false, registeredAt: cfg.c2b_registered_at });
    }

    const { data: sec } = await svc.from("lb_mpesa_secrets").select("consumer_key, consumer_secret, c2b_token").eq("business_id", businessId).maybeSingle();
    if (!sec?.consumer_key || !sec?.consumer_secret) return json({ error: "Couldn't load this business's M-Pesa credentials." }, 500);
    const token = sec.c2b_token || randomToken();
    if (!sec.c2b_token) {
      const { error } = await svc.from("lb_mpesa_secrets").update({ c2b_token: token }).eq("business_id", businessId);
      if (error) return json({ error: "Could not save the hook token." }, 500);
    }

    const root = base(cfg.environment);
    const oauth = await fetch(`${root}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${btoa(`${sec.consumer_key}:${sec.consumer_secret}`)}` } });
    if (!oauth.ok) return json({ error: `Safaricom did not accept the consumer key/secret (${oauth.status}).` }, 502);
    const accessToken = (await oauth.json()).access_token;

    const hook = `${SUPABASE_URL.replace(".supabase.co", ".functions.supabase.co")}/c2b-hook/${token}`;
    const reg = await fetch(`${root}/mpesa/c2b/v2/registerurl`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ShortCode: cfg.shortcode, ResponseType: "Completed", ConfirmationURL: `${hook}/confirmation`, ValidationURL: `${hook}/validation` }),
    });
    const regBody = await reg.json().catch(() => ({}));
    // Safaricom answers "URLs are already registered" on a repeat: that is fine, the URL is in place.
    const already = JSON.stringify(regBody).toLowerCase().includes("already");
    if (!reg.ok && !already) return json({ error: `Safaricom refused the registration: ${regBody?.errorMessage || regBody?.ResponseDescription || reg.status}` }, 502);

    const now = new Date().toISOString();
    await svc.from("lb_mpesa_config").update({ c2b_enabled: true, c2b_registered_at: now, updated_at: now }).eq("business_id", businessId);
    return json({ ok: true, enabled: true, registeredAt: now });
  } catch (err) {
    console.error("[c2b-register]", err);
    return json({ error: "Something went wrong turning this on. Please try again." }, 500);
  }
});
