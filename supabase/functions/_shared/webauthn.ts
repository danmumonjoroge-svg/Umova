// supabase/functions/_shared/webauthn.ts
// Shared by every webauthn-* function. One deployment serves all three Umova apps
// (SACCO member app, My Business/POS, Chama).
//
// CONFIG (Edge Function secrets):
//   WEBAUTHN_ORIGINS  comma list of EXACT origins allowed to use passkeys, e.g.
//                     https://sacco.umova.app,https://business.umova.app,https://chama.umova.app,http://localhost:3000
//   WEBAUTHN_RP_IDS   comma list of relying-party IDs (registrable domain, no scheme/port), e.g.
//                     umova.app,localhost
//   (the older single WEBAUTHN_ORIGIN / WEBAUTHN_RP_ID still work as a one-item list)
//
// The RP ID for a request is derived from its Origin header (the longest allowed RP ID that equals the host
// or is a parent domain of it). A passkey is bound to its RP ID forever, so if the apps share a parent domain
// you pick that parent ONCE and never change it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as b64uEncode, decode as b64uDecode } from "https://deno.land/std@0.203.0/encoding/base64url.ts";

export { b64uEncode, b64uDecode };

export const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const csv = (v?: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export type Rp = { origin: string; rpId: string };

/** Returns the origin + RP ID for this request, or null if the origin isn't on the allow-list. */
export function resolveRp(req: Request): Rp | null {
  const origin = req.headers.get("origin");
  const origins = csv(Deno.env.get("WEBAUTHN_ORIGINS") ?? Deno.env.get("WEBAUTHN_ORIGIN"));
  const rpIds = csv(Deno.env.get("WEBAUTHN_RP_IDS") ?? Deno.env.get("WEBAUTHN_RP_ID"))
    .sort((a, b) => b.length - a.length);
  if (!origin || !origins.includes(origin)) return null;
  let host: string;
  try { host = new URL(origin).hostname; } catch { return null; }
  const rpId = rpIds.find((id) => host === id || host.endsWith("." + id));
  return rpId ? { origin, rpId } : null;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = csv(Deno.env.get("WEBAUTHN_ORIGINS") ?? Deno.env.get("WEBAUTHN_ORIGIN")).includes(origin);
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

/** Wraps a handler: CORS preflight, POST-only, JSON helpers, and an allow-listed origin. */
export function handler(
  fn: (ctx: {
    req: Request; rp: Rp; db: ReturnType<typeof admin>;
    json: (b: unknown, s?: number) => Response; fail: (m: string, s?: number) => Response;
  }) => Promise<Response>,
) {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const json = (b: unknown, s = 200) =>
      new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
    const fail = (m: string, s = 400) =>
      new Response(m, { status: s, headers: { ...cors, "Content-Type": "text/plain" } });
    if (req.method !== "POST") return fail("Method not allowed", 405);
    const rp = resolveRp(req);
    if (!rp) return fail("This site is not allowed to use fingerprint sign-in.", 403);
    try {
      return await fn({ req, rp, db: admin(), json, fail });
    } catch (e) {
      console.error("[webauthn]", e);
      return fail("Something went wrong. Please try again.", 500);
    }
  };
}

/** Challenges are single-use: reading one deletes it, win or lose, so it can never be replayed or brute-forced. */
export async function consumeChallenge(db: ReturnType<typeof admin>, challenge: string, type: "registration" | "authentication") {
  const { data } = await db.from("webauthn_challenges").delete()
    .eq("challenge", challenge).eq("type", type).gt("expires_at", new Date().toISOString())
    .select().maybeSingle();
  return data as null | { kind: string; user_id: string | null; rp_id: string | null; email: string | null };
}

export async function storeChallenge(
  db: ReturnType<typeof admin>,
  row: { kind: "supabase" | "chama"; user_id: string | null; email?: string | null; challenge: string; type: string; rp_id: string },
) {
  await db.from("webauthn_challenges").delete().lt("expires_at", new Date().toISOString()); // housekeeping
  const { error } = await db.from("webauthn_challenges").insert(row);
  if (error) throw error;
}

/** The challenge string the browser signed, read from clientDataJSON. */
export function challengeFromClientData(clientDataJSON: string): string | null {
  try { return JSON.parse(new TextDecoder().decode(b64uDecode(clientDataJSON))).challenge ?? null; } catch { return null; }
}

/** Chama has its own account table (chama_users) and no Supabase session, so enrolment re-checks phone + password. */
export async function authenticateChamaUser(db: ReturnType<typeof admin>, phone: string, password: string) {
  if (!phone || !password) return null;
  const { data, error } = await db.rpc("authenticate_user", { p_phone: String(phone).trim(), p_password: password });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null; // { user_id, full_name, phone_number }
}

export const MAX_PASSKEYS_PER_USER = 10;
