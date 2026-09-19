// supabase/functions/mpesa-stk-push/index.ts
//
// Brief section 33/35 — the ONLY place Daraja credentials exist. This
// runs on Supabase's infrastructure (Deno Edge Runtime), never in the
// browser bundle. The React app calls this via
// supabase.functions.invoke('mpesa-stk-push', ...) and never sees a
// consumer key/secret/passkey.
//
// SECRETS (set with `supabase secrets set`, never committed):
//   MPESA_CONSUMER_KEY
//   MPESA_CONSUMER_SECRET
//   MPESA_PASSKEY
//   MPESA_ENV                 "sandbox" | "production"
//   MPESA_CALLBACK_URL        this project's mpesa-callback function URL
//
// This deliverable supports ONE set of credentials for the whole
// deployment (one Daraja app), not per-tenant credentials — matches
// lb_mpesa_config's own scope (shortcode is per-business, but the
// consumer key/secret are a single Daraja app registration). Real
// per-tenant Daraja apps (each business with its own paybill/till and
// its own Daraja credentials) would need a secrets-per-business lookup
// here instead of flat env vars — flagged as a known limitation, not
// guessed at, since it changes how secrets are stored.
//
// NOT TESTED — no Daraja sandbox credentials or deployed Supabase
// project in this environment. This is real, complete code, written
// against Safaricom's published Daraja v2 API, but it has not made a
// single live request.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONSUMER_KEY = Deno.env.get("MPESA_CONSUMER_KEY")!;
const CONSUMER_SECRET = Deno.env.get("MPESA_CONSUMER_SECRET")!;
const PASSKEY = Deno.env.get("MPESA_PASSKEY")!;
const ENV = Deno.env.get("MPESA_ENV") || "sandbox";
const CALLBACK_URL = Deno.env.get("MPESA_CALLBACK_URL")!;

const BASE_URL = ENV === "production"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function getAccessToken(): Promise<string> {
  const auth = btoa(`${CONSUMER_KEY}:${CONSUMER_SECRET}`);
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    // Client must be an authenticated POS session — this function still
    // requires a real JWT, it just isn't Daraja's JWT. Uses the caller's
    // own token so RLS on lb_mpesa_transactions/lb_businesses applies
    // normally to the SELECTs below (only the final DB write that must
    // bypass RLS — confirm_mpesa_payment — runs service-role, in the
    // callback function, not here).
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json();
    const { businessId, tenantId, phone, amount, cartSnapshot, customerId, shiftId, requestedBy } = body;

    if (!businessId || !tenantId || !phone || !amount || !cartSnapshot?.length) {
      return new Response(JSON.stringify({ error: "businessId, tenantId, phone, amount, and cartSnapshot are required." }), { status: 400 });
    }

    // Phone must already be normalised 2547XXXXXXXX by the caller
    // (mirrors whatsappService.normalizePhoneForWhatsApp's convention) —
    // this function does not re-derive it, so a bad number fails loudly
    // here rather than silently reaching Safaricom malformed.
    if (!/^254(7|1)\d{8}$/.test(phone)) {
      return new Response(JSON.stringify({ error: `Phone number "${phone}" is not a normalised Kenyan mobile (expected 2547XXXXXXXX).` }), { status: 400 });
    }

    const { data: config } = await supabase
      .from("lb_mpesa_config")
      .select("shortcode, is_active")
      .eq("business_id", businessId)
      .maybeSingle();

    if (!config?.is_active) {
      return new Response(JSON.stringify({ error: "M-Pesa is not turned on for this business yet. Set it up under Settings first." }), { status: 400 });
    }

    const ts = timestamp();
    const password = btoa(`${config.shortcode}${PASSKEY}${ts}`);

    const accessToken = await getAccessToken();

    const stkRes = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: ts,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.round(Number(amount)),
        PartyA: phone,
        PartyB: config.shortcode,
        PhoneNumber: phone,
        CallBackURL: CALLBACK_URL,
        AccountReference: "Umova",
        TransactionDesc: "Umova sale payment",
      }),
    });

    const stkData = await stkRes.json();

    if (!stkRes.ok || stkData.ResponseCode !== "0") {
      // Daraja rejected the request itself (bad shortcode, malformed
      // phone at their end, etc.) — nothing was sent to the customer's
      // phone, so nothing is recorded as PENDING. Section 43: don't
      // record a request that never actually reached the customer.
      return new Response(JSON.stringify({ error: stkData.errorMessage || stkData.ResponseDescription || "Daraja rejected the STK request." }), { status: 502 });
    }

    // Only now — after Safaricom has actually accepted the request and
    // (per their side) sent the STK prompt — do we record PENDING.
    const { data: txn, error: insertError } = await supabase
      .from("lb_mpesa_transactions")
      .insert({
        tenant_id: tenantId,
        business_id: businessId,
        shift_id: shiftId ?? null,
        customer_id: customerId ?? null,
        phone,
        amount: Number(amount),
        cart_snapshot: cartSnapshot,
        merchant_request_id: stkData.MerchantRequestID,
        checkout_request_id: stkData.CheckoutRequestID,
        status: "PENDING",
        requested_by: requestedBy ?? null,
      })
      .select("id, checkout_request_id, status")
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ transaction: txn }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[mpesa-stk-push]", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500 });
  }
});
