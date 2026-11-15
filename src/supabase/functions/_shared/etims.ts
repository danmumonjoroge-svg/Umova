// supabase/functions/_shared/etims.ts
//
// Shared by every etims-* Edge Function. MULTI-TENANT RULES ENFORCED HERE, ONCE:
//   1. The tenant and business come from the caller's verified login (JWT claims), NEVER from the request body.
//   2. KRA credentials are loaded by that business_id only (etims_get_key). No environment-variable key, no platform key,
//      no fallback: a business without its own key gets NOT_CONFIGURED.
//   3. The KRA address is chosen by the business's own environment. Paths and payloads are NOT here: they come from the
//      KRA Technical Specifications (Phase 3b) and are deliberately not guessed.
//   4. Errors returned to the browser are short and never contain a key, header or raw KRA body.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Base addresses from the KRA OSCU Specification Document v2.0 (the paths below are appended to these).
export const KRA_BASE: Record<string, string> = {
  sandbox: "https://etims-api-sbx.kra.go.ke/etims-api",
  production: "https://etims-api.kra.go.ke/etims-api",
};

/**
 * One call to KRA, JSON in / JSON out. Per the spec the only credentials are body fields (tin, bhfId, cmcKey): no auth header.
 * Returns { httpStatus, body } or throws {code:'KRA_UNREACHABLE'} on network failure / timeout. The body is never logged.
 */
export async function kraCall(environment: string, path: string, payload: Record<string, unknown>, timeoutMs = 25000) {
  const base = KRA_BASE[environment];
  if (!base) throw { status: 400, code: "BAD_ENVIRONMENT" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctl.signal,
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    return { httpStatus: res.status, body };
  } catch (e) {
    // Did the request possibly reach KRA? A failure to connect (DNS, refused, TLS) means NOTHING was sent: safe to retry.
    // A timeout or anything else after connecting is UNKNOWN: the caller must not resend automatically.
    const text = String((e as any)?.message || e).toLowerCase();
    const neverSent = (e as any)?.name !== "AbortError" && /dns|resolve|refused|unreachable|certificate|tls|handshake|connect/.test(text) && !/reset|closed|eof|aborted|timed out|timeout/.test(text);
    throw { status: 502, code: neverSent ? "KRA_UNREACHABLE" : "KRA_TIMEOUT" };
  } finally { clearTimeout(t); }
}

// Result codes (spec section 4.18) turned into owner-safe wording. Anything else gets a generic message + the code.
export function kraMessage(resultCd: string): string {
  const m: Record<string, string> = {
    "001": "KRA found nothing for that request.",
    "901": "KRA does not recognise this device. Check the PIN, branch ID and device serial, and that KRA approved your business.",
    "902": "KRA says this device is already installed. Ask KRA support to reset it, then try again.",
    "903": "KRA says this setup is not an OSCU device.",
    "910": "KRA rejected the details sent. Check the PIN, branch ID and device serial.",
    "994": "KRA already has this record.",
    "999": "KRA reported an unknown error. Try again later.",
  };
  return m[resultCd] || `KRA could not complete this (code ${resultCd}).`;
}

const ALLOWED_ORIGINS = (Deno.env.get("ETIMS_ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
export function cors(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const ok = ALLOWED_ORIGINS.length === 0 ? false : ALLOWED_ORIGINS.includes(origin);   // unset = no cross-origin browser access
  return {
    "Access-Control-Allow-Origin": ok ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

function jwtClaims(authHeader: string): Record<string, unknown> | null {
  try {
    const t = authHeader.replace(/^Bearer\s+/i, "");
    const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p));
  } catch { return null; }
}

export interface Caller { tenantId: string; staffId: string | null; businessId: string; config: Record<string, any>; }

/** Verifies the login with Supabase, then resolves THIS caller's business. Throws {status, code} on any problem. */
export async function resolveCaller(req: Request, perm = "settings.manage"): Promise<Caller> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) throw { status: 401, code: "NO_LOGIN" };
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  });
  const { data: u, error } = await userClient.auth.getUser();
  if (error || !u?.user) throw { status: 401, code: "BAD_LOGIN" };
  const c = jwtClaims(authHeader) || {};
  const tenantId = String(c["pos_tenant_id"] || (c["app_metadata"] as any)?.pos_tenant_id || "");
  if (!tenantId) throw { status: 403, code: "NO_TENANT" };
  const staffId = (c["pos_staff_id"] as string) || null;

  // Same rule as pos_require() in the database: a staff session must hold the permission, checked by the database
  // against THIS login (never trusted from the browser). Sessions without a staff id (the owner login) pass.
  if (staffId) {
    const { data: ok, error: pe } = await userClient.rpc("pos_has_permission", { p_perm: perm });
    if (pe || ok !== true) throw { status: 403, code: "NO_PERMISSION" };
  }
  const { data: biz } = await admin.from("lb_businesses").select("id").eq("tenant_id", tenantId).maybeSingle();
  if (!biz) throw { status: 403, code: "NO_BUSINESS" };
  const { data: config } = await admin.from("lb_etims_config").select("*").eq("business_id", biz.id).maybeSingle();
  if (!config || config.tenant_id !== tenantId) throw { status: 409, code: "NOT_CONFIGURED" };
  return { tenantId, staffId, businessId: biz.id, config };
}

/** THIS business's own key. Never falls back to anything else. */
export async function loadOwnKey(businessId: string): Promise<string> {
  const { data } = await admin.rpc("etims_get_key", { p_business: businessId });
  if (!data) throw { status: 409, code: "NOT_CONFIGURED" };
  return data as string;
}

export async function auditEtims(c: Caller, action: string) {
  try {
    await admin.from("pos_audit_log").insert({ pos_tenant_id: c.tenantId, actor_type: "staff", actor_id: c.staffId, action, entity_type: "lb_etims_config", entity_id: c.config.id });
  } catch { /* an audit gap must not undo the work (same rule as the database functions) */ }
}

export function failure(req: Request, e: any) {
  const status = e?.status || 500;
  console.error("[etims]", e?.code || e?.message || "error");     // code only: never log bodies, headers or keys
  return json(req, { ok: false, code: e?.code || "SERVER_ERROR" }, status);
}
