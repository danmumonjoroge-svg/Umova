import React, { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { useChama } from "./ChamaContext";
import {
  Search, Users, Phone, IdCard, Wallet, CheckCircle, XCircle, Clock,
  ShieldAlert, X, Loader2, UserCheck, UserX, Pencil, UserPlus, AlertCircle,
} from "lucide-react";
import "./MembersDirectory.css";

// -----------------------------------------------------------------------------
// MembersDirectory
// Everyone in the chama can see the directory (name, phone, role, status —
// this is a small trusted group, not a public listing). Officials get
// extra columns (national ID, balances) plus the ability to edit a
// member's role, approve a pending member, or suspend/reactivate one.
//
// Built directly off chama_members' real schema, including the approval
// workflow fields (approved_by/approved_at/suspended_at) that already
// exist on the table but weren't wired up to any screen yet.
// -----------------------------------------------------------------------------

const ROLES = ["member", "secretary", "treasurer", "chairperson", "welfare_officer", "admin"];
const STATUS_META = {
  active:    { icon: CheckCircle, tone: "active" },
  pending:   { icon: Clock, tone: "pending" },
  suspended: { icon: XCircle, tone: "suspended" },
};

function formatKES(v) {
  return `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function emptyNewMember() {
  return { name: "", phone: "", national_id: "", role: "member", status: "active" };
}

export default function MembersDirectory({ chamaId: chamaIdProp }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const isOfficial = hasRole(["secretary", "treasurer", "chairperson", "admin"]);

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [editing, setEditing] = useState(null); // member row being edited
  const [saving, setSaving] = useState(false);

  const [addingOpen, setAddingOpen] = useState(false);
  const [newMember, setNewMember] = useState(emptyNewMember());
  const [addError, setAddError] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!chamaId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("chama_members")
      .select("*")
      .eq("chama_id", chamaId)
      .order("name", { ascending: true });
    if (err) setError(err.message);
    else setMembers(data || []);
    setLoading(false);
  }, [chamaId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return members.filter((m) => {
      if (statusFilter !== "all" && (m.status || "active") !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (m.name || "").toLowerCase().includes(q) || (m.phone || "").includes(q) || (m.role || "").toLowerCase().includes(q);
    });
  }, [members, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: members.length, active: 0, pending: 0, suspended: 0 };
    members.forEach((m) => { c[m.status || "active"] = (c[m.status || "active"] || 0) + 1; });
    return c;
  }, [members]);

  const openEdit = (m) => setEditing({ ...m });

  const saveEdit = async () => {
    setSaving(true);
    const { error: err } = await supabase
      .from("chama_members")
      .update({ role: editing.role, remarks: editing.remarks || null })
      .eq("id", editing.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setEditing(null);
    load();
  };

  const approveMember = async (m) => {
    await supabase.from("chama_members").update({
      status: "active", approved_by: member?.name || member?.id || null, approved_at: new Date().toISOString(),
    }).eq("id", m.id);
    load();
  };

  const suspendMember = async (m) => {
    await supabase.from("chama_members").update({
      status: "suspended", suspended_at: new Date().toISOString(),
    }).eq("id", m.id);
    load();
  };

  const reactivateMember = async (m) => {
    await supabase.from("chama_members").update({ status: "active", suspended_at: null }).eq("id", m.id);
    load();
  };

  const addMember = async (e) => {
    e.preventDefault();
    setAddError(null);
    if (!newMember.name.trim()) return setAddError("Enter a name.");
    if (!newMember.phone.trim()) return setAddError("Enter a phone number.");
    if (members.some((m) => m.phone === newMember.phone.trim())) {
      return setAddError("A member with this phone number is already in this chama.");
    }

    setAdding(true);
    const { error: err } = await supabase.from("chama_members").insert([{
      chama_id: chamaId,
      name: newMember.name.trim(),
      phone: newMember.phone.trim(),
      national_id: newMember.national_id.trim() || null,
      role: newMember.role,
      status: newMember.status,
    }]);
    setAdding(false);
    if (err) return setAddError(err.message);

    setNewMember(emptyNewMember());
    setAddingOpen(false);
    load();
  };

  return (
    <div className="mdr-page">
      <div className="mdr-header">
        <div>
          <span className="mdr-icon"><Users size={18} /></span>
          <div>
            <h2>Members</h2>
            <p>{members.length} member{members.length === 1 ? "" : "s"} in {chama?.name || "this chama"}</p>
          </div>
        </div>
        {isOfficial && (
          <button className="mdr-add-btn" onClick={() => setAddingOpen((v) => !v)}>
            <UserPlus size={15} /> Add member
          </button>
        )}
      </div>

      {addingOpen && (
        <form className="mdr-add-form" onSubmit={addMember}>
          {addError && <div className="mdr-error"><AlertCircle size={14} /> {addError}</div>}
          <div className="mdr-add-grid">
            <label>
              Full name
              <input value={newMember.name} onChange={(e) => setNewMember((f) => ({ ...f, name: e.target.value }))} required />
            </label>
            <label>
              Phone number
              <input type="tel" value={newMember.phone} onChange={(e) => setNewMember((f) => ({ ...f, phone: e.target.value }))} placeholder="07XX XXX XXX" required />
              <small>They'll use this exact number to register their own login later.</small>
            </label>
            <label>
              National ID (optional)
              <input value={newMember.national_id} onChange={(e) => setNewMember((f) => ({ ...f, national_id: e.target.value }))} />
            </label>
            <label>
              Role
              <select value={newMember.role} onChange={(e) => setNewMember((f) => ({ ...f, role: e.target.value }))}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>
              Starting status
              <select value={newMember.status} onChange={(e) => setNewMember((f) => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="pending">Pending approval</option>
              </select>
            </label>
          </div>
          <div className="mdr-add-actions">
            <button type="button" className="mdr-cancel" onClick={() => { setAddingOpen(false); setAddError(null); }}>Cancel</button>
            <button type="submit" className="mdr-save" disabled={adding}>{adding ? <Loader2 size={14} className="spin" /> : "Add member"}</button>
          </div>
        </form>
      )}

      <div className="mdr-toolbar">
        <div className="mdr-search">
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, or role" />
        </div>
        <div className="mdr-filters">
          {["all", "active", "pending", "suspended"].map((s) => (
            <button key={s} className={`mdr-filter-chip ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>
              {s === "all" ? "All" : s} {counts[s] ? `(${counts[s]})` : ""}
            </button>
          ))}
        </div>
      </div>


      {error && <div className="mdr-error"><ShieldAlert size={14} /> {error}</div>}

      {loading ? (
        <div className="mdr-loading"><Loader2 size={20} className="spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="mdr-empty"><Users size={22} /><p>No members match.</p></div>
      ) : (
        <div className="mdr-grid">
          {filtered.map((m) => {
            const meta = STATUS_META[m.status || "active"] || STATUS_META.active;
            const Icon = meta.icon;
            return (
              <div className={`mdr-card ${meta.tone}`} key={m.id}>
                <div className="mdr-card-top">
                  <div className="mdr-avatar">{(m.name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}</div>
                  <div className="mdr-card-titles">
                    <h3>{m.name || "Unnamed member"}</h3>
                    <span className="mdr-role-badge">{m.role}</span>
                  </div>
                  <span className={`mdr-status-badge ${meta.tone}`}><Icon size={12} /> {m.status || "active"}</span>
                </div>

                <div className="mdr-detail-row"><Phone size={13} /> {m.phone}</div>
                {isOfficial && m.national_id && (
                  <div className="mdr-detail-row"><IdCard size={13} /> {m.national_id}</div>
                )}
                <div className="mdr-detail-row-muted">Joined {formatDate(m.joined_at)}</div>

                {isOfficial && (
                  <div className="mdr-balances">
                    <div><span>Savings</span><strong>{formatKES(m.savings_balance)}</strong></div>
                    <div><span>Shares</span><strong>{formatKES(m.shares_balance)}</strong></div>
                    <div><span>Welfare</span><strong>{formatKES(m.welfare_balance)}</strong></div>
                  </div>
                )}

                {isOfficial && (
                  <div className="mdr-actions">
                    <button className="mdr-edit-btn" onClick={() => openEdit(m)}><Pencil size={12} /> Edit role</button>
                    {m.status === "pending" && (
                      <button className="mdr-approve-btn" onClick={() => approveMember(m)}><UserCheck size={12} /> Approve</button>
                    )}
                    {m.status !== "suspended" ? (
                      <button className="mdr-suspend-btn" onClick={() => suspendMember(m)}><UserX size={12} /> Suspend</button>
                    ) : (
                      <button className="mdr-approve-btn" onClick={() => reactivateMember(m)}><UserCheck size={12} /> Reactivate</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="mdr-modal-overlay" onClick={() => setEditing(null)}>
          <div className="mdr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mdr-modal-head">
              <h3>{editing.name}</h3>
              <button onClick={() => setEditing(null)}><X size={18} /></button>
            </div>
            <label>
              Role
              <select value={editing.role} onChange={(e) => setEditing((f) => ({ ...f, role: e.target.value }))}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>
              Remarks (optional)
              <textarea value={editing.remarks || ""} onChange={(e) => setEditing((f) => ({ ...f, remarks: e.target.value }))} />
            </label>
            <div className="mdr-modal-actions">
              <button className="mdr-cancel" onClick={() => setEditing(null)}>Cancel</button>
              <button className="mdr-save" onClick={saveEdit} disabled={saving}>{saving ? <Loader2 size={14} className="spin" /> : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
