// supabase/functions/activate-member/index.ts
//
// Safe first-time setup for an EXISTING member.
// Input:  { memberNo, nationalId, password }
// Output: { ok: true, email } | { ok: false, reason }
//
// Security rules:
// - Never change the password of an existing Auth account here.
// - Never automatically attach an existing Auth account by email.
// - Existing or conflicting links require the member password-recovery flow
//   or a controlled administrative repair.
// - This function updates the existing members row; it never creates a member.
//
// Deploy only after testing:
// supabase functions deploy activate-member --no-verify-jwt --project-ref tejzcwftbvcojvpczxbm

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

const strongEnough = (password: string) =>
  password.length >= 8 &&
  password.length <= 72 &&
  /[A-Z]/.test(password) &&
  /[a-z]/.test(password) &&
  /[0-9]/.test(password);

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
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
  const password = String(body?.password ?? "");

  if (!memberNo || !nationalId || !password) {
    return json({ ok: false, reason: "INVALID_DETAILS" }, 400);
  }
  if (!strongEnough(password)) {
    return json({ ok: false, reason: "WEAK_PASSWORD" }, 400);
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
    // Fail closed if the rate-limit table cannot be checked.
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count, error: rateError } = await admin
      .from("member_activation_attempts")
      .select("id", { count: "exact", head: true })
      .eq("member_no", memberNo)
      .gte("created_at", since);

    if (rateError) {
      console.error("Activation rate-limit lookup failed", rateError);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }
    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return json({ ok: false, reason: "RATE_LIMITED" }, 429);
    }

    const fail = async () => {
      const { error: attemptError } = await admin
        .from("member_activation_attempts")
        .insert({ member_no: memberNo });
      if (attemptError) {
        console.error("Could not record failed activation attempt", attemptError);
        return json({ ok: false, reason: "SERVER_ERROR" }, 500);
      }
      return json({ ok: false, reason: "INVALID_DETAILS" }, 401);
    };

    // Find exactly one existing membership row. Never create a member here.
    const { data: rows, error: memberError } = await admin
      .from("members")
      .select("id, member_no, email, national_id, status, password_set, auth_user_id, auth_id")
      .eq("member_no", memberNo)
      .limit(2);

    if (memberError) {
      console.error("Member lookup failed", memberError);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }
    if (!rows || rows.length === 0) return await fail();
    if (rows.length > 1) {
      console.error("Duplicate member number; activation refused", memberNo);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    const member: any = rows[0];
    if (!safeEqual(String(member.national_id ?? "").trim(), nationalId)) {
      return await fail();
    }

    const status = String(member.status ?? "").trim().toLowerCase();
    if (status === "inactive" || status === "suspended") {
      return json({ ok: false, reason: "ACCOUNT_INACTIVE" }, 403);
    }

    const email = String(member.email ?? "").trim().toLowerCase();
    if (!email) return json({ ok: false, reason: "NO_EMAIL" }, 422);

    const authUserId = member.auth_user_id ? String(member.auth_user_id) : null;
    const authId = member.auth_id ? String(member.auth_id) : null;

    // Conflicting links are an administrative repair case, not an activation case.
    if (authUserId && authId && authUserId !== authId) {
      console.error("Conflicting Auth IDs on member; activation refused", memberNo);
      return json({ ok: false, reason: "ALREADY_ACTIVE" }, 409);
    }

    // Any stored Auth link means this is not a clean first-time activation.
    // Never update the password of that account from this endpoint.
    const existingLink = authUserId || authId;
    if (existingLink) {
      const { data: linkedUser, error: linkedUserError } =
        await admin.auth.admin.getUserById(existingLink);

      if (linkedUserError || !linkedUser?.user) {
        console.error("Stored Auth link cannot be verified; activation refused", memberNo);
        return json({ ok: false, reason: "ALREADY_ACTIVE" }, 409);
      }

      // The account exists even if password_set is false. Direct the member to
      // the recovery route; do not set its password in first-time setup.
      return json({ ok: false, reason: "ALREADY_ACTIVE" }, 409);
    }

    if (member.password_set === true || String(member.password_set).toLowerCase() === "true") {
      // Legacy inconsistency: flag says active but no Auth link exists.
      // Do not silently create/relink an account or alter this flag.
      console.error("Legacy member flagged active without Auth link; review required", memberNo);
      return json({ ok: false, reason: "ALREADY_ACTIVE" }, 409);
    }

    // Avoid creating an account against an email already assigned to another
    // membership row. This check is case-insensitive and fails closed on errors.
    const { data: emailMembers, error: emailMemberError } = await admin
      .from("members")
      .select("id")
      .ilike("email", email)
      .neq("id", member.id)
      .limit(1);

    if (emailMemberError) {
      console.error("Email membership check failed", emailMemberError);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }
    if ((emailMembers ?? []).length > 0) {
      console.error("Email is present on another member row; activation refused", memberNo);
      return json({ ok: false, reason: "SERVER_ERROR" }, 409);
    }

    // Create a new Auth account only. If the email already exists in Auth,
    // do not find, reuse, link, confirm, or change that account.
    const { data: createdData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !createdData?.user) {
      console.error("Auth account creation failed; existing accounts are never reused", createError);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    const newAuthId = createdData.user.id;

    // Link and mark active on the SAME members row.
    const { error: updateError } = await admin
      .from("members")
      .update({
        auth_user_id: newAuthId,
        auth_id: newAuthId,
        password_set: "true",
        first_login: false,
        first_time_login: false,
      })
      .eq("id", member.id)
      .is("auth_user_id", null)
      .is("auth_id", null);

    if (updateError) {
      console.error("Member activation update failed", updateError);
      await admin.auth.admin.deleteUser(newAuthId);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    // Check that the guarded update actually affected the row. A concurrent
    // request may have changed its links after our initial read.
    const { data: verifyRows, error: verifyError } = await admin
      .from("members")
      .select("id, auth_user_id, auth_id")
      .eq("id", member.id)
      .limit(1);

    if (verifyError || !verifyRows?.[0] ||
        verifyRows[0].auth_user_id !== newAuthId ||
        verifyRows[0].auth_id !== newAuthId) {
      console.error("Member/Auth link verification failed", verifyError);
      await admin.auth.admin.deleteUser(newAuthId);
      return json({ ok: false, reason: "SERVER_ERROR" }, 500);
    }

    return json({ ok: true, email });
  } catch (error) {
    console.error("activate-member failed", error);
    return json({ ok: false, reason: "SERVER_ERROR" }, 500);
  }
});
