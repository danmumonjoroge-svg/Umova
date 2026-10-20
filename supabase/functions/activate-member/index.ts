// supabase/functions/member-forgot-password/index.ts
// Verifies member no + national ID on the server, then emails the reset link.
// Input: { memberNo, nationalId }   Output: { ok:true, maskedEmail } | { ok:false, reason }
// Deploy: supabase functions deploy member-forgot-password
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, reason: "INVALID_DETAILS" }, 400); }
  const memberNo = String(body?.memberNo ?? "").trim().toUpperCase();
  const nationalId = String(body?.nationalId ?? "").trim();
  if (!memberNo || !nationalId) return json({ ok: false, reason: "INVALID_DETAILS" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count } = await admin.from("member_activation_attempts")
    .select("id", { count: "exact", head: true }).eq("member_no", memberNo).gte("created_at", since);
  if ((count ?? 0) >= 5) return json({ ok: false, reason: "RATE_LIMITED" }, 429);

  const { data: m } = await admin.from("members")
    .select("email, national_id, status, password_set").eq("member_no", memberNo).maybeSingle();

  if (!m || String(m.national_id ?? "").trim() !== nationalId) {
    await admin.from("member_activation_attempts").insert({ member_no: memberNo });
    return json({ ok: false, reason: "INVALID_DETAILS" }, 401);
  }
  if (m.status === "inactive" || m.status === "suspended") return json({ ok: false, reason: "ACCOUNT_INACTIVE" }, 403);
  if (!(m.password_set === true || m.password_set === "true")) return json({ ok: false, reason: "NOT_ACTIVATED" }, 409);
  if (!m.email) return json({ ok: false, reason: "NO_EMAIL" }, 422);

  const origin = req.headers.get("origin") ?? Deno.env.get("SITE_URL") ?? "";
  const { error } = await admin.auth.resetPasswordForEmail(m.email, { redirectTo: `${origin}/set-password` });
  if (error) { console.error(error); return json({ ok: false, reason: "SERVER_ERROR" }, 500); }

  return json({ ok: true, maskedEmail: String(m.email).replace(/(.{2}).*@/, "$1***@") });
});
