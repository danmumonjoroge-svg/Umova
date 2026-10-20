// supabase/functions-hardened/mpesa-callback/index.ts   (PROPOSAL - not deployed)
// Safaricom does not sign callbacks, so a forged POST that guesses/obtains a CheckoutRequestID could mark a sale PAID.
// Defences added (marked HARDENING):
//  1. secret token in the callback URL (?t=...) compared in constant time -- set MPESA_CALLBACK_TOKEN and put the same
//     value in MPESA_CALLBACK_URL used by mpesa-stk-push. Wrong/missing token -> 403, nothing processed.
//  2. the paid Amount in CallbackMetadata must equal the amount we asked for; a mismatch is NOT confirmed -- the
//     transaction is flagged NEEDS_ATTENTION for a human (Reconciliation page) instead
//  3. unknown CheckoutRequestID is dropped before touching confirm_mpesa_payment
//  4. optional IP allow-list: set MPESA_ALLOWED_IPS (comma separated Safaricom ranges/addresses, exact match) if your edge
//     forwards x-forwarded-for; leave unset to rely on the token only
//  5. never logs the raw payload (it contains the payer's phone number)
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("MPESA_CALLBACK_TOKEN") ?? "";
const ALLOWED_IPS = (Deno.env.get("MPESA_ALLOWED_IPS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const OK = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { status: 200, headers: { "Content-Type": "application/json" } });

function safeEqual(a: string, b: string) {          // constant-time compare
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!TOKEN || TOKEN.length < 24) { console.error("[mpesa-callback] MPESA_CALLBACK_TOKEN not configured (>=24 chars) - refusing"); return new Response("Not configured", { status: 503 }); }
  const given = new URL(req.url).searchParams.get("t") ?? "";
  if (!safeEqual(given, TOKEN)) return new Response("Forbidden", { status: 403 });                     // HARDENING 1
  if (ALLOWED_IPS.length) {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    if (!ALLOWED_IPS.includes(ip)) { console.error("[mpesa-callback] ip not allowed:", ip); return new Response("Forbidden", { status: 403 }); }   // HARDENING 4
  }

  let body: any;
  try { body = await req.json(); } catch { console.error("[mpesa-callback] unparseable body"); return OK(); }
  try {
    const stk = body?.Body?.stkCallback;
    if (!stk?.CheckoutRequestID || typeof stk.CheckoutRequestID !== "string" || stk.CheckoutRequestID.length > 100) { console.error("[mpesa-callback] unrecognised payload shape"); return OK(); }

    const items: any[] = stk.CallbackMetadata?.Item ?? [];
    const pick = (n: string) => items.find((i) => i.Name === n)?.Value ?? null;
    const receipt = stk.ResultCode === 0 ? (pick("MpesaReceiptNumber") as string | null) : null;
    const paid = stk.ResultCode === 0 ? Number(pick("Amount")) : null;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: txn } = await supabase.from("lb_mpesa_transactions").select("id, amount, status").eq("checkout_request_id", stk.CheckoutRequestID).maybeSingle();
    if (!txn) { console.error("[mpesa-callback] unknown checkout id (not issued by this system)"); return OK(); }          // HARDENING 3

    if (stk.ResultCode === 0 && (!Number.isFinite(paid) || Math.abs((paid as number) - Number(txn.amount)) > 0.5 || !receipt)) {   // HARDENING 2
      console.error("[mpesa-callback] amount/receipt mismatch for txn", txn.id);
      if (txn.status === "PENDING") {
        await supabase.from("lb_mpesa_transactions").update({
          status: "NEEDS_ATTENTION", result_desc: `Callback amount ${paid} did not match requested ${txn.amount} (or no receipt). Not confirmed automatically.`,
          updated_at: new Date().toISOString(),
        }).eq("id", txn.id).eq("status", "PENDING");
      }
      return OK();
    }

    const { data, error } = await supabase.rpc("confirm_mpesa_payment", {
      p_checkout_request_id: stk.CheckoutRequestID, p_result_code: stk.ResultCode, p_result_desc: String(stk.ResultDesc ?? "").slice(0, 500),
      p_mpesa_receipt_number: receipt, p_raw_callback: body,
    });
    if (error) console.error("[mpesa-callback] confirm_mpesa_payment failed:", error.message);
    else console.log("[mpesa-callback] processed", txn.id, data);
    return OK();
  } catch (err) {
    console.error("[mpesa-callback] unhandled:", (err as Error)?.message);
    return OK();
  }
});
