// supabase/functions/mpesa-callback/index.ts
//
// The public webhook Safaricom calls when a customer answers (or
// ignores/declines) the STK prompt. Section 38 requirements, each
// mapped to a line below:
//   - identify the payment request       -> checkout_request_id lookup (in confirm_mpesa_payment)
//   - verify transaction                  -> ResultCode check (in confirm_mpesa_payment)
//   - update payment/sale/customer/etc.   -> confirm_mpesa_payment() does this atomically
//   - idempotent, no duplicate on retry   -> confirm_mpesa_payment()'s own status check
//
// This function is intentionally thin: it does NOT contain business
// logic itself. All of the atomic work is the confirm_mpesa_payment()
// Postgres function (schema/phase12_mpesa.sql) — a webhook handler is
// the wrong place for multi-table logic to live, because a crash
// mid-handler here (network blip mid-request, cold start timeout) must
// not leave the database half-updated. A single RPC call is one
// round-trip and one transaction.
//
// Runs with the SERVICE ROLE key — deliberately: Safaricom's callback
// has no POS staff session, so nothing here can satisfy
// tenant_id = get_current_tenant_id(). confirm_mpesa_payment() is
// SECURITY DEFINER for exactly this reason, and this is the one place
// in the whole system that's allowed to call it.
//
// SECURITY NOTE: Safaricom does not sign callbacks in a way this
// function can verify offline (no shared secret in the payload itself).
// The standard mitigation — used here — is that the CallBackURL is not
// publicly guessable (it's a long, unlisted Supabase Functions URL) and
// the handler only trusts a checkout_request_id that this system itself
// issued (an unknown one is rejected by confirm_mpesa_payment's own
// "not found" check). For production, additionally restrict this
// function's URL/IP allowlist to Safaricom's published callback IP
// ranges if your infrastructure supports it — not done here since it's
// an infra-level setting outside this codebase.
//
// NOT TESTED — no live Daraja sandbox has ever called this.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    // Always 200 back to Safaricom even on our own parse failure --
    // returning a non-200 makes Daraja retry the SAME malformed-looking
    // request indefinitely per their own retry policy, which helps no
    // one. Logged for a human to look at instead.
    console.error("[mpesa-callback] failed to parse body");
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { status: 200 });
  }

  try {
    // Daraja's actual STK callback shape:
    // { Body: { stkCallback: { MerchantRequestID, CheckoutRequestID,
    //     ResultCode, ResultDesc, CallbackMetadata?: { Item: [...] } } } }
    const stk = body?.Body?.stkCallback;
    if (!stk?.CheckoutRequestID) {
      console.error("[mpesa-callback] unrecognised payload shape", JSON.stringify(body));
      return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { status: 200 });
    }

    let mpesaReceiptNumber: string | null = null;
    if (stk.ResultCode === 0 && stk.CallbackMetadata?.Item) {
      const item = stk.CallbackMetadata.Item.find((i: any) => i.Name === "MpesaReceiptNumber");
      mpesaReceiptNumber = item?.Value ?? null;
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data, error } = await supabase.rpc("confirm_mpesa_payment", {
      p_checkout_request_id: stk.CheckoutRequestID,
      p_result_code: stk.ResultCode,
      p_result_desc: stk.ResultDesc,
      p_mpesa_receipt_number: mpesaReceiptNumber,
      p_raw_callback: body,
    });

    if (error) {
      // A "not found" here most likely means Safaricom is calling back
      // for a checkout_request_id this system never issued -- log it as
      // NEEDS_ATTENTION material for a human, but still 200 back so
      // Safaricom doesn't retry a request that will never resolve.
      console.error("[mpesa-callback] confirm_mpesa_payment failed", error, stk.CheckoutRequestID);
    } else {
      console.log("[mpesa-callback] processed", stk.CheckoutRequestID, data);
    }

    // Safaricom only cares that we returned 200 with this shape --
    // anything else, they retry.
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[mpesa-callback] unhandled error", err);
    // Still 200 -- an unhandled error here becoming a Safaricom retry
    // storm is worse than one callback being logged as failed for a
    // human to check on the Reconciliation page's "Needs attention" list.
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { status: 200 });
  }
});
