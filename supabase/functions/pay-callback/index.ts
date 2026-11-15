// supabase/functions/activate-member/index.ts
//
// First-time setup for an EXISTING member:  member no + national ID + new password.
// Input : { memberNo, nationalId, password }
// Output: { ok:true, email } | { ok:false, reason }
//   reasons (match AuthPage.js ACTIVATE_MESSAGES): INVALID_DETAILS, ALREADY_ACTIVE, ACCOUNT_INACTIVE,
//   NO_EMAIL, WEAK_PASSWORD, RATE_LIMITED, SERVER_ERROR
//
// The members row is NEVER created here, only linked and updated, so no second member appears.
// Deploy: supabase functions deploy activate-member --no-verify-jwt --project-ref tejzcwftbvcojvpczxbm

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

const strongEnough = (p: string) =>
  p.length >= 8 && p.length <= 72 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p);

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "SERVER_ERROR" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, reason: "INVALID_DETAILS" }, 400); }

  const memberNo = String(body?.memberNo ?? "").trim().toUpperCase();
  const nationalId = String(body?.nationalId ?? "").trim();
  const password = String(body?.password ?? "");
  if (!memberNo || !nationalId || !password) return json({ ok: false, reason: "INVALID_DETAILS" }, 400);
  if (!strongEnough(password)) return json({ ok: false, reason: "WEAK_PASSWORD" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 1. Rate limit (failed attempts per member number)
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await admin.from("member_activation_attempts")
      .select("id", { count: "exact", head: true }).eq("member_no", memberNo).gte("created_at", since);
    if ((count ?? 0) >= MAX_ATTEMPTS) return json({ ok: false, reason: "RATE_LIMITED" }, 429);

    const fail = async () => {
      await admin.from("member_activation_attempts").insert({ member_no: memberNo });
      return json({ ok: false, reason: "INVALID_DETAILS" }, 401);
    };

    // 2. Find the EXISTING member row. Two rows with one number = ambiguous, refuse.
    const { data: rows, error: mErr } = await admin.from("members")
      .select("id, member_no, email, national_id, status, password_set, auth_user_id, auth_id")
      .eq("member_no", memberNo).limit(2);
    if (mErr) { console.error("member lookup", mErr); return json({ ok: false, reason: "SERVER_ERROR" }, 500); }
    if (!rows || rows.length === 0) return await fail();
    if (rows.length > 1) { console.error("duplicate member_no", memberNo); return json({ ok: false, reason: "SERVER_ERROR" }, 500); }
    const m: any = rows[0];

    if (!safeEqual(String(m.national_id ?? "").trim(), nationalId)) return await fail();

    // 3. Gates
    const status = String(m.status ?? "").toLowerCase();
    if (status === "inactive" || status === "suspended") return json({ ok: false, reason: "ACCOUNT_INACTIVE" }, 403);
    if (m.password_set === true || m.password_set === "true") return json({ ok: false, reason: "ALREADY_ACTIVE" }, 409);
    const email = String(m.email ?? "").trim().toLowerCase();
    if (!email) return json({ ok: false, reason: "NO_EMAIL" }, 422);

    // 4. Get or create the auth user
    let authId: string | null = null;
    let created = false;

    const linked = m.auth_user_id || m.auth_id;
    if (linked) {
      const { data: g } = await admin.auth.admin.getUserById(linked);
      if (g?.user) authId = g.user.id; // else: dead link, fall through and make a fresh one
    }

    if (!authId) {
      const { data: c, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (c?.user) { authId = c.user.id; created = true; }
      else {
        // Email already has an auth user: reuse it only if it is not someone else's account.
        const msg = String(cErr?.message ?? "").toLowerCase();
        if (!(msg.includes("already") || msg.includes("exists") || msg.includes("registered"))) {
          console.error("createUser", cErr); return json({ ok: false, reason: "SERVER_ERROR" }, 500);
        }
        let found: any = null;
        for (let page = 1; page <= 20 && !found; page++) {
          const { data: l, error: lErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (lErr) { console.error("listUsers", lErr); return json({ ok: false, reason: "SERVER_ERROR" }, 500); }
          found = l.users.find((u: any) => String(u.email ?? "").toLowerCase() === email) ?? null;
          if (l.users.length < 1000) break;
        }
        if (!found) { console.error("auth user vanished", email); return json({ ok: false, reason: "SERVER_ERROR" }, 500); }

        // Refuse to take over an account that belongs to another member or to staff.
        const [{ data: otherM }, { data: staff }] = await Promise.all([
          admin.from("members").select("id").or(`auth_user_id.eq.${found.id},auth_id.eq.${found.id}`).neq("id", m.id).limit(1),
          admin.from("users").select("id").eq("auth_user_id", found.id).limit(1),
        ]);
        if ((otherM?.length ?? 0) > 0 || (staff?.length ?? 0) > 0) {
          console.error("email belongs to another account", memberNo);
          return json({ ok: false, reason: "SERVER_ERROR" }, 500);
        }
        authId = found.id;
      }
    }

    // 5. Set the password on the existing auth user (skip if we just created it with it)
    if (!created) {
      const { error: uErr } = await admin.auth.admin.updateUserById(authId!, { password, email_confirm: true });
      if (uErr) { console.error("updateUser", uErr); return json({ ok: false, reason: "SERVER_ERROR" }, 500); }
    }

    // 6. Link + mark activated on the SAME members row
    const { error: upErr } = await admin.from("members").update({
      auth_user_id: authId,
      auth_id: authId,
      password_set: "true",
      first_login: false,
      first_time_login: false,
    }).eq("id", m.id);
    if (upErr) {
      console.error("member update", upErr);
      if (created) await admin.auth.admin.deleteUser(authId!); // undo, so a retry starts clean
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    return json({ ok: true, email });
  } catch (e) {
    console.error("activate-member", e);
    return json({ ok: false, reason: "SERVER_ERROR" }, 500);
  }
});
