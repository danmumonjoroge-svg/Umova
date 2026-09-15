// supabase/functions/webauthn-auth-options/index.ts
//
// Public endpoint (no auth header required — you don't have a session
// yet, that's the point).
//
// Two modes:
//
// 1. USERNAMELESS (no identifier) — the fingerprint-only flow. Returns
//    options with NO allowCredentials, which tells the browser to offer
//    every discoverable credential it holds for this site. The user picks
//    an account inside the OS prompt (or it's chosen automatically if
//    there's only one), and we don't learn who they are until the
//    assertion comes back to webauthn-auth-verify. The challenge is
//    therefore stored with a null user_id.
//
// 2. IDENTIFIER-FIRST (identifier supplied) — the original behaviour,
//    kept so existing non-discoverable passkeys registered before this
//    change still work. Those credentials can't be found without an
//    explicit allowCredentials list.
//
// Deliberately vague on failure ({ available: false }) so this can't be
// used to enumerate which codes exist in the system.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateAuthenticationOptions } from "https://esm.sh/@simplewebauthn/server@14";

const RP_ID = Deno.env.get("WEBAUTHN_RP_ID")!;

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const body = await req.json().catch(() => ({}));
  const identifier: string | undefined = body?.identifier;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  // ── Mode 1: usernameless ────────────────────────────────────────────
  if (!identifier) {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      // Required, not preferred: with no identifier, the biometric check
      // IS the authentication. Anything less would let mere possession of
      // an unlocked device sign in as the account owner.
      userVerification: "required",
      // Omitted entirely — this is what makes the browser surface all
      // discoverable credentials for this site.
      allowCredentials: [],
    });

    await supabase.from("webauthn_challenges").insert({
      user_id: null, // not known yet; resolved from the assertion at verify time
      challenge: options.challenge,
      type: "authentication",
    });

    return json({ available: true, options });
  }

  // ── Mode 2: identifier-first (legacy credentials) ───────────────────
  const code = identifier.trim().toUpperCase();
  let authUserId: string | null = null;

  const { data: staffRow } = await supabase
    .from("users").select("auth_user_id").eq("member_no", code).maybeSingle();
  if (staffRow?.auth_user_id) {
    authUserId = staffRow.auth_user_id;
  } else {
    const { data: memberRow } = await supabase
      .from("members").select("auth_user_id").eq("member_no", code).maybeSingle();
    if (memberRow?.auth_user_id) authUserId = memberRow.auth_user_id;
  }

  if (!authUserId) return json({ available: false });

  const { data: creds } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", authUserId);

  if (!creds || creds.length === 0) return json({ available: false });

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    allowCredentials: creds.map((c) => ({
      id: c.credential_id,
      type: "public-key",
      transports: c.transports ?? undefined,
    })),
  });

  await supabase.from("webauthn_challenges").insert({
    user_id: authUserId,
    challenge: options.challenge,
    type: "authentication",
  });

  return json({ available: true, options });
});
