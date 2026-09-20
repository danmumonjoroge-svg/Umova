// supabase/functions/mpesa-save-config/index.ts
//
// The ONLY way a Daraja consumer key / consumer secret / passkey can be
// written to this system, from the Settings screen an owner actually
// uses -- see schema/phase13_mpesa_client_credentials.sql for why this
// can't just be a normal table write from the browser.
//
// FLOW:
//   1. Verify the caller genuinely belongs to the business they're
//      claiming to configure (using THEIR OWN JWT against
//      lb_businesses' existing RLS policy -- if they can't SELECT that
//      business's row as themselves, they don't get to write its
//      M-Pesa config either).
//   2. Write the non-secret fields (shortcode, environment, is_active)
//      to lb_mpesa_config -- same table Phase 12 already had, still
//      normal RLS, nothing new here.
//   3. Write any secret fields that were actually SENT (partial
//      updates are supported -- an owner fixing just the shortcode
//      doesn't have to re-paste their consumer secret) to
//      lb_mpesa_secrets, using the SERVICE ROLE client -- this is the
//      one place allowed past that table's deny-all RLS.
//   4. Update lb_mpesa_config's has_consumer_key/has_consumer_secret/
//      has_passkey flags to match what's now on file.
//   5. Return ONLY a masked confirmation. The response body never
//      contains a secret value, even the one that was just submitted.
//
// NOT TESTED -- no deployed Supabase project in this environment.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const body = await req.json();
    const { tenantId, businessId, shortcode, environment, isActive, consumerKey, consumerSecret, passkey } = body;

    if (!tenantId || !businessId || !shortcode) {
      return new Response(JSON.stringify({ error: "tenantId, businessId, and shortcode are required." }), { status: 400 });
    }

    // ---- Step 1: prove the caller actually belongs to this business ----
    // A client scoped to the CALLER's own JWT (not service role) --
    // lb_businesses' own RLS policy (tenant_id = get_current_tenant_id())
    // does the real work here. If this comes back empty, the caller
    // either isn't authenticated or is trying to configure a business
    // that isn't theirs -- either way, reject before touching anything.
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: ownBusiness, error: ownError } = await callerClient
      .from("lb_businesses").select("id").eq("id", businessId).maybeSingle();
    if (ownError || !ownBusiness) {
      return new Response(JSON.stringify({ error: "You don't have permission to configure M-Pesa for this business." }), { status: 403 });
    }

    // ---- Step 2: non-secret config -- normal RLS write, as the caller ----
    const { error: configError } = await callerClient
      .from("lb_mpesa_config")
      .upsert({
        tenant_id: tenantId, business_id: businessId, shortcode,
        environment: environment || "sandbox", is_active: !!isActive,
        updated_at: new Date().toISOString(),
      }, { onConflict: "business_id" });
    if (configError) throw configError;

    // ---- Step 3: secrets -- service role, past the deny-all RLS ----
    // Only fields actually present in the request are written -- an
    // owner updating just the shortcode sends no secret fields at all,
    // and this must not overwrite what's already on file with blanks.
    const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const secretPatch: Record<string, unknown> = {
      tenant_id: tenantId, business_id: businessId, updated_at: new Date().toISOString(),
    };
    let touchedAny = false;
    if (consumerKey) { secretPatch.consumer_key = consumerKey; touchedAny = true; }
    if (consumerSecret) { secretPatch.consumer_secret = consumerSecret; touchedAny = true; }
    if (passkey) { secretPatch.passkey = passkey; touchedAny = true; }

    if (touchedAny) {
      // Upsert with only the changed columns would clobber the
      // untouched ones with NULL on a fresh insert (no existing row) --
      // so fetch what's already there first and merge, rather than
      // trusting upsert's column-merge behaviour across an unknown
      // existing/not-existing state.
      const { data: existing } = await serviceClient
        .from("lb_mpesa_secrets").select("consumer_key, consumer_secret, passkey")
        .eq("business_id", businessId).maybeSingle();

      const { error: secretError } = await serviceClient
        .from("lb_mpesa_secrets")
        .upsert({
          tenant_id: tenantId,
          business_id: businessId,
          consumer_key: secretPatch.consumer_key ?? existing?.consumer_key ?? null,
          consumer_secret: secretPatch.consumer_secret ?? existing?.consumer_secret ?? null,
          passkey: secretPatch.passkey ?? existing?.passkey ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "business_id" });
      if (secretError) throw secretError;
    }

    // ---- Step 4: status flags on the safely-readable table ----
    const { data: finalSecrets } = await serviceClient
      .from("lb_mpesa_secrets").select("consumer_key, consumer_secret, passkey")
      .eq("business_id", businessId).maybeSingle();

    const flags = {
      has_consumer_key: !!finalSecrets?.consumer_key,
      has_consumer_secret: !!finalSecrets?.consumer_secret,
      has_passkey: !!finalSecrets?.passkey,
    };
    await callerClient.from("lb_mpesa_config").update({
      ...flags,
      credentials_updated_at: touchedAny ? new Date().toISOString() : undefined,
    }).eq("business_id", businessId);

    // ---- Step 5: masked confirmation only ----
    return new Response(JSON.stringify({ ok: true, ...flags }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[mpesa-save-config]", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500 });
  }
});
