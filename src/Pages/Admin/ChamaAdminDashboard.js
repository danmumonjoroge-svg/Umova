import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

/**
 * Financial admin's oversight hub into Chama ERP — mirrors the existing
 * POSAdminDashboard pattern: a findable landing page inside the Financial
 * admin's own AdminLayout/StaffGuard, giving oversight and a launch point
 * into a separately-authenticated sub-ERP, without merging that sub-ERP's
 * auth into StaffGuard itself.
 *
 * Chama's own app (/chama) and its platform-admin license manager
 * (/platform-admin) are intentionally left as their own separately-authed
 * areas, exactly as designed in chama-erp-advanced/README.md — this page
 * only surfaces oversight and links out, it doesn't re-implement or gate
 * Chama's own auth.
 */
export default function ChamaAdminDashboard() {
  const [chamas, setChamas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadChamas();
  }, []);

  const loadChamas = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("chamas")
      .select("id, name, chama_no, phone, license_status, license_expiry, license_plan, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load chamas", error);
      setLoading(false);
      return;
    }
    setChamas(data || []);
    setLoading(false);
  };

  const today = new Date().toISOString().slice(0, 10);

  const effectiveStatus = (c) => {
    if (c.license_plan === "free") return "free";
    if (c.license_status === "suspended") return "suspended";
    if (c.license_expiry && c.license_expiry < today) return "overdue";
    return "active";
  };

  const counts = chamas.reduce(
    (acc, c) => {
      const s = effectiveStatus(c);
      acc[s] = (acc[s] || 0) + 1;
      acc.total++;
      return acc;
    },
    { total: 0 }
  );

  const daysRemaining = (c) => {
    if (!c.license_expiry) return null;
    const diff = Math.ceil((new Date(c.license_expiry) - new Date(today)) / (1000 * 60 * 60 * 24));
    return diff;
  };

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h2>Chama ERP</h2>
      <p style={{ color: "#666" }}>
        Chama runs as its own app with its own phone+password login — separate
        from staff/member accounts here. This page is oversight and a launch
        point into it, not a re-implementation of its auth.
      </p>

      <div style={{ display: "flex", gap: 12, margin: "16px 0" }}>
        <a href="/chama" target="_blank" rel="noreferrer">
          <button>Open Chama App →</button>
        </a>
        <a href="/platform-admin" target="_blank" rel="noreferrer">
          <button>Open Chama License Manager →</button>
        </a>
      </div>

      <div style={{ display: "flex", gap: 16, margin: "16px 0", flexWrap: "wrap" }}>
        <SummaryCard label="Total Chamas" value={counts.total} />
        <SummaryCard label="Active" value={counts.active || 0} color="#0a7" />
        <SummaryCard label="Overdue" value={counts.overdue || 0} color="#d33" />
        <SummaryCard label="Suspended" value={counts.suspended || 0} color="#d33" />
        <SummaryCard label="Free Plan" value={counts.free || 0} color="#888" />
      </div>

      <h4>Chamas</h4>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th>Name</th><th>Chama No.</th><th>Phone</th><th>Plan</th><th>Status</th><th>Days Remaining</th>
            </tr>
          </thead>
          <tbody>
            {chamas.map((c) => {
              const status = effectiveStatus(c);
              const days = daysRemaining(c);
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td>{c.name}</td>
                  <td>{c.chama_no}</td>
                  <td>{c.phone}</td>
                  <td>{c.license_plan}</td>
                  <td>{status}</td>
                  <td>{status === "free" ? "—" : days !== null ? days : "—"}</td>
                </tr>
              );
            })}
            {chamas.length === 0 && <tr><td colSpan={6}>No chamas registered yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: "12px 20px", minWidth: 120 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || "#333" }}>{value}</div>
      <div style={{ fontSize: 13, color: "#666" }}>{label}</div>
    </div>
  );
}
