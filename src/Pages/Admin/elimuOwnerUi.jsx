// ============================================================================
// FILE: src/Pages/Admin/elimuOwnerUi.jsx
// The look of the Elimu owner pages: the same warm paper, forest green and gold as the school side of Elimu, and the same idea that each
// kind of card has its own shape. Shared by the dashboard, schools, payments, support and team pages. Phone first.
// ============================================================================
import React from "react";
import { X } from "lucide-react";
import { STATE } from "./elimuAdminApi";

export const P = {
  bg: "#FBF8EA", paper: "#FFFDF7", soft: "#F4EFD3", border: "#E3DBB8", rule: "#EAE5D3", text: "#23382B", ink: "#10261E", muted: "#6F7461",
  primary: "#1F6B45", deep: "#1B5138", dark: "#12261F", tint: "#E4F0E8", accent: "#C9A227", accentTint: "#F6EBC4", accentDeep: "#8A6D0B",
  jade: "#0B7A5A", jadeBg: "#E2F4EC", owed: "#B5452B", owedBg: "#FBE9E2", wait: "#94650F", waitBg: "#FBF0D2", margin: "#D9776A",
};
export const SHAPE = { hero: "34px 34px 34px 10px", paper: "18px", ledger: "6px 22px 22px 6px", ticket: "22px", tab: "4px 20px 20px 20px", note: "10px", gauge: "10px 30px 30px 30px" };
export const lift = "0 1px 2px rgba(18,38,31,.05), 0 6px 18px -8px rgba(18,38,31,.14)";
export const num = (n) => Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
export const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const AV = [[P.primary, "#fff"], [P.accent, P.dark], [P.dark, "#fff"], [P.tint, P.deep], [P.accentTint, P.accentDeep]];
export function avatarFor(name) { let h = 0; for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV[h % AV.length]; }

export function Avatar({ name, size = 44 }) {
  const [bg, fg] = avatarFor(name);
  return <span aria-hidden="true" className="shrink-0 inline-flex items-center justify-center font-extrabold" style={{ width: size, height: size, background: bg, color: fg, borderRadius: "30% 30% 30% 8%", fontSize: size * 0.36 }}>{initials(name)}</span>;
}
export function StatusPill({ state }) {
  const s = STATE[state] || STATE.none;
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold whitespace-nowrap" style={{ background: s.bg, color: s.fg }}><i className="w-1.5 h-1.5 rounded-full" style={{ background: s.fg }} />{s.label}</span>;
}
export const Eyebrow = ({ children, color = P.muted }) => <div className="text-[11px] font-bold uppercase tracking-[.09em]" style={{ color }}>{children}</div>;

export function Page({ title, subtitle, actions, children, wide }) {
  return (
    <div className={`mx-auto ${wide ? "max-w-6xl" : "max-w-4xl"} pb-8`} style={{ color: P.text }}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div><h1 className="text-[22px] font-black tracking-tight" style={{ color: P.ink }}>{title}</h1>{subtitle && <p className="text-[13px] mt-0.5" style={{ color: P.muted }}>{subtitle}</p>}</div>
        {actions}
      </div>
      {children}
    </div>
  );
}
export function Card({ children, shape = "paper", className = "", style, tone = "paper" }) {
  const bg = tone === "dark" ? `linear-gradient(150deg,${P.dark},${P.deep})` : tone === "soft" ? P.soft : P.paper;
  return <div className={className} style={{ background: bg, borderRadius: SHAPE[shape], boxShadow: lift, border: tone === "dark" ? "none" : `1px solid ${P.border}`, color: tone === "dark" ? "#fff" : P.text, ...style }}>{children}</div>;
}
export const Notice = ({ kind = "bad", children }) => (
  <div role={kind === "bad" ? "alert" : "status"} className="rounded-2xl p-3.5 text-sm mb-4" style={kind === "bad" ? { background: P.owedBg, color: P.owed, border: `1px solid ${P.margin}55` } : { background: P.jadeBg, color: "#075B43", border: `1px solid ${P.jade}44` }}>{children}</div>
);
export const btn = "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-bold transition active:scale-[.98] disabled:opacity-50";
export const btnPrimary = { background: P.primary, color: "#fff" };
export const btnGhost = { background: P.paper, color: P.text, border: `1px solid ${P.border}` };
export const btnDanger = { background: P.owedBg, color: P.owed };
export const inputCls = "w-full min-h-[46px] px-3.5 rounded-xl text-sm outline-none bg-white";
export const inputStyle = { border: `1px solid ${P.border}` };
export function Chips({ items, value, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist">{items.map(([k, label, count]) => (
      <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)} className="shrink-0 min-h-[40px] px-4 rounded-full text-[13px] font-bold transition"
        style={value === k ? { background: P.dark, color: "#fff" } : { background: P.paper, color: P.text, border: `1px solid ${P.border}` }}>{label}{count != null && <span className="ml-1.5 opacity-70">{count}</span>}</button>))}
    </div>
  );
}
export function Sheet({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end" style={{ background: "rgba(18,38,31,.45)" }} onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-xl max-h-[92vh] sm:max-h-none sm:h-full overflow-y-auto" style={{ background: P.bg, borderRadius: "28px 28px 0 0" }} role="dialog" aria-label={title}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 pt-5 pb-3" style={{ background: P.bg }}>
          <div className="min-w-0"><h2 className="text-xl font-black truncate" style={{ color: P.ink }}>{title}</h2>{subtitle && <div className="text-[13px]" style={{ color: P.muted }}>{subtitle}</div>}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-full inline-flex items-center justify-center" style={{ background: P.soft }}><X size={18} /></button>
        </div>
        <div className="px-5 pb-8">{children}</div>
      </aside>
    </div>
  );
}
export const Loading = () => <div className="py-12 flex justify-center"><div className="w-8 h-8 rounded-full border-4 animate-spin" style={{ borderColor: P.border, borderTopColor: P.primary }} /></div>;
export const Empty = ({ children }) => <Card className="p-8 text-center text-sm" style={{ color: P.muted }}>{children}</Card>;
