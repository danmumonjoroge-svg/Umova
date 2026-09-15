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
//
// USERNAMELESS: `identifier` is now optional. When it's absent, the user
// is resolved FROM THE CREDENTIAL — webauthn_credentials.credential_id is
// globally unique, so the assertion itself tells us whose account this
// is. The identifier, when supplied, is treated as a constraint to check
// rather than the source of truth, so a valid passkey can never be
// replayed against a different account by changing the identifier field.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuthenticationResponse } from "https://esm.sh/@simplewebauthn/server@14";
import { decode as b64uDecode } from "https://deno.land/std@0.203.0/encoding/base64url.ts";

const RP_ID = Deno.env.get("WEBAUTHN_RP_ID")!;
const ORIGIN = Deno.env.get("WEBAUTHN_ORIGIN")!;

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { identifier, assertionResponse } = await req.json();
  if (!assertionResponse) return new Response("Missing fields", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── 1. Resolve the user FROM THE CREDENTIAL ─────────────────────────
  // credential_id is unique per passkey, so this identifies the account
  // without anything typed. Doing the lookup this way (rather than
  // identifier -> user -> credential) is also what makes the identifier
  // non-authoritative below.
  const { data: credRow } = await supabase
    .from("webauthn_credentials")
    .select("*")
    .eq("credential_id", assertionResponse.id)
    .maybeSingle();
  if (!credRow) return new Response("Unknown passkey.", { status: 400 });

  const authUserId = credRow.user_id;

  // The authenticator also returns the user handle it stored at
  // registration (the auth user id). For discoverable credentials this is
  // present, and it must agree with the credential's owner — otherwise
  // the credential record and the authenticator disagree about whose key
  // this is, which should never happen and shouldn't be waved through.
  const userHandle = assertionResponse.response?.userHandle;
  if (userHandle) {
    const decodedHandle = new TextDecoder().decode(b64uDecode(userHandle));
    if (decodedHandle !== authUserId) {
      return new Response("Passkey does not match its account.", { status: 400 });
    }
  }

  // ── 2. Look up the account + status ─────────────────────────────────
  let email: string | null = null;
  let memberNo: string | null = null;

  const { data: staffRow } = await supabase
    .from("users").select("member_no, email, status").eq("auth_user_id", authUserId).maybeSingle();
  if (staffRow) {
    if (staffRow.status === "inactive" || staffRow.status === "suspended") {
      return new Response("Account is not active.", { status: 403 });
    }
    email = staffRow.email;
    memberNo = staffRow.member_no;
  } else {
    const { data: memberRow } = await supabase
      .from("members").select("member_no, email, status").eq("auth_user_id", authUserId).maybeSingle();
    if (memberRow) {
      if (memberRow.status === "inactive" || memberRow.status === "suspended") {
        return new Response("Account is not active.", { status: 403 });
      }
      email = memberRow.email;
      memberNo = memberRow.member_no;
    }
  }

  if (!email) return new Response("Not found", { status: 404 });

  // If the caller DID supply an identifier (legacy flow), it must match
  // the account the credential actually belongs to. Treated as a check,
  // never as the thing that selects the account.
  if (identifier && identifier.trim().toUpperCase() !== (memberNo ?? "").toUpperCase()) {
    return new Response("Passkey does not match that account.", { status: 400 });
  }

  // ── 3. Find the challenge ───────────────────────────────────────────
  // Looked up by its own value, decoded from the assertion, because in
  // the usernameless flow the challenge was stored before the user was
  // known (user_id null) and so can't be found by user_id.
  let expectedChallenge: string;
  try {
    const clientData = JSON.parse(
      new TextDecoder().decode(b64uDecode(assertionResponse.response.clientDataJSON))
    );
    expectedChallenge = clientData.challenge;
  } catch {
    return new Response("Malformed assertion.", { status: 400 });
  }

  const { data: challengeRow } = await supabase
    .from("webauthn_challenges")
    .select("*")
    .eq("challenge", expectedChallenge)
    .eq("type", "authentication")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!challengeRow) return new Response("Challenge expired — please try again.", { status: 400 });

  // If the challenge was issued for a specific user (identifier-first
  // flow), it must be the same user the credential belongs to.
  if (challengeRow.user_id && challengeRow.user_id !== authUserId) {
    return new Response("Challenge does not match this passkey.", { status: 400 });
  }

  // ── 4. Verify ───────────────────────────────────────────────────────
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      // Usernameless sign-in rests entirely on the biometric check, so
      // require it here too — not just in the options. A client could
      // otherwise return an assertion without the UV flag set.
      requireUserVerification: true,
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

  // ── 5. Consume the challenge, issue the session ─────────────────────
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
