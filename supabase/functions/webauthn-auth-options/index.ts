// supabase/functions/webauthn-auth-options/index.ts
//
// Public endpoint (no auth header required — you don't have a session
// yet, that's the point). Takes the same identifier UnifiedLogin.js
// already collects ("UI-0004" style code), resolves it to an auth
// user using the same staff-then-member precedence as
// resolveStaffLogin/resolveMemberLogin, and — only if that account has
// a registered passkey — returns WebAuthn authentication options.
//
// Deliberately vague on failure ({ available: false }) so this can't be
// used to enumerate which codes exist in the system.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateAuthenticationOptions } from "https://esm.sh/@simplewebauthn/server@14";

const RP_ID = Deno.env.get("WEBAUTHN_RP_ID")!;

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { identifier } = await req.json();
  if (!identifier) return new Response("Missing identifier", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

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

  const notAvailable = () =>
    new Response(JSON.stringify({ available: false }), {
      headers: { "Content-Type": "application/json" },
    });

  if (!authUserId) return notAvailable();

  const { data: creds } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", authUserId);

  if (!creds || creds.length === 0) return notAvailable();

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

  return new Response(JSON.stringify({ available: true, options }), {
    headers: { "Content-Type": "application/json" },
  });
});
