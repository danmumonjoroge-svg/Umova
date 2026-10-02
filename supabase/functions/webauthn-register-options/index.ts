// webauthn-register-options — start adding a fingerprint/passkey to an account the person has ALREADY signed in to.
//
//   kind "supabase" (SACCO app, My Business/POS): requires the user's Supabase access token.
//   kind "chama": Chama has no Supabase session, so the person re-enters phone + password here.
//                 Enrolling a biometric is as sensitive as changing the password; it must not
//                 work off a browser that merely stayed logged in.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { generateRegistrationOptions } from "https://esm.sh/@simplewebauthn/server@14";
import { handler, storeChallenge, authenticateChamaUser, MAX_PASSKEYS_PER_USER } from "../_shared/webauthn.ts";

serve(handler(async ({ req, rp, db, json, fail }) => {
  const body = await req.json().catch(() => ({}));
  const kind = body?.kind === "chama" ? "chama" : "supabase";
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 64) : "";

  let userId: string; let userName: string; let displayName: string; let email: string | null = null;

  if (kind === "supabase") {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return fail("Missing auth token", 401);
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) return fail("Invalid session", 401);
    userId = user.id; email = user.email ?? null;
    // `label` lets apps with synthetic emails (My Business logins) show a human name in the OS passkey picker.
    userName = label || user.email || user.id;
    displayName = label || user.email || user.id;
  } else {
    const who = await authenticateChamaUser(db, body?.phone, body?.password);
    if (!who) return fail("Incorrect phone number or password", 401);
    userId = who.user_id; userName = who.phone_number; displayName = who.full_name || who.phone_number;
  }

  const { data: existing } = await db.from("webauthn_credentials")
    .select("credential_id, transports").eq("kind", kind).eq("user_id", userId);
  if ((existing?.length ?? 0) >= MAX_PASSKEYS_PER_USER) {
    return fail(`You already have ${MAX_PASSKEYS_PER_USER} devices set up. Remove one first.`, 409);
  }

  const options = await generateRegistrationOptions({
    rpName: "Umova",
    rpID: rp.rpId,
    userID: new TextEncoder().encode(userId),
    userName,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",        // discoverable: sign-in with nothing typed
      requireResidentKey: true,
      userVerification: "required",   // the fingerprint/face check IS the credential
      authenticatorAttachment: "platform",
    },
    excludeCredentials: (existing ?? []).map((c) => ({ id: c.credential_id, transports: c.transports ?? undefined })),
  });

  await storeChallenge(db, { kind, user_id: userId, email, challenge: options.challenge, type: "registration", rp_id: rp.rpId });
  return json(options);
}));
