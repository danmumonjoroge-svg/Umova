// ============================================================================
// FILE: src/Pages/Admin/elimuAdminApi.js
// Shared helpers for the Elimu management pages in the Finance ERP admin area. Uses the main app client (a platform-owner action,
// not a school session). Every call is a SECURITY DEFINER function that checks the caller is in elimu_platform_owners.
// ============================================================================
import { supabase } from "../../supabaseClient";

// Plain-language errors (no codes, no database words).
export function plain(err) {
  const m = String(err?.message || err || "");
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "We could not reach the server. Check your internet connection and try again.";
  if (/only for the elimu owner|permission|42501|jwt|not authenticated/i.test(m)) return "This page is only for the Elimu owner. Sign in with the owner account, or ask for it to be added to the owners list.";
  if (/PGRST202|does not exist|schema cache/i.test(m)) return "The Elimu management setup has not been finished on the database yet. Run the two Elimu licensing files (1029 and 1030) and try again.";
  if (m && !/pgrst|postgres|sql|relation|function|constraint|syntax/i.test(m) && /^[A-Z]/.test(m) && /\s/.test(m)) return m;
  return "Something went wrong. Nothing was lost. Please try again.";
}
async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) { console.warn("[elimu admin]", fn, error); throw new Error(plain(error)); }
  return data;
}
export const elimuAdmin = {
  isOwner: async () => { try { return !!(await call("elimu_is_platform_owner")); } catch { return false; } },
  overview: () => call("elimu_owner_overview"),
  schools: async () => (await call("elimu_owner_schools")) || [],
  detail: (t) => call("elimu_owner_school_detail", { p_tenant: t }),
  setLicence: (t, f) => call("elimu_owner_licence_set", { p_tenant: t, p_paid_until: f.paid_until || null, p_grace_days: f.grace_days ?? null, p_price: f.price ?? null, p_suspended: f.suspended ?? null, p_reason: f.reason || null, p_note: f.note ?? null }),
  pay: (t, p) => call("elimu_owner_payment", { p_tenant: t, p_amount: Number(p.amount), p_months: Number(p.months), p_reference: p.reference || null, p_method: p.method || null, p_note: p.note || null }),
  paymentsAll: async (from, to) => (await call("elimu_owner_payments_all", { p_from: from || null, p_to: to || null })) || [],
  inbox: async (status) => (await call("elimu_owner_inbox", { p_status: status || null })) || [],
  inboxSet: (id, status, note) => call("elimu_owner_inbox_set", { p_id: id, p_status: status, p_note: note || null }),
  owners: async () => (await call("elimu_owner_list")) || [],
  addOwner: (email, note) => call("elimu_owner_add", { p_email: email, p_note: note || null }),
  removeOwner: (id) => call("elimu_owner_remove", { p_user: id }),
  unread: async () => { try { return (await call("elimu_owner_unread")) || 0; } catch { return 0; } },
};

export const money = (n, c = "KES") => `${c} ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
export const dateText = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const STATE = {
  none: { label: "Not set up", fg: "#5C5648", bg: "#F1ECE3" },
  active: { label: "Active", fg: "#0B7A5A", bg: "#E2F4EC" },
  grace: { label: "Overdue", fg: "#94650F", bg: "#FBF0D2" },
  ended: { label: "Stopped", fg: "#B5452B", bg: "#FBE9E2" },
  suspended: { label: "Suspended", fg: "#6B2D86", bg: "#F1E6F7" },
};
export function downloadCsv(name, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = Object.keys(rows[0] || { note: "" });
  const csv = [head.map(esc).join(","), ...rows.map((r) => head.map((k) => esc(r[k])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
