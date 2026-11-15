// supabase/functions/device-auth-verify/index.ts
//
// Fingerprint sign-in when there is NO session yet (fresh app start / after logout).
//
//   phone:  fingerprint releases the device secret from the Android Keystore
//           -> POST { deviceId, service, secret }
//   server: sha256(secret) must match a trusted, non-revoked device
//           -> mint a ONE-TIME magic-link token for that account
//   phone:  supabase.auth.verifyOtp({ token_hash, type: "magiclink" }) turns it into a real session
//
// Fingerprint only proves "this is the enrolled phone". It never grants roles or money authority:
// roles still come from the normal session + RLS.
//
// Deploy:  supabase functions deploy device-auth-verify
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SERVICES = ["finance", "business", "chama"];
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const sha256Hex = async (s: string) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
};
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
  try { body = await req.json(); } catch { return json({ ok: false, reason: "INVALID" }, 400); }

  const deviceId = String(body?.deviceId ?? "");
  const service = String(body?.service ?? "");
  const secret = String(body?.secret ?? "");
  if (deviceId.length < 8 || deviceId.length > 100 || !SERVICES.includes(service) || !/^[0-9a-f]{64}$/.test(secret)) {
    return json({ ok: false, reason: "INVALID" }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const hash = await sha256Hex(secret);
    const now = Date.now();

    // Every row registered for this phone + service (usually one; more only on a shared phone).
    const { data: rows, error: rErr } = await admin
      .from("trusted_devices")
      .select("id, user_id, secret_hash, revoked_at, fail_count, locked_until")
      .eq("device_id", deviceId)
      .eq("service", service);
    if (rErr) { console.error("lookup", rErr); return json({ ok: false, reason: "SERVER_ERROR" }, 500); }

    const match = (rows ?? []).find((r: any) => safeEqual(String(r.secret_hash), hash));

    if (!match) {
      // Wrong secret for a known phone: count it, lock after repeated failures. Same answer either way.
      let locked = false;
      for (const r of rows ?? []) {
        if (r.locked_until && new Date(r.locked_until).getTime() > now) locked = true;
        const fails = (r.fail_count ?? 0) + 1;
        await admin.from("trusted_devices")
          .update({ fail_count: fails, locked_until: fails >= MAX_FAILS ? new Date(now + LOCK_MS).toISOString() : r.locked_until })
          .eq("id", r.id);
        if (fails >= MAX_FAILS) locked = true;
      }
      return locked ? json({ ok: false, reason: "RATE_LIMITED" }, 429) : json({ ok: false, reason: "INVALID" }, 401);
    }

    if (match.revoked_at) return json({ ok: false, reason: "REVOKED" }, 401);
    if (match.locked_until && new Date(match.locked_until).getTime() > now) {
      return json({ ok: false, reason: "RATE_LIMITED" }, 429);
    }

    // Is the account still allowed in? (finance: staff in `users`, members in `members`)
    if (!(await accountActive(admin, match.user_id, service))) {
      return json({ ok: false, reason: "ACCOUNT_INACTIVE" }, 403);
    }

    const { data: u, error: uErr } = await admin.auth.admin.getUserById(match.user_id);
    const email = u?.user?.email;
    if (uErr || !email || (u.user as any).banned_until && new Date((u.user as any).banned_until).getTime() > now) {
      return json({ ok: false, reason: uErr || !email ? "SERVER_ERROR" : "ACCOUNT_INACTIVE" }, uErr || !email ? 500 : 403);
    }

    const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link?.properties?.hashed_token;
    if (lErr || !tokenHash) { console.error("generateLink", lErr); return json({ ok: false, reason: "SERVER_ERROR" }, 500); }

    await admin.from("trusted_devices")
      .update({ last_used_at: new Date(now).toISOString(), fail_count: 0, locked_until: null })
      .eq("id", match.id);

    // Best-effort audit entry; never blocks sign-in.
    try {
      await admin.from("audit_logs").insert({
        id: crypto.randomUUID(), action: "DEVICE_LOGIN", table_name: "trusted_devices", record_id: match.id,
        user_id: match.user_id, email, performed_by: email, created_at: new Date(now).toISOString(),
        details: { service, device_id: deviceId },
      });
    } catch { /* ignore */ }

    return json({ ok: true, kind: "supabase", token_hash: tokenHash });
  } catch (e) {
    console.error("device-auth-verify", e);
    return json({ ok: false, reason: "SERVER_ERROR" }, 500);
  }
});

const BLOCKED = ["inactive", "suspended"];

async function accountActive(admin: any, userId: string, service: string): Promise<boolean> {
  if (service !== "finance") return true; // other services: the auth ban check above is the gate

  const [{ data: staff }, { data: m1 }, { data: m2 }] = await Promise.all([
    admin.from("users").select("status").eq("auth_user_id", userId).limit(5),
    admin.from("members").select("status").eq("auth_user_id", userId).limit(5),
    admin.from("members").select("status").eq("auth_id", userId).limit(5),
  ]);
  const found = [...(staff ?? []), ...(m1 ?? []), ...(m2 ?? [])];
  if (found.length === 0) return false; // no staff or member record at all: do not let this account in
  // Fail closed: if ANY matching record is suspended/inactive, refuse.
  return found.every((r: any) => !BLOCKED.includes(String(r.status ?? "active").toLowerCase()));
}
