export function formatKES(v) {
  return `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function formatDate(v, opts) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, opts || { day: "numeric", month: "short", year: "numeric" });
}

export function initials(name) {
  return (name || "?").split(" ").filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
}

export function firstName(name) {
  return (name || "").trim().split(" ")[0] || "there";
}

// First day of the current month as YYYY-MM-DD (local time, not UTC, so a
// contribution made on the 1st at 00:30 EAT isn't counted in last month).
export function monthStartISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Friendly labels so members never see raw role slugs.
export const ROLE_LABEL = {
  member: "Member", secretary: "Secretary", treasurer: "Treasurer",
  chairperson: "Chairperson", chairman: "Chairperson", admin: "Admin", welfare_officer: "Welfare officer",
};
export const roleLabel = (r) => ROLE_LABEL[(r || "").toLowerCase()] || r || "Member";
