// supabase/functions/member-forgot-password/index.ts
//
// Verifies the existing membership record and its Auth link, then emails a
// Supabase password-recovery link. A false password_set flag does not block
// recovery when a valid, matching Auth account is already linked.
//
// Input:  { memberNo, nationalId }
// Output: { ok: true, maskedEmail } | { ok: false, reason }
//
// Configure SITE_URL as the canonical web-app origin, for example:
// https://umova.vercel.app
// The /set-password redirect must also be allowed in Supabase Auth URL settings.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
};

const maskEmail = (email: string) => {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "SERVER_ERROR" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "INVALID_DETAILS" }, 400);
  }

  const memberNo = String(body?.memberNo ?? "").trim().toUpperCase();
  const nationalId = String(body?.nationalId ?? "").trim();
  if (!memberNo || !nationalId) {
    return json({ ok: false, reason: "INVALID_DETAILS" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Required Supabase environment variables are missing");
    return json({ ok: false, reason: "SERVER_ERROR" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Fail closed if rate-limit storage cannot be checked.
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count, error: rateError } = await admin
      .from("member_activation_attempts")
      .select("id", { count: "exact", head: true })
      .eq("member_no", memberNo)
      .gte("created_at", since);

    if (rateError) {
      console.error("Recovery rate-limit lookup failed", rateError);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }
    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return json({ ok: false, reason: "RATE_LIMITED" }, 429);
    }

    const recordFailedAttempt = async () => {
      const { error } = await admin
        .from("member_activation_attempts")
        .insert({ member_no: memberNo });
      if (error) console.error("Could not record failed recovery attempt", error);
    };

    const { data: rows, error: memberError } = await admin
      .from("members")
      .select("id, email, national_id, status, password_set, auth_user_id, auth_id")
      .eq("member_no", memberNo)
      .limit(2);

    if (memberError) {
      console.error("Recovery member lookup failed", memberError);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    if (!rows || rows.length !== 1) {
      await recordFailedAttempt();
      return json({ ok: false, reason: "INVALID_DETAILS" }, 401);
    }

    const member: any = rows[0];
    if (!safeEqual(String(member.national_id ?? "").trim(), nationalId)) {
      await recordFailedAttempt();
      return json({ ok: false, reason: "INVALID_DETAILS" }, 401);
    }

    const status = String(member.status ?? "").trim().toLowerCase();
    if (status === "inactive" || status === "suspended") {
      return json({ ok: false, reason: "ACCOUNT_INACTIVE" }, 403);
    }

    const memberEmail = String(member.email ?? "").trim().toLowerCase();
    if (!memberEmail) return json({ ok: false, reason: "NO_EMAIL" }, 422);

    const authUserId = member.auth_user_id ? String(member.auth_user_id) : null;
    const authId = member.auth_id ? String(member.auth_id) : null;

    if (authUserId && authId && authUserId !== authId) {
      console.error("Conflicting Auth IDs; password recovery refused", member.member_no);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    const linkedId = authUserId || authId;
    if (!linkedId) {
      // Do not send a recovery link merely because the email exists on the row.
      // Legacy records without a link need controlled account repair.
      if (member.password_set === true || String(member.password_set).toLowerCase() === "true") {
        console.error("Legacy member flagged active without Auth link; review required", member.member_no);
        return json({ ok: false, reason: "SERVER_ERROR" }, 409);
      }
      return json({ ok: false, reason: "NOT_ACTIVATED" }, 409);
    }

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(linkedId);
    const authUser = userData?.user;
    if (userError || !authUser) {
      console.error("Linked Auth account could not be verified; recovery refused", member.member_no);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    const authEmail = String(authUser.email ?? "").trim().toLowerCase();
    if (!authEmail || authEmail !== memberEmail) {
      // Protect mismatched records such as a member row with a stale/missing
      // email. Never send a recovery email to an unverified alternate address.
      console.error("Member email does not match linked Auth email; recovery refused", member.member_no);
      return json({ ok: false, reason: "SERVER_ERROR" }, 409);
    }

    // Never trust the browser's Origin header for a password-reset redirect.
    const configuredSiteUrl = Deno.env.get("SITE_URL");
    if (!configuredSiteUrl) {
      console.error("SITE_URL is not configured for password recovery");
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    let siteUrl: URL;
    try {
      siteUrl = new URL(configuredSiteUrl);
    } catch {
      console.error("SITE_URL is not a valid URL");
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    if (siteUrl.protocol !== "https:" && siteUrl.hostname !== "localhost" && siteUrl.hostname !== "127.0.0.1") {
      console.error("SITE_URL must use HTTPS outside localhost");
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    const redirectTo = `${siteUrl.origin}/set-password`;
    const { error: resetError } = await admin.auth.resetPasswordForEmail(authEmail, {
      redirectTo,
    });

    if (resetError) {
      console.error("Supabase password-recovery email failed", resetError);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    return json({ ok: true, maskedEmail: maskEmail(authEmail) });
  } catch (error) {
    console.error("member-forgot-password failed", error);
    return json({ ok: false, reason: "SERVER_ERROR" }, 500);
  }
});
