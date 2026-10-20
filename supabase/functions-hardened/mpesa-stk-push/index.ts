// supabase/functions-hardened/mpesa-stk-push/index.ts   (PROPOSAL - not deployed)
// Changes vs the repo version (marked HARDENING):
//  1. anon key + caller JWT for the caller client (was service-role key); JWT verified via auth.getUser()
//  2. tenantId / requestedBy from the body are IGNORED: tenant comes from the lb_businesses row, staff from the verified JWT claim
//  3. caller must hold payments.record
//  4. cart sales: amount may not exceed the cart total (quantity * unit_price) -- a till can't prompt for more than the sale
//  5. phone/amount/cart shape validation; amount integer 1..250000 (Daraja per-transaction limit)
//  6. no internal error text returned to the browser
//  7. the PENDING row is written as the caller (matches the pos_guard_mpesa_txn trigger: clients may only insert PENDING)
// The callback URL must now contain the secret token (see mpesa-callback) -> set MPESA_CALLBACK_URL accordingly.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CALLBACK_URL = Deno.env.get("MPESA_CALLBACK_URL")!;      // e.g. https://<ref>.functions.supabase.co/mpesa-callback?t=<MPESA_CALLBACK_TOKEN>
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseUrlFor = (e: string) => (e === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke");
function timestamp() {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
async function getAccessToken(baseUrl: string, key: string, secret: string) {
  const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}` } });
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`);        // HARDENING: don't include the upstream body
  return (await res.json()).access_token as string;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in." }, 401);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
    const { businessId, phone, cartSnapshot, customerId, shiftId, rentInvoiceId } = body;   // HARDENING: tenantId/requestedBy not read
    let amount = Math.round(Number(body.amount));

    if (!UUID.test(String(businessId ?? "")) || (customerId && !UUID.test(String(customerId))) || (shiftId && !UUID.test(String(shiftId))) ||
        (rentInvoiceId && !UUID.test(String(rentInvoiceId)))) return json({ error: "Invalid identifiers." }, 400);
    if (!/^254(7|1)\d{8}$/.test(String(phone ?? ""))) return json({ error: "Phone must be a normalised Kenyan mobile (2547XXXXXXXX)." }, 400);
    if (!Number.isFinite(amount) || amount < 1 || amount > 250000) return json({ error: "Amount must be between KES 1 and 250,000." }, 400);
    if (!rentInvoiceId && (!Array.isArray(cartSnapshot) || cartSnapshot.length === 0 || cartSnapshot.length > 200)) return json({ error: "A cart or an invoice is required." }, 400);

    // HARDENING: anon key + caller JWT; verify the token; everything below the caller client runs under RLS
    const supabase = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !u?.user) return json({ error: "Session expired. Sign in again." }, 401);
    let staffId: string | null = null;
    try { staffId = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).pos_staff_id ?? null; } catch { /* verified above; claim optional */ }

    const { data: allowed } = await supabase.rpc("pos_has_permission", { p_perm: "payments.record" });
    if (allowed !== true) return json({ error: "You don't have permission to take payments." }, 403);

    const { data: biz } = await supabase.from("lb_businesses").select("id, tenant_id").eq("id", businessId).maybeSingle();
    if (!biz?.tenant_id) return json({ error: "Business not found." }, 404);
    const tenantId = biz.tenant_id as string;

    let invoiceNumber = "";
    if (rentInvoiceId) {
      const { data: inv } = await supabase.from("lb_rent_invoice_summary")
        .select("id, invoice_number, display_status, balance_due").eq("id", rentInvoiceId).eq("business_id", businessId).maybeSingle();
      if (!inv) return json({ error: "Invoice not found for this business." }, 404);
      if (!["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.display_status)) return json({ error: `This invoice is ${inv.display_status} and cannot take an M-Pesa payment.` }, 409);
      if (amount > Number(inv.balance_due) + 0.5) return json({ error: `Amount exceeds the invoice balance (KES ${inv.balance_due}).` }, 400);
      const { data: live } = await supabase.from("lb_mpesa_transactions").select("id").eq("rent_invoice_id", rentInvoiceId).eq("status", "PENDING").limit(1);
      if (live?.length) return json({ error: "A payment prompt for this invoice is already waiting on the customer's phone." }, 409);
      invoiceNumber = inv.invoice_number;
    } else {
      // HARDENING: the prompt may not ask for more than the cart is worth (discounts can make it lower, never higher)
      let cartTotal = 0;
      for (const it of cartSnapshot) {
        const q = Number(it?.quantity), p = Number(it?.unit_price);
        if (!UUID.test(String(it?.product_id ?? "")) || !(q > 0) || !(p >= 0) || q > 100000) return json({ error: "Cart contains an invalid line." }, 400);
        cartTotal += q * p;
      }
      if (amount > Math.ceil(cartTotal) + 0.5) return json({ error: "Amount is higher than the cart total." }, 400);
    }

    const { data: config } = await supabase.from("lb_mpesa_config")
      .select("shortcode, is_active, environment, has_consumer_key, has_consumer_secret, has_passkey").eq("business_id", businessId).maybeSingle();
    if (!config?.is_active) return json({ error: "M-Pesa is not turned on for this business yet. Set it up under Settings first." }, 400);
    if (!config.has_consumer_key || !config.has_consumer_secret || !config.has_passkey) return json({ error: "M-Pesa setup isn't complete. Add your Consumer Key, Consumer Secret and Passkey under Settings → M-Pesa." }, 400);

    const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: secrets, error: sErr } = await serviceClient.from("lb_mpesa_secrets")
      .select("consumer_key, consumer_secret, passkey").eq("business_id", businessId).eq("tenant_id", tenantId).maybeSingle();   // HARDENING: also pinned to the derived tenant
    if (sErr || !secrets?.consumer_key || !secrets?.consumer_secret || !secrets?.passkey) return json({ error: "Couldn't load this business's M-Pesa credentials. Re-check them under Settings → M-Pesa." }, 500);

    const baseUrl = baseUrlFor(config.environment);
    const ts = timestamp();
    const accessToken = await getAccessToken(baseUrl, secrets.consumer_key, secrets.consumer_secret);
    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode, Password: btoa(`${config.shortcode}${secrets.passkey}${ts}`), Timestamp: ts,
        TransactionType: "CustomerPayBillOnline", Amount: amount, PartyA: phone, PartyB: config.shortcode, PhoneNumber: phone,
        CallBackURL: CALLBACK_URL,
        AccountReference: invoiceNumber ? invoiceNumber.slice(-12) : "Umova",
        TransactionDesc: invoiceNumber ? `Rent ${invoiceNumber}`.slice(0, 13) : "Umova sale payment",
      }),
    });
    const stkData = await stkRes.json();
    if (!stkRes.ok || stkData.ResponseCode !== "0") return json({ error: stkData.errorMessage || stkData.ResponseDescription || "Daraja rejected the STK request." }, 502);

    const { data: txn, error: insertError } = await supabase.from("lb_mpesa_transactions").insert({
      tenant_id: tenantId, business_id: businessId, shift_id: shiftId ?? null, customer_id: customerId ?? null, phone, amount,
      cart_snapshot: cartSnapshot?.length ? cartSnapshot : null, rent_invoice_id: rentInvoiceId ?? null,
      merchant_request_id: stkData.MerchantRequestID, checkout_request_id: stkData.CheckoutRequestID,
      status: "PENDING", requested_by: staffId,                                        // HARDENING: from the verified JWT, not the body
    }).select("id, checkout_request_id, status").single();
    if (insertError) throw insertError;
    return json({ transaction: txn });
  } catch (err) {
    console.error("[mpesa-stk-push] failed:", (err as Error)?.message);
    return json({ error: "Could not start the M-Pesa payment." }, 500);
  }
});
