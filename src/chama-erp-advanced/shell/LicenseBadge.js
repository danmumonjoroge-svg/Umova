import React from "react";
import { Gift, Clock, Sparkles } from "lucide-react";

// Same rules as the original shell: silent unless free plan or <=14 days left.
export default function LicenseBadge({ chama }) {
  if (!chama) return null;
  if (chama.chama_no === "CHM-DEMO01") return <span className="cm-license free"><Sparkles size={12} /> Demo</span>;
  if (chama.license_plan === "free") return <span className="cm-license free"><Gift size={12} /> Free plan</span>;
  if (!chama.license_expiry) return null;
  const d = Math.round((new Date(chama.license_expiry).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (d > 14) return null;
  if (d < 0) return <span className="cm-license overdue"><Clock size={12} /> Overdue {Math.abs(d)}d</span>;
  return <span className="cm-license soon"><Clock size={12} /> {d === 0 ? "Due today" : `${d}d left`}</span>;
}
