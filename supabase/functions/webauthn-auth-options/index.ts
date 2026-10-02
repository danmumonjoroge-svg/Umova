// webauthn-auth-options — public (no session yet). Two modes:
//   usernameless (default): no identifier; the browser offers every passkey it holds for this site.
//   identifier-first (legacy SACCO member numbers): only for passkeys made before discoverable credentials were required.
// Vague on failure ({ available:false }) so it can't be used to discover which accounts exist.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { generateAuthenticationOptions } from "https://esm.sh/@simplewebauthn/server@14";
import { handler, storeChallenge } from "../_shared/webauthn.ts";

serve(handler(async ({ req, rp, db, json }) => {
  const body = await req.json().catch(() => ({}));
  const identifier: string | undefined = body?.identifier;

  if (!identifier) {
    const options = await generateAuthenticationOptions({ rpID: rp.rpId, userVerification: "required", allowCredentials: [] });
    await storeChallenge(db, { kind: "supabase", user_id: null, challenge: options.challenge, type: "authentication", rp_id: rp.rpId });
    return json({ available: true, options });
  }

  const code = identifier.trim().toUpperCase();
  let authUserId: string | null = null;
  const { data: staffRow } = await db.from("users").select("auth_user_id").eq("member_no", code).maybeSingle();
  if (staffRow?.auth_user_id) authUserId = staffRow.auth_user_id;
  else {
    const { data: memberRow } = await db.from("members").select("auth_user_id").eq("member_no", code).maybeSingle();
    if (memberRow?.auth_user_id) authUserId = memberRow.auth_user_id;
  }
  if (!authUserId) return json({ available: false });

  const { data: creds } = await db.from("webauthn_credentials")
    .select("credential_id, transports").eq("kind", "supabase").eq("user_id", authUserId);
  if (!creds?.length) return json({ available: false });

  const options = await generateAuthenticationOptions({
    rpID: rp.rpId, userVerification: "required",
    allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports ?? undefined })),
  });
  await storeChallenge(db, { kind: "supabase", user_id: authUserId, challenge: options.challenge, type: "authentication", rp_id: rp.rpId });
  return json({ available: true, options });
}));
