// supabase/functions/elimu-parent-access/index.ts   (copy this folder to supabase/functions/ and deploy WITH --no-verify-jwt)
//
// WHY --no-verify-jwt: the browser sends an OPTIONS "preflight" with no sign-in header first. With gateway JWT checking on, Supabase answers that
// preflight with 401, and the browser reports "CORS ... does not have HTTP ok status". This function checks the sign-in itself: it calls
// elimu_parent_issue AS THE CALLER, and the database refuses anyone without guardians.manage (so no header = no access).
//   supabase functions deploy elimu-parent-access --no-verify-jwt
// or in supabase/config.toml:  [functions.elimu-parent-access]  enabled = true  verify_jwt = false
//
// "The school gave a parent a login." Body: { guardian_id, reset?: boolean }.  Needs the staff member's own sign-in.
//
// 1. Calls elimu_parent_issue AS THE STAFF MEMBER (SQL checks the guardians.manage permission and picks the username + one-time password).
// 2. With the service key, creates the parent's Supabase Auth user (or sets a new password on reset) -- the only step that needs the key.
// 3. Calls elimu_parent_attach so the login is tied to that guardian's children.
// The one-time password is returned once to the staff member and is never stored by us.
//
// NOT TESTED against a live Supabase project: written from the Supabase JS v2 admin API.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "METHOD" });
  const auth = req.headers.get("Authorization");
  if (!auth) return json(401, { error: "NO_LOGIN", message: "Please sign in again." });
  let body: { guardian_id?: string; reset?: boolean } = {};
  try { body = await req.json(); } catch { /* */ }
  if (!body.guardian_id) return json(400, { error: "BAD_REQUEST", message: "Missing guardian." });

  const user = createClient(env("SUPABASE_URL")!, env("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const issued = await user.rpc("elimu_parent_issue", { p_guardian: body.guardian_id, p_reset: !!body.reset });
  if (issued.error) return json(issued.error.code === "42501" ? 403 : 409, { error: issued.error.code, message: issued.error.message });
  const r = issued.data as { tenant_id: string; guardian_id: string; username: string; email: string; school_code: string; temp_password: string; auth_user_id: string | null; name: string };

  const svc = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let uid = r.auth_user_id;
  if (uid) {
    const u = await svc.auth.admin.updateUserById(uid, { password: r.temp_password, email_confirm: true });
    if (u.error) return json(502, { error: "AUTH_UPDATE", message: "Could not set the new password. Try again." });
  } else {
    const c = await svc.auth.admin.createUser({ email: r.email, password: r.temp_password, email_confirm: true, user_metadata: { elimu_role: "parent", username: r.username } });
    if (c.error || !c.data?.user) return json(502, { error: "AUTH_CREATE", message: "Could not create the login. Try again." });
    uid = c.data.user.id;
  }
  const a = await svc.rpc("elimu_parent_attach", { p_tenant: r.tenant_id, p_guardian: r.guardian_id, p_auth: uid });
  if (a.error) return json(500, { error: "ATTACH", message: "The login was created but could not be linked. Press the button again." });
  return json(200, { ok: true, name: r.name, username: r.username, school_code: r.school_code, temp_password: r.temp_password });
});
