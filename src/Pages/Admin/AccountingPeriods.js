import { useEffect, useState } from "react";
import { useAuth } from "../../Context/AuthContext";
import {
  listPeriods,
  createPeriod,
  closePeriod,
  reopenPeriod,
} from "../../services/accountingPeriodsAPI";

// Only admin/superadmin/manager can actually close/reopen — enforced by RLS
// on the accounting_periods table. This page still gates the buttons in the
// UI for a clean experience, but the real enforcement is server-side.
const CAN_MANAGE_PERIODS = ["admin", "superadmin", "manager"];

export default function AccountingPeriods() {
  const { role, user } = useAuth();
  const canManage = CAN_MANAGE_PERIODS.includes(role);

  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ period_name: "", start_date: "", end_date: "" });
  const [reopenReasonById, setReopenReasonById] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      setPeriods(await listPeriods());
    } catch (err) {
      alert(`Failed to load periods: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.period_name || !form.start_date || !form.end_date) {
      alert("Period name, start date, and end date are all required.");
      return;
    }
    if (form.end_date < form.start_date) {
      alert("End date must be on or after start date.");
      return;
    }
    try {
      await createPeriod(form);
      setForm({ period_name: "", start_date: "", end_date: "" });
      await load();
    } catch (err) {
      alert(`Failed to create period: ${err.message || err}`);
    }
  };

  const handleClose = async (period) => {
    if (!window.confirm(`Close "${period.period_name}"? No new entries can post into it once closed.`)) return;
    try {
      await closePeriod(period.id, user?.id);
      await load();
    } catch (err) {
      alert(`Failed to close period: ${err.message || err}`);
    }
  };

  const handleReopen = async (period) => {
    const reason = reopenReasonById[period.id];
    try {
      await reopenPeriod(period.id, user?.id, reason);
      setReopenReasonById((prev) => ({ ...prev, [period.id]: "" }));
      await load();
    } catch (err) {
      alert(`Failed to reopen period: ${err.message || err}`);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h2>Accounting Periods</h2>
      <p style={{ color: "#666" }}>
        A date with no period defined below is treated as open. Once a period is closed,
        {" "}<code>postJournal</code> refuses new entries dated inside it.
      </p>

      {canManage && (
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, alignItems: "end", margin: "16px 0" }}>
          <div>
            <label>Period name<br />
              <input
                value={form.period_name}
                onChange={(e) => setForm((f) => ({ ...f, period_name: e.target.value }))}
                placeholder="January 2026"
              />
            </label>
          </div>
          <div>
            <label>Start date<br />
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </label>
          </div>
          <div>
            <label>End date<br />
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </label>
          </div>
          <button type="submit">Create period</button>
        </form>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th>Period</th>
              <th>Start</th>
              <th>End</th>
              <th>Status</th>
              {canManage && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #eee" }}>
                <td>{p.period_name}</td>
                <td>{p.start_date}</td>
                <td>{p.end_date}</td>
                <td>{p.status === "open" ? "🟢 Open" : "🔴 Closed"}</td>
                {canManage && (
                  <td>
                    {p.status === "open" ? (
                      <button onClick={() => handleClose(p)}>Close</button>
                    ) : (
                      <div style={{ display: "flex", gap: 4 }}>
                        <input
                          placeholder="Reason for reopening"
                          value={reopenReasonById[p.id] || ""}
                          onChange={(e) =>
                            setReopenReasonById((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                        />
                        <button onClick={() => handleReopen(p)}>Reopen</button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {periods.length === 0 && (
              <tr><td colSpan={5}>No periods defined yet — all dates are treated as open.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
