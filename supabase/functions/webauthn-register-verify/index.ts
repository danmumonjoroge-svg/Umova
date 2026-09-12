// supabase/functions/webauthn-register-verify/index.ts
//
// Verifies the browser's attestationResponse against the challenge we
// stored in webauthn-register-options, then stores the new passkey.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyRegistrationResponse } from "https://esm.sh/@simplewebauthn/server@14";
import { encode as b64uEncode } from "https://deno.land/std@0.203.0/encoding/base64url.ts";

const RP_ID = Deno.env.get("WEBAUTHN_RP_ID")!;
const ORIGIN = Deno.env.get("WEBAUTHN_ORIGIN")!; // e.g. "https://umova.app"

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return new Response("Missing auth token", { status: 401 });

  const { attestationResponse, nickname } = await req.json();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) return new Response("Invalid session", { status: 401 });

  const { data: challengeRow } = await supabase
    .from("webauthn_challenges")
    .select("*")
    .eq("user_id", user.id)
    .eq("type", "registration")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challengeRow) return new Response("Challenge expired — please try again.", { status: 400 });

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
  } catch (err) {
    return new Response(`Verification failed: ${err.message}`, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return new Response("Passkey could not be verified.", { status: 400 });
  }

  // As of @simplewebauthn/server v11+, these live under `credential`, and
  // `credential.id` already arrives as a base64url string (no manual
  // encoding needed) — only the public key is still raw bytes.
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  await supabase.from("webauthn_credentials").insert({
    user_id: user.id,
    credential_id: credential.id,
    public_key: b64uEncode(credential.publicKey),
    counter: credential.counter,
    device_type: credentialDeviceType,
    backed_up: credentialBackedUp,
    transports: credential.transports ?? attestationResponse.response?.transports ?? [],
    nickname: nickname || "Passkey",
  });

  await supabase.from("webauthn_challenges").delete().eq("id", challengeRow.id);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
