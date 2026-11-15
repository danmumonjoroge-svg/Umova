// supabase/functions/comm-webhook/index.ts
//
// Delivery receipts from the providers. Deploy with --no-verify-jwt (providers send no Supabase login); each route has
// its own credential. A status is recorded ONLY because a provider reported it, and never moves backwards.
//
//   POST /comm-webhook/at?token=<COMM_WEBHOOK_TOKEN>        Africa's Talking delivery reports
//   POST /comm-webhook/resend?token=<COMM_WEBHOOK_TOKEN>    Resend events (sent / delivered / bounced / complained)
//   GET|POST /comm-webhook/whatsapp                         Meta: verified with WHATSAPP_VERIFY_TOKEN and signed with WHATSAPP_APP_SECRET
//
// NOT TESTED against live providers: no credentials were available.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseAfricasTalking, parseResend, parseWhatsApp, shouldAdvance, timingSafeEqual, verifyMetaSignature } from "../_shared/comm/webhooks.js";

const env = (k: string) => Deno.env.get(k);
const ok = () => new Response("ok", { status: 200 });

async function apply(updates: { provider: string; id: string; status: string; reason: string }[]) {
  const svc = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  for (const u of updates) {
    const { data: row } = await svc.from("lb_communication_log").select("id, status").eq("provider", u.provider).eq("provider_message_id", u.id).maybeSingle();
    if (!row || !shouldAdvance(row.status, u.status)) continue;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: u.status };
    if (u.status === "DELIVERED") patch.delivered_at = now;
    if (u.status === "READ") { patch.read_at = now; }
    if (u.status === "FAILED") { patch.failure_reason = u.reason || "The provider reported a failure."; patch.error_code = "DELIVERY_FAILED"; }
    if (u.status === "SENT") patch.sent_at = now;
    await svc.from("lb_communication_log").update(patch).eq("id", row.id);
  }
}

serve(async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.split("/").filter(Boolean).pop();
  try {
    if (route === "whatsapp") {
      if (req.method === "GET") {
        const ok1 = url.searchParams.get("hub.mode") === "subscribe" && timingSafeEqual(url.searchParams.get("hub.verify_token") ?? "", env("WHATSAPP_VERIFY_TOKEN") ?? "\0");
        return ok1 ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
      }
      const raw = await req.text();
      if (!(await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), env("WHATSAPP_APP_SECRET")))) return new Response("Forbidden", { status: 403 });
      await apply(parseWhatsApp(JSON.parse(raw)));
      return ok();
    }
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const token = env("COMM_WEBHOOK_TOKEN");
    if (!token || !timingSafeEqual(url.searchParams.get("token") ?? "", token)) return new Response("Forbidden", { status: 403 });
    if (route === "at") { await apply(parseAfricasTalking(new URLSearchParams(await req.text()))); return ok(); }
    if (route === "resend") { await apply(parseResend(await req.json())); return ok(); }
    return new Response("Not found", { status: 404 });
  } catch (e) {
    console.error("[comm-webhook]", e);
    return ok(); // providers retry on errors; a malformed receipt is not worth a retry storm
  }
});
