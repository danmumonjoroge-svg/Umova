// supabase/functions/c2b-hook/index.ts
//
// Safaricom calls this for every payment made to the business's till / paybill (C2B). Deploy with --no-verify-jwt:
// Safaricom sends no Supabase login, the secret is the long random token in the URL path.
//
//   <functions-url>/c2b-hook/<token>/confirmation   -> stores the payment in the "Received payments" inbox
//   <functions-url>/c2b-hook/<token>/validation     -> always answers "accepted" (we never block a customer's payment)
//
// The name has no "mpesa"/"safaricom" in it on purpose: Safaricom refuses to register URLs containing those words.
// All logic is in the database function record_mpesa_c2b() (phase43): this file only forwards. It always answers
// Safaricom {ResultCode:0} (anything else makes Safaricom retry for days); problems are logged for a human.
// Nothing here pays a bill. A cashier does that from the app.
//
// NOT TESTED against a live Daraja: no sandbox credentials were available.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OK = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { status: 200, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);   // [..., "c2b-hook", token, kind]
  const i = parts.indexOf("c2b-hook");
  const token = parts[i + 1] || "";
  const kind = (parts[i + 2] || "").toLowerCase();
  if (kind === "validation") return OK();
  if (kind !== "confirmation") return new Response("Not found", { status: 404 });

  let body: any;
  try { body = await req.json(); } catch { console.error("[c2b-hook] unreadable body"); return OK(); }
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data, error } = await supabase.rpc("record_mpesa_c2b", { p_token: token, p_payload: body });
    if (error) console.error("[c2b-hook] not recorded:", error.message, "TransID:", body?.TransID);
    else console.log("[c2b-hook] recorded", body?.TransID, JSON.stringify(data));
  } catch (err) {
    console.error("[c2b-hook] unhandled", err);
  }
  return OK();
});
