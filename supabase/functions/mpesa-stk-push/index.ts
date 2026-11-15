// supabase/functions/mpesa-stk-push/index.ts
//
// Brief section 33/35 — the ONLY place Daraja credentials exist. This
// runs on Supabase's infrastructure (Deno Edge Runtime), never in the
// browser bundle. The React app calls this via
// supabase.functions.invoke('mpesa-stk-push', ...) and never sees a
// consumer key/secret/passkey.
//
// SECRETS (set with `supabase secrets set`, never committed):
//   MPESA_CALLBACK_URL        this project's mpesa-callback function URL
//   (that's the only flat secret left -- see Phase 13)
//
// UPDATED (Phase 13): consumer key/secret/passkey are now PER BUSINESS,
// entered by the owner through the app (mpesa-save-config Edge Function
// writes them; see schema/phase13_mpesa_client_credentials.sql for why
// they live in a deny-all-RLS table rather than a normal one). This
// function looks them up per business_id below, using the service-role
// client -- the one place besides mpesa-save-config allowed past that
// table's RLS. There is no longer a single shared Daraja app for the
// whole deployment; each business supplies its own.
//
// NOT TESTED — no Daraja sandbox credentials or deployed Supabase
// project in this environment. This is real, complete code, written
// against Safaricom's published Daraja v2 API, but it has not made a
// single live request.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CALLBACK_URL = Deno.env.get("MPESA_CALLBACK_URL")!;

function baseUrlFor(environment: string) {
  return environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

// Safaricom's clock is Nairobi time (UTC+3); the Edge runtime is UTC, so shift it.
function timestamp() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function getAccessToken(baseUrl: string, consumerKey: string, consumerSecret: string): Promise<string> {
  const auth = btoa(`${consumerKey}:${consumerSecret}`);
  const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

// Browsers send an OPTIONS "preflight" before calling a function from the app. Without an OK answer to it (and these headers on every
// reply) the call is blocked with "CORS policy ... does not have HTTP ok status" and nothing ever reaches the code below.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const withCors = (res: Response) => { Object.entries(CORS).forEach(([k, v]) => res.headers.set(k, v)); return res; };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS });
  return withCors(await handle(req));
});

async function handle(req: Request): Promise<Response> {
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
    const { businessId, tenantId, phone, cartSnapshot, customerId, shiftId, requestedBy, rentInvoiceId } = body;
    let { amount } = body;

    if (!businessId || !tenantId || !phone || !amount || (!cartSnapshot?.length && !rentInvoiceId)) {
      return new Response(JSON.stringify({ error: "businessId, tenantId, phone, amount, and a cart or an invoice are required." }), { status: 400 });
    }

    // Rent invoice: the amount is checked against the DATABASE, never trusted from the browser.
    let invoiceNumber = "";
    if (rentInvoiceId) {
      const { data: inv } = await supabase.from("lb_rent_invoice_summary")
        .select("id, invoice_number, customer_id, display_status, balance_due, business_id")
        .eq("id", rentInvoiceId).eq("business_id", businessId).maybeSingle();
      if (!inv) return new Response(JSON.stringify({ error: "Invoice not found for this business." }), { status: 404 });
      if (!["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.display_status)) {
        return new Response(JSON.stringify({ error: `This invoice is ${inv.display_status} and cannot take an M-Pesa payment.` }), { status: 409 });
      }
      amount = Math.round(Number(amount));
      if (!(amount >= 1) || amount > Number(inv.balance_due) + 0.5) {
        return new Response(JSON.stringify({ error: `Amount must be between KES 1 and the invoice balance (KES ${inv.balance_due}).` }), { status: 400 });
      }
      const { data: live } = await supabase.from("lb_mpesa_transactions").select("id").eq("rent_invoice_id", rentInvoiceId).eq("status", "PENDING").limit(1);
      if (live?.length) return new Response(JSON.stringify({ error: "A payment prompt for this invoice is already waiting on the customer's phone." }), { status: 409 });
      invoiceNumber = inv.invoice_number;
    }

    // POS cart: the amount is checked against the cart the request carries, never trusted on its own. (The confirmed
    // sale is later built from this same snapshot, so a total that disagrees with it would record a sale for one
    // amount and take another.) Rounded to whole shillings, the same way the STK request itself is.
    if (cartSnapshot?.length && !rentInvoiceId) {
      const cartTotal = cartSnapshot.reduce((s: number, i: any) =>
        s + Number(i.quantity) * Number(i.unit_price) - Number(i.discount_amount || 0), 0);
      if (!Number.isFinite(cartTotal) || Math.abs(cartTotal - Number(amount)) > 0.5 || Math.abs(Number(amount) - Math.round(Number(amount))) > 0.005) {
        return new Response(JSON.stringify({ error: "The amount does not match the items in this sale. Refresh the sale and try again." }), { status: 400 });
      }
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
      .select("shortcode, is_active, environment, has_consumer_key, has_consumer_secret, has_passkey, account_type, till_number")
      .eq("business_id", businessId)
      .maybeSingle();

    if (!config?.is_active) {
      return new Response(JSON.stringify({ error: "M-Pesa is not turned on for this business yet. Set it up under Settings first." }), { status: 400 });
    }
    if (!config.has_consumer_key || !config.has_consumer_secret || !config.has_passkey) {
      // A business can be "is_active = true" with an incomplete secret
      // set if they toggled it on before finishing the form -- caught
      // here rather than failing later with a cryptic Daraja OAuth
      // error for a missing key.
      return new Response(JSON.stringify({ error: "M-Pesa setup isn't complete for this business yet. Add your Consumer Key, Consumer Secret, and Passkey under Settings → M-Pesa." }), { status: 400 });
    }

    // Phase 13 -- per-business secrets, fetched with the service-role
    // client (the caller-scoped `supabase` client above can't read this
    // table at all -- see phase13_mpesa_client_credentials.sql).
    const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: secrets, error: secretsError } = await serviceClient
      .from("lb_mpesa_secrets")
      .select("consumer_key, consumer_secret, passkey")
      .eq("business_id", businessId)
      .maybeSingle();
    if (secretsError || !secrets?.consumer_key || !secrets?.consumer_secret || !secrets?.passkey) {
      return new Response(JSON.stringify({ error: "Couldn't load this business's M-Pesa credentials. Re-check them under Settings → M-Pesa." }), { status: 500 });
    }

    config.shortcode = String(config.shortcode || "").trim();
    config.till_number = config.till_number ? String(config.till_number).trim() : config.till_number;
    secrets.passkey = String(secrets.passkey || "").trim();
    secrets.consumer_key = String(secrets.consumer_key || "").trim();
    secrets.consumer_secret = String(secrets.consumer_secret || "").trim();
    const isTill = config.account_type === "till";
    if (isTill && !config.till_number) {
      return new Response(JSON.stringify({ error: "Add your Till number under M-Pesa Setup (it is the number customers pay to)." }), { status: 400 });
    }
    const baseUrl = baseUrlFor(config.environment);
    const ts = timestamp();
    const password = btoa(`${config.shortcode}${secrets.passkey}${ts}`);

    const accessToken = await getAccessToken(baseUrl, secrets.consumer_key, secrets.consumer_secret);

    const stkBody = {
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: isTill ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: Math.round(Number(amount)),
      PartyA: phone,
      PartyB: isTill ? config.till_number : config.shortcode,
      PhoneNumber: phone,
      CallBackURL: CALLBACK_URL,
      AccountReference: invoiceNumber ? invoiceNumber.slice(-12) : "Umova",
      TransactionDesc: invoiceNumber ? `Rent ${invoiceNumber}`.slice(0, 13) : "Sale payment",
    };
    const { Password: _pw, ...sentForLog } = stkBody;
    console.log("[mpesa-stk-push] sending", JSON.stringify({ env: config.environment, ...sentForLog, passkeyLength: secrets.passkey.length }));
    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(stkBody),
    });

    const stkData = await stkRes.json();
    console.log("[mpesa-stk-push] Safaricom replied", stkRes.status, JSON.stringify(stkData));

    if (!stkRes.ok || stkData.ResponseCode !== "0") {
      // Daraja rejected the request itself (bad shortcode, malformed
      // phone at their end, etc.) — nothing was sent to the customer's
      // phone, so nothing is recorded as PENDING. Section 43: don't
      // record a request that never actually reached the customer.
      // Logged (never the keys, passkey or token) so the Supabase function log shows what Safaricom said and which mode was used.
      console.error("[mpesa-stk-push] Daraja refused the STK request", JSON.stringify({ environment: config.environment, shortcode: config.shortcode, accountType: config.account_type, tillNumber: config.till_number, httpStatus: stkRes.status, daraja: stkData }));
      const raw = stkData.errorMessage || stkData.ResponseDescription || "Daraja rejected the STK request.";
      const hint = /invalid access token/i.test(raw)
        ? ` Safaricom did not accept the keys for ${config.environment === "production" ? "LIVE" : "TEST (sandbox)"} mode. Check that the mode matches where the keys came from, and that the Daraja app has M-Pesa Express (STK Push) enabled.`
        : "";
      return new Response(JSON.stringify({ error: raw + hint }), { status: 502 });
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
        cart_snapshot: cartSnapshot?.length ? cartSnapshot : null,
        rent_invoice_id: rentInvoiceId ?? null,
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
}
