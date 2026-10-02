// webauthn-register-verify — the second half of enrolment. This function did not exist before; without it the
// "Set up on this device" button could never finish and no account could ever hold a passkey.
//
// The account is taken from the CHALLENGE row (server-issued, single-use), never from the request body.
// For Supabase accounts the bearer token must additionally belong to that same user.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { verifyRegistrationResponse } from "https://esm.sh/@simplewebauthn/server@14";
import { handler, consumeChallenge, challengeFromClientData, b64uEncode } from "../_shared/webauthn.ts";

serve(handler(async ({ req, rp, db, json, fail }) => {
  const { attestationResponse, nickname } = await req.json().catch(() => ({}));
  if (!attestationResponse?.response?.clientDataJSON) return fail("Missing fields", 400);

  const expectedChallenge = challengeFromClientData(attestationResponse.response.clientDataJSON);
  if (!expectedChallenge) return fail("Malformed response.", 400);

  const ch = await consumeChallenge(db, expectedChallenge, "registration");
  if (!ch || !ch.user_id) return fail("This request expired — please try again.", 400);
  if (ch.rp_id && ch.rp_id !== rp.rpId) return fail("Wrong site for this request.", 400);

  if (ch.kind === "supabase") {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = token ? await db.auth.getUser(token) : { data: { user: null } };
    if (!user || user.id !== ch.user_id) return fail("Invalid session", 401);
  }

  let v;
  try {
    v = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
    });
  } catch (e) {
    return fail(`Could not verify this device: ${(e as Error).message}`, 400);
  }
  if (!v.verified || !v.registrationInfo) return fail("This device could not be verified.", 400);

  const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
  const { error } = await db.from("webauthn_credentials").insert({
    kind: ch.kind,
    user_id: ch.user_id,
    credential_id: credential.id,                       // base64url string
    public_key: b64uEncode(credential.publicKey),       // base64url — auth-verify decodes it the same way
    counter: credential.counter,
    transports: credential.transports ?? attestationResponse.response.transports ?? null,
    device_type: credentialDeviceType,
    backed_up: credentialBackedUp,
    nickname: typeof nickname === "string" ? nickname.trim().slice(0, 60) || null : null,
    rp_id: rp.rpId,
  });
  if (error) {
    if (String(error.code) === "23505") return fail("This device is already set up.", 409);
    throw error;
  }
  return json({ ok: true });
}));
