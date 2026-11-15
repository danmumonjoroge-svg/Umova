import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { Landmark, PlusCircle, Lock, Loader2, Power } from "lucide-react";
import { formatKES } from "../shell/format";
import { Panel, SubCard, SubCardList, StatGrid, Stat } from "../shell/ui";
import "./ChamaBankAccounts.css";

// -----------------------------------------------------------------------------
// ChamaBankAccounts
// Officials configure the chama's real accounts here (e.g. "CIC Chama
// Account", "Equity - Main", "Till 123456"). These are what members pick
// from in MemberContributionForm and what the treasurer pays out of in
// LoanDisbursementDesk — one shared source of truth, per chama (multi-tenant
// safe: every row is scoped by chama_id).
// -----------------------------------------------------------------------------

const emptyForm = { account_name: "", account_type: "bank", account_number: "", provider: "", opening_balance: "" };

export default function ChamaBankAccounts({ chamaId: chamaIdProp }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const canManage = hasRole(["treasurer", "chairperson", "admin"]);

  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});
  const [unassigned, setUnassigned] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!chamaId) return;
    setLoading(true);
    const { data } = await supabase.from("chama_bank_accounts").select("*").eq("chama_id", chamaId).order("created_at", { ascending: true });
    setAccounts(data || []);
    // Each account's own balance: opening balance + money in - money out, worked out by the database.
    if (member?.id) {
      const { data: bal } = await supabase.rpc("chama_account_balances", { p_chama_id: chamaId, p_requester: member.id });
      if (bal) {
        setBalances(Object.fromEntries((bal.accounts || []).map((b) => [b.id, b])));
        setUnassigned(bal.unassigned && bal.unassigned.count > 0 ? bal.unassigned : null);
        // the cash account is created by the database on first use, so reload the list if it is new
        if ((bal.accounts || []).some((b) => !(data || []).some((a) => a.id === b.id))) {
          const again = await supabase.from("chama_bank_accounts").select("*").eq("chama_id", chamaId).order("created_at", { ascending: true });
          setAccounts(again.data || []);
        }
      }
    }
    setLoading(false);
  }, [chamaId, member?.id]);

  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    if (!form.account_name.trim()) return;
    setSaving(true);
    await supabase.from("chama_bank_accounts").insert([{
      chama_id: chamaId,
      account_name: form.account_name,
      account_type: form.account_type,
      account_number: form.account_number || null,
      provider: form.provider || null,
      opening_balance: Number(form.opening_balance) || 0,
      is_active: true,
    }]);
    setSaving(false);
    setForm(emptyForm);
    setFormOpen(false);
    load();
  };

  const toggleActive = async (acc) => {
    await supabase.from("chama_bank_accounts").update({ is_active: !acc.is_active }).eq("id", acc.id);
    load();
  };

  if (!canManage) {
    return (
      <div className="cba-locked"><Lock size={18} /><p>Only the treasurer and chairperson can manage chama accounts.</p></div>
    );
  }

  return (
    <div className="cba-page">
      <div className="cba-header">
        <div>
          <span className="cba-icon"><Landmark size={16} /></span>
          <div>
            <h2>Chama Accounts</h2>
            <p>The real bank / M-Pesa / SACCO accounts members pay into.</p>
          </div>
        </div>
        <button className="cba-add-btn" onClick={() => setFormOpen((v) => !v)}><PlusCircle size={15} /> Add account</button>
      </div>

      {formOpen && (
        <form className="cba-form" onSubmit={save}>
          <div className="cba-form-grid">
            <label>
              Account name
              <input value={form.account_name} onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))} placeholder="e.g. CIC Chama Account" required />
            </label>
            <label>
              Type
              <select value={form.account_type} onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value }))}>
                <option value="bank">Bank</option>
                <option value="mpesa">M-Pesa</option>
                <option value="sacco">SACCO</option>
                <option value="cash_till">Cash till</option>
              </select>
            </label>
            <label>
              Provider
              <input value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} placeholder="e.g. CIC, Equity, Safaricom" />
            </label>
            <label>
              Account / till number
              <input value={form.account_number} onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))} />
            </label>
            <label>
              Opening balance
              <input type="number" min="0" value={form.opening_balance} onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))} />
            </label>
          </div>
          <div className="cba-form-actions">
            <button type="button" className="cba-cancel" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" className="cba-submit" disabled={saving}>{saving ? <Loader2 size={14} className="spin" /> : "Save account"}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="cba-loading"><Loader2 size={18} className="spin" /></div>
      ) : accounts.length === 0 ? (
        <p className="cba-empty">No accounts configured yet.</p>
      ) : (
        <>
          {unassigned && (
            <p className="cba-unassigned">
              Older entries not tied to an account: in {formatKES(unassigned.paid_in)}, out {formatKES(unassigned.paid_out)} ({unassigned.count} entries). They are not in any balance above.
            </p>
          )}
          <Panel icon={Landmark} title="Accounts" badge={accounts.length} tone="green" collapsible={false}>
            <SubCardList>
              {accounts.map((a) => (
                <SubCard key={a.id} tone={a.is_active ? "gold" : ""} title={a.account_name}
                  sub={`${a.provider || ""}${a.account_number ? ` · ${a.account_number}` : ""} · ${a.account_type === "cash" ? "cash in hand" : a.account_type}`}
                  value={balances[a.id] ? formatKES(balances[a.id].balance) : undefined}>
                  {balances[a.id] && (
                    <StatGrid cols={3}>
                      <Stat label="Paid in" value={formatKES(balances[a.id].paid_in)} />
                      <Stat label="Paid out" value={formatKES(balances[a.id].paid_out)} />
                      <Stat label="Opened with" value={formatKES(balances[a.id].opening || 0)} />
                    </StatGrid>
                  )}
                  {a.account_type !== "cash" && (
                    <span className="cm-sub-actions">
                      <button className="cba-toggle" onClick={() => toggleActive(a)}>
                        <Power size={13} /> {a.is_active ? "Active" : "Disabled"}
                      </button>
                    </span>
                  )}
                </SubCard>
              ))}
            </SubCardList>
          </Panel>
        </>
      )}
    </div>
  );
}
