// webauthn-auth-verify — checks the fingerprint assertion and returns what the calling app needs to sign in.
//
//   Supabase accounts (SACCO app, My Business/POS): returns { kind:"supabase", email, token_hash }. The app then calls
//     supabase.auth.verifyOtp({ token_hash, type:"magiclink" }). generateLink does NOT email anyone; the hash is only
//     returned after the biometric check passed, and is single-use.
//     FIX: the old version returned the hash but the client passed it as `token` (which expects the 6-digit code),
//     so passkey login could never have completed. `token_hash` is the correct parameter for a hashed token.
//   Chama accounts (no Supabase session): returns { kind:"chama", user:{ user_id, full_name, phone_number } } — exactly the
//     shape authenticate_user() returns, so ChamaContext carries on with get_user_memberships() as it does after a password.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { verifyAuthenticationResponse } from "https://esm.sh/@simplewebauthn/server@14";
import { handler, consumeChallenge, challengeFromClientData, b64uDecode } from "../_shared/webauthn.ts";

serve(handler(async ({ req, rp, db, json, fail }) => {
  const { identifier, assertionResponse } = await req.json().catch(() => ({}));
  if (!assertionResponse?.id || !assertionResponse?.response?.clientDataJSON) return fail("Missing fields", 400);

  // The challenge is consumed FIRST (single use) so a failed attempt can't be retried against the same challenge.
  const expectedChallenge = challengeFromClientData(assertionResponse.response.clientDataJSON);
  if (!expectedChallenge) return fail("Malformed assertion.", 400);
  const ch = await consumeChallenge(db, expectedChallenge, "authentication");
  if (!ch) return fail("Challenge expired — please try again.", 400);
  if (ch.rp_id && ch.rp_id !== rp.rpId) return fail("Wrong site for this request.", 400);

  // 1. Whose passkey is this? Resolved from the credential, never from anything typed.
  const { data: cred } = await db.from("webauthn_credentials").select("*").eq("credential_id", assertionResponse.id).maybeSingle();
  if (!cred) return fail("Unknown passkey.", 400);
  if (cred.rp_id && cred.rp_id !== rp.rpId) return fail("This passkey belongs to a different site.", 400);
  if (ch.user_id && ch.user_id !== cred.user_id) return fail("Challenge does not match this passkey.", 400);

  const userHandle = assertionResponse.response?.userHandle;
  if (userHandle && new TextDecoder().decode(b64uDecode(userHandle)) !== cred.user_id) {
    return fail("Passkey does not match its account.", 400);
  }

  // 2. Is the account allowed in? (checked before the signature so a blocked account learns nothing)
  let email: string | null = null;
  let chamaUser: { user_id: string; full_name: string; phone_number: string } | null = null;

  if (cred.kind === "chama") {
    const { data: cu } = await db.from("chama_users").select("id, full_name, phone_number, is_active").eq("id", cred.user_id).maybeSingle();
    if (!cu || cu.is_active === false) return fail("Account is not active.", 403);
    chamaUser = { user_id: cu.id, full_name: cu.full_name, phone_number: cu.phone_number };
  } else {
    const { data: au, error: auErr } = await db.auth.admin.getUserById(cred.user_id);
    if (auErr || !au?.user) return fail("Not found", 404);
    if (au.user.banned_until && new Date(au.user.banned_until) > new Date()) return fail("Account is not active.", 403);
    email = au.user.email ?? null;
    if (!email) return fail("This account has no sign-in email.", 404);

    // SACCO app extras (kept from the old function): staff/member rows can be inactive/suspended.
    let memberNo: string | null = null;
    for (const table of ["users", "members"]) {
      const { data: row } = await db.from(table).select("member_no, status").eq("auth_user_id", cred.user_id).maybeSingle();
      if (row) {
        if (row.status === "inactive" || row.status === "suspended") return fail("Account is not active.", 403);
        memberNo = row.member_no; break;
      }
    }
    if (identifier && identifier.trim().toUpperCase() !== (memberNo ?? "").toUpperCase()) {
      return fail("Passkey does not match that account.", 400);
    }
    // My Business/POS: pos_staff / tenant status is enforced by get_pos_profile() right after sign-in, same as a password login.
  }

  // 3. Verify the signature.
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
      credential: { id: cred.credential_id, publicKey: b64uDecode(cred.public_key), counter: Number(cred.counter ?? 0), transports: cred.transports ?? undefined },
    });
  } catch (e) {
    return fail(`Verification failed: ${(e as Error).message}`, 400);
  }
  if (!v.verified) return fail("Passkey verification failed.", 400);

  await db.from("webauthn_credentials").update({
    counter: v.authenticationInfo.newCounter,
    last_used_at: new Date().toISOString(),
    rp_id: cred.rp_id ?? rp.rpId, // legacy rows made before rp_id existed get bound on first use
  }).eq("id", cred.id);

  if (chamaUser) return json({ kind: "chama", user: chamaUser });

  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email: email! });
  if (linkErr || !link?.properties?.hashed_token) return fail("Could not start your session.", 500);
  return json({ kind: "supabase", email, token_hash: link.properties.hashed_token });
}));
