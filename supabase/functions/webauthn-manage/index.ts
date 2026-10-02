// webauthn-manage — list / remove fingerprint devices for CHAMA accounts.
// (Supabase accounts manage theirs directly through RLS — see webauthn_passkeys.sql.)
// Needs phone + password every time: Chama has no server session to prove who is asking.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { handler, authenticateChamaUser } from "../_shared/webauthn.ts";

serve(handler(async ({ req, db, json, fail }) => {
  const { action, phone, password, credentialId } = await req.json().catch(() => ({}));
  const who = await authenticateChamaUser(db, phone, password);
  if (!who) return fail("Incorrect phone number or password", 401);

  if (action === "list") {
    const { data } = await db.from("webauthn_credentials")
      .select("id, nickname, created_at, last_used_at").eq("kind", "chama").eq("user_id", who.user_id)
      .order("created_at", { ascending: false });
    return json({ credentials: data ?? [] });
  }
  if (action === "remove" && credentialId) {
    const { error } = await db.from("webauthn_credentials").delete()
      .eq("id", credentialId).eq("kind", "chama").eq("user_id", who.user_id);
    if (error) throw error;
    return json({ ok: true });
  }
  return fail("Unknown action", 400);
}));
