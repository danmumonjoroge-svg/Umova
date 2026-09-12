// supabase/functions/webauthn-register-options/index.ts
//
// Called by an ALREADY LOGGED IN user who wants to add a passkey
// (Face ID / Fingerprint / Windows Hello) to their account. Requires a
// valid Supabase access token in the Authorization header — you cannot
// register a passkey for an account you haven't already password-logged
// into once.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateRegistrationOptions } from "https://esm.sh/@simplewebauthn/server@14";

const RP_NAME = "Umova";
const RP_ID = Deno.env.get("WEBAUTHN_RP_ID")!; // e.g. "umova.app" — no scheme, no port

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return new Response("Missing auth token", { status: 401 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) return new Response("Invalid session", { status: 401 });

  // Existing passkeys, so the authenticator can skip ones already registered.
  const { data: existing } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", user.id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email ?? user.id,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: "platform", // Face ID / Touch ID / Windows Hello
    },
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id,
      type: "public-key",
      transports: c.transports ?? undefined,
    })),
  });

  await supabase.from("webauthn_challenges").insert({
    user_id: user.id,
    email: user.email,
    challenge: options.challenge,
    type: "registration",
  });

  return new Response(JSON.stringify(options), {
    headers: { "Content-Type": "application/json" },
  });
});
