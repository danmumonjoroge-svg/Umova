// supabase/functions/webauthn-auth-verify/index.ts
//
// Verifies the assertion from the browser against the stored credential
// and challenge. On success, Supabase gives us no "sign in with an
// already-proven identity" API, so we use the standard workaround:
// generate a magic-link token server-side (service role only — never
// exposed) and hand the raw token back to the client. The client then
// calls supabase.auth.verifyOtp({ email, token, type: "magiclink" }) to
// actually establish the session. The email is never re-sent — we only
// use generateLink's token value, not its delivery.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuthenticationResponse } from "https://esm.sh/@simplewebauthn/server@14";
import { decode as b64uDecode } from "https://deno.land/std@0.203.0/encoding/base64url.ts";

const RP_ID = Deno.env.get("WEBAUTHN_RP_ID")!;
const ORIGIN = Deno.env.get("WEBAUTHN_ORIGIN")!;

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { identifier, assertionResponse } = await req.json();
  if (!identifier || !assertionResponse) return new Response("Missing fields", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const code = identifier.trim().toUpperCase();
  let authUserId: string | null = null;
  let email: string | null = null;

  const { data: staffRow } = await supabase
    .from("users").select("auth_user_id, email, status").eq("member_no", code).maybeSingle();
  if (staffRow?.auth_user_id) {
    if (staffRow.status === "inactive" || staffRow.status === "suspended") {
      return new Response("Account is not active.", { status: 403 });
    }
    authUserId = staffRow.auth_user_id;
    email = staffRow.email;
  } else {
    const { data: memberRow } = await supabase
      .from("members").select("auth_user_id, email, status").eq("member_no", code).maybeSingle();
    if (memberRow?.auth_user_id) {
      if (memberRow.status === "inactive" || memberRow.status === "suspended") {
        return new Response("Account is not active.", { status: 403 });
      }
      authUserId = memberRow.auth_user_id;
      email = memberRow.email;
    }
  }

  if (!authUserId || !email) return new Response("Not found", { status: 404 });

  const { data: credRow } = await supabase
    .from("webauthn_credentials")
    .select("*")
    .eq("user_id", authUserId)
    .eq("credential_id", assertionResponse.id)
    .maybeSingle();
  if (!credRow) return new Response("Unknown passkey.", { status: 400 });

  const { data: challengeRow } = await supabase
    .from("webauthn_challenges")
    .select("*")
    .eq("user_id", authUserId)
    .eq("type", "authentication")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!challengeRow) return new Response("Challenge expired — please try again.", { status: 400 });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      // As of @simplewebauthn/server v11+, this argument is `credential`
      // (was `authenticator`), and `id` is the base64url string as
      // stored — only the public key needs decoding back to bytes.
      credential: {
        id: credRow.credential_id,
        publicKey: b64uDecode(credRow.public_key),
        counter: credRow.counter,
      },
    });
  } catch (err) {
    return new Response(`Verification failed: ${err.message}`, { status: 400 });
  }

  if (!verification.verified) return new Response("Passkey verification failed.", { status: 400 });

  await supabase
    .from("webauthn_credentials")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", credRow.id);
  await supabase.from("webauthn_challenges").delete().eq("id", challengeRow.id);

  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !linkData) return new Response("Could not start session.", { status: 500 });

  return new Response(
    JSON.stringify({ email, token: linkData.properties.hashed_token }),
    { headers: { "Content-Type": "application/json" } }
  );
});
