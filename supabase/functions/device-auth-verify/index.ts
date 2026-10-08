// supabase/functions/device-auth-verify/index.ts
//
// Native-app fingerprint sign-in, the server half.
//
// The phone's OS checks the fingerprint, which releases a random device secret from the Android Keystore.
// The app sends { deviceId, service, secret } here. We never see a fingerprint, only that secret.
//
//   1. verify_trusted_device_login() (service-role-only SQL function) checks SHA-256(secret) against
//      trusted_devices, refuses revoked devices, and rate-limits failures.
//   2. We confirm the account itself is still allowed in (not banned, not inactive/suspended), exactly like
//      webauthn-auth-verify does for passkeys.
//   3. We return { kind:"supabase", email, token_hash }. The app then calls
//      supabase.auth.verifyOtp({ token_hash, type:"magiclink" }) and gets a REAL Supabase session.
//      generateLink does NOT email anyone; the hash is single-use and only returned after step 1 passed.
//
// Services: "finance" (SACCO member/staff app) and "business" (My Business/POS). Chama has its own non-Supabase
// accounts and its own lock adapter, so it is deliberately rejected here.
// Deploy with verify_jwt = false (this is a pre-login endpoint, like webauthn-auth-verify).

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*", // no cookies/credentials are used; the device secret is the credential
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const STATUS_FOR_REASON: Record<string, number> = {
  BAD_INPUT: 400,
  INVALID: 401,
  REVOKED: 403,
  RATE_LIMITED: 429,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, reason: "METHOD_NOT_ALLOWED" }, 405);

  const body = await req.json().catch(() => ({}));
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId : "";
  const service = typeof body?.service === "string" ? body.service : "";
  const secret = typeof body?.secret === "string" ? body.secret : "";

  if (!["finance", "business"].includes(service) || !deviceId || !secret) {
    return reply({ ok: false, reason: "BAD_INPUT" }, 400);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Does this device hold a valid, un-revoked secret?
  const { data: v, error: vErr } = await db.rpc("verify_trusted_device_login", {
    p_device_id: deviceId,
    p_service: service,
    p_secret: secret,
  });
  if (vErr || !v) return reply({ ok: false, reason: "SERVER_ERROR" }, 500);
  if (!v.ok) return reply({ ok: false, reason: v.reason }, STATUS_FOR_REASON[v.reason] ?? 401);

  const userId: string = v.user_id;

  // 2. Is the account itself still allowed in? (checked server-side, never trusted from the phone)
  const { data: au, error: auErr } = await db.auth.admin.getUserById(userId);
  if (auErr || !au?.user) return reply({ ok: false, reason: "ACCOUNT_NOT_FOUND" }, 404);
  if (au.user.banned_until && new Date(au.user.banned_until) > new Date()) {
    return reply({ ok: false, reason: "ACCOUNT_INACTIVE" }, 403);
  }
  const email = au.user.email ?? null;
  if (!email) return reply({ ok: false, reason: "ACCOUNT_NOT_FOUND" }, 404);

  // Staff/member rows can be inactive/suspended (POS accounts have no row here; POS status is enforced by
  // get_pos_profile() right after sign-in, same as for a password login).
  for (const table of ["users", "members"]) {
    const { data: row } = await db.from(table).select("status").eq("auth_user_id", userId).maybeSingle();
    if (row && (row.status === "inactive" || row.status === "suspended")) {
      return reply({ ok: false, reason: "ACCOUNT_INACTIVE" }, 403);
    }
  }

  // 3. Hand back a single-use token the app exchanges for a real session.
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link?.properties?.hashed_token) return reply({ ok: false, reason: "SERVER_ERROR" }, 500);

  return reply({ ok: true, kind: "supabase", email, token_hash: link.properties.hashed_token });
});
