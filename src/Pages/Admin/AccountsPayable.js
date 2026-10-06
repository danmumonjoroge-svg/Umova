import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";
import { Page, SectionCard, Field, Tabs, StatusBadge, EmptyState, KpiCard, kes, todayISO } from "./AdminUI";

/**
 * Section 12 — Accounts Payable (Financial side; the POS purchase files are a different module). Flow: Supplier -> Invoice (posts Expense DR / Accounts Payable CR,
 * recognised immediately) -> Payment (posts Accounts Payable DR / Cash/Bank CR,
 * allocated to a specific invoice). No approve-vs-payment role gating
 * (RLS is permissive for any authenticated user). Posting logic unchanged;
 * this file only changes the presentation and error reporting.
 */
const EMPTY_PARTY = { name: "", contact_person: "", phone: "", email: "" };
const emptyInvoice = () => ({ supplier_id: "", invoice_number: "", invoice_date: todayISO(), due_date: "", expense_account_id: "", amount: "", description: "" });
const emptySettle = () => ({ invoice_id: "", amount: "", payment_date: todayISO(), payment_method: "Bank", reference: "" });

const statusTone = (s) => (s === "paid" ? "success" : s === "partially_paid" ? "warning" : "neutral");
const statusLabel = (s) => (s === "partially_paid" ? "Part paid" : s);

export default function AccountsPayable() {
  const [tab, setTab] = useState("invoice");
  const [parties, setParties] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [accountIds, setAccountIds] = useState(null);
  const [newParty, setNewParty] = useState(EMPTY_PARTY);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoice());
  const [settleForm, setSettleForm] = useState(emptySettle());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => { loadParties(); loadInvoices(); loadAccounts(); loadSystemAccounts(); }, []);

  const loadParties = async () => {
    const { data } = await supabase.from("suppliers").select("*").order("name");
    setParties(data || []);
  };
  const loadInvoices = async () => {
    const { data } = await supabase.from("supplier_invoices").select("*, suppliers(name)").order("invoice_date", { ascending: false });
    setInvoices(data || []);
  };
  const loadAccounts = async () => {
    const { data } = await supabase.from("chart_of_accounts").select("id, name")
      .eq("type", "expense").eq("is_active", true).eq("allow_posting", true).order("name");
    setAccounts(data || []);
  };
  const loadSystemAccounts = async () => {
    try {
      const [ACCOUNTS_PAYABLE, CASH, BANK] = await Promise.all([getSystemAccount("ACCOUNTS_PAYABLE"), getSystemAccount("CASH"), getSystemAccount("BANK")]);
      setAccountIds({ ACCOUNTS_PAYABLE, CASH, BANK });
    } catch (err) {
      setResult({ ok: false, text: `Chart of Accounts mapping failed to load: ${err.message || err}` });
    }
  };

  const setInv = (k) => (e) => setInvoiceForm((f) => ({ ...f, [k]: e.target.value }));
  const setSet = (k) => (e) => setSettleForm((f) => ({ ...f, [k]: e.target.value }));

  // ================= PARTIES =================
  const addParty = async () => {
    if (!newParty.name.trim()) return setResult({ ok: false, text: "Supplier name is required." });
    const { error } = await supabase.from("suppliers").insert([newParty]);
    if (error) return setResult({ ok: false, text: `Supplier not added: ${error.message}` });
    setResult({ ok: true, text: `${newParty.name} added.` });
    setNewParty(EMPTY_PARTY);
    loadParties();
  };

  // ================= INVOICE =================
  const submitInvoice = async () => {
    const f = invoiceForm;
    if (!f.supplier_id || !f.invoice_number || !f.invoice_date || !f.expense_account_id || !f.amount) {
      return setResult({ ok: false, text: "Supplier, invoice number, date, expense category and amount are all required." });
    }
    if (!accountIds) return setResult({ ok: false, text: "Chart of Accounts mapping hasn't loaded yet." });

    setLoading(true); setResult(null);
    let journalRef = null;
    try {
      const amount = Number(f.amount);
      journalRef = `AP-INV-${Date.now()}`;
      await postJournal({
        reference: journalRef,
        date: f.invoice_date,
        description: `Supplier invoice ${f.invoice_number} (${f.description || "no description"})`,
        source_module: "accounts_payable",
        lines: [
          { account_id: Number(f.expense_account_id), debit: amount, credit: 0 },
          { account_id: accountIds.ACCOUNTS_PAYABLE, debit: 0, credit: amount },
        ],
      });
      const { error } = await supabase.from("supplier_invoices").insert([{
        supplier_id: f.supplier_id, invoice_number: f.invoice_number, invoice_date: f.invoice_date,
        due_date: f.due_date || null, expense_account_id: Number(f.expense_account_id),
        amount, total_amount: amount, description: f.description, status: "approved", journal_reference: journalRef,
      }]);
      if (error) throw Object.assign(error, { afterPost: true });

      setResult({ ok: true, text: `Invoice ${f.invoice_number} recorded and posted (${journalRef})` });
      setInvoiceForm(emptyInvoice());
      loadInvoices();
    } catch (err) {
      setResult({ ok: false, text: err.afterPost
        ? `Journal ${journalRef} WAS posted, but the invoice record failed to save: ${err.message}. Do not post again.`
        : `Invoice not recorded: ${err.message || err}` });
    } finally { setLoading(false); }
  };

  // ================= PAYMENT =================
  const submitSettle = async () => {
    const f = settleForm;
    if (!f.invoice_id || !f.amount || !f.payment_date || !f.reference) {
      return setResult({ ok: false, text: "Invoice, amount, date and reference are all required." });
    }
    if (!accountIds) return setResult({ ok: false, text: "Chart of Accounts mapping hasn't loaded yet." });
    const invoice = invoices.find((i) => i.id === f.invoice_id);
    if (!invoice) return setResult({ ok: false, text: "Invoice not found." });

    const outstanding = Number(invoice.total_amount) - Number(invoice.amount_paid || 0);
    const amount = Number(f.amount);
    if (amount > outstanding + 0.005) {
      return setResult({ ok: false, text: `Payment (${kes(amount)}) exceeds the outstanding balance (${kes(outstanding)}) on this invoice.` });
    }

    setLoading(true); setResult(null);
    let journalRef = null;
    try {
      journalRef = `AP-PMT-${Date.now()}`;
      const cashOrBank = f.payment_method === "Cash" ? accountIds.CASH : accountIds.BANK;
      await postJournal({
        reference: journalRef,
        date: f.payment_date,
        description: `Payment for invoice ${invoice.invoice_number}`,
        source_module: "accounts_payable",
        lines: [
          { account_id: accountIds.ACCOUNTS_PAYABLE, debit: amount, credit: 0 },
          { account_id: cashOrBank, debit: 0, credit: amount },
        ],
      });

      const newDone = Number(invoice.amount_paid || 0) + amount;
      const newStatus = newDone >= Number(invoice.total_amount) - 0.005 ? "paid" : "partially_paid";
      const { error: invErr } = await supabase.from("supplier_invoices").update({ amount_paid: newDone, status: newStatus }).eq("id", invoice.id);
      if (invErr) throw Object.assign(invErr, { afterPost: true });
      const { error: recErr } = await supabase.from("supplier_payments").insert([{
        supplier_id: invoice.supplier_id, invoice_id: invoice.id, amount,
        payment_date: f.payment_date, payment_method: f.payment_method, reference: f.reference, journal_reference: journalRef,
      }]);
      if (recErr) throw Object.assign(recErr, { afterPost: true });

      setResult({ ok: true, text: `Payment posted · ${invoice.invoice_number} · KES ${kes(amount)} (${journalRef})` });
      setSettleForm(emptySettle());
      loadInvoices();
    } catch (err) {
      setResult({ ok: false, text: err.afterPost
        ? `Journal ${journalRef} WAS posted, but updating the invoice record failed: ${err.message}. Do not post again.`
        : `Payment not posted: ${err.message || err}` });
    } finally { setLoading(false); }
  };

  const outstandingInvoices = useMemo(() => invoices.filter((i) => i.status === "approved" || i.status === "partially_paid"), [invoices]);
  const totalOutstanding = outstandingInvoices.reduce((s, i) => s + Number(i.total_amount) - Number(i.amount_paid || 0), 0);
  const picked = invoices.find((i) => i.id === settleForm.invoice_id);
  const pickedOutstanding = picked ? Number(picked.total_amount) - Number(picked.amount_paid || 0) : null;

  return (
    <Page intro="Supplier invoices create the liability when recorded; payments settle it against a specific invoice." result={result} onCloseResult={() => setResult(null)}>
      <div className="ua-stat-row">
        <KpiCard label="Outstanding" value={kes(totalOutstanding)} />
        <KpiCard label="Open invoices" value={outstandingInvoices.length} />
        <KpiCard label="Suppliers" value={parties.length} />
        <KpiCard label="Invoices" value={invoices.length} />
      </div>

      <Tabs value={tab} onChange={setTab} items={[
        { key: "invoice", label: "New invoice" },
        { key: "settle", label: "Pay an invoice" },
        { key: "invoices", label: "Invoices", count: invoices.length },
        { key: "parties", label: "Suppliers", count: parties.length },
      ]} />

      {tab === "invoice" && (
        <SectionCard title="Record supplier invoice">
          <div className="ua-form cols-2">
            <Field label="Supplier" span2 htmlFor="inv-party">
              <select id="inv-party" value={invoiceForm.supplier_id} onChange={setInv("supplier_id")}>
                <option value="">Select supplier</option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Invoice number" htmlFor="inv-no"><input id="inv-no" value={invoiceForm.invoice_number} onChange={setInv("invoice_number")} autoComplete="off" /></Field>
            <Field label="Expense category" htmlFor="inv-acct">
              <select id="inv-acct" value={invoiceForm.expense_account_id} onChange={setInv("expense_account_id")}>
                <option value="">Select category</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Invoice date" htmlFor="inv-date"><input id="inv-date" type="date" value={invoiceForm.invoice_date} onChange={setInv("invoice_date")} /></Field>
            <Field label="Due date (optional)" htmlFor="inv-due"><input id="inv-due" type="date" value={invoiceForm.due_date} onChange={setInv("due_date")} /></Field>
            <Field label="Amount" htmlFor="inv-amt">
              <div className="ua-amount"><span>KES</span>
                <input id="inv-amt" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={invoiceForm.amount} onChange={setInv("amount")} />
              </div>
            </Field>
            <Field label="Description" htmlFor="inv-desc"><input id="inv-desc" value={invoiceForm.description} onChange={setInv("description")} /></Field>
          </div>
          <button type="button" className="ua-btn ua-btn-primary ua-submit" onClick={submitInvoice} disabled={loading || !accountIds}>
            {loading ? "Posting…" : "Record & post invoice"}
          </button>
        </SectionCard>
      )}

      {tab === "settle" && (
        <SectionCard title="Pay a supplier invoice">
          <div className="ua-form cols-2">
            <Field label="Outstanding invoice" span2 htmlFor="st-inv"
              hint={picked ? `Outstanding on this invoice: KES ${kes(pickedOutstanding)}` : undefined}>
              <select id="st-inv" value={settleForm.invoice_id} onChange={setSet("invoice_id")}>
                <option value="">Select invoice</option>
                {outstandingInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoice_number} · {i.suppliers?.name} · {kes(Number(i.total_amount) - Number(i.amount_paid || 0))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" htmlFor="st-amt">
              <div className="ua-amount"><span>KES</span>
                <input id="st-amt" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={settleForm.amount} onChange={setSet("amount")} />
              </div>
            </Field>
            <Field label="Date" htmlFor="st-date"><input id="st-date" type="date" value={settleForm.payment_date} onChange={setSet("payment_date")} /></Field>
            <Field label="Method" span2>
              <Tabs className="choice" value={settleForm.payment_method} onChange={(v) => setSettleForm((f) => ({ ...f, payment_method: v }))}
                items={[{ key: "Bank", label: "Bank" }, { key: "Cash", label: "Cash" }]} />
            </Field>
            <Field label="Reference / voucher code" span2 htmlFor="st-ref"><input id="st-ref" value={settleForm.reference} onChange={setSet("reference")} autoComplete="off" /></Field>
          </div>
          <button type="button" className="ua-btn ua-btn-primary ua-submit" onClick={submitSettle} disabled={loading || !accountIds}>
            {loading ? "Posting…" : "Post payment"}
          </button>
        </SectionCard>
      )}

      {tab === "invoices" && (
        <SectionCard title="Invoices">
          {invoices.length === 0 ? (
            <EmptyState title="No invoices yet" message="Recorded invoices will appear here." />
          ) : (
            <div className="ua-table-wrap">
              <table className="ua-table stack">
                <thead><tr><th>Invoice #</th><th>Supplier</th><th>Date</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td data-label="Invoice #"><strong>{i.invoice_number}</strong></td>
                      <td data-label="Supplier" className="wrap">{i.suppliers?.name}</td>
                      <td data-label="Date">{i.invoice_date}</td>
                      <td data-label="Total" className="num">{kes(i.total_amount)}</td>
                      <td data-label="Paid" className="num">{kes(i.amount_paid)}</td>
                      <td data-label="Status"><StatusBadge tone={statusTone(i.status)}>{statusLabel(i.status)}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === "parties" && (
        <>
          <SectionCard title="Add supplier">
            <div className="ua-form cols-2">
              <Field label="Name" span2 htmlFor="pt-name"><input id="pt-name" value={newParty.name} onChange={(e) => setNewParty((p) => ({ ...p, name: e.target.value }))} /></Field>
              <Field label="Contact person" htmlFor="pt-cp"><input id="pt-cp" value={newParty.contact_person} onChange={(e) => setNewParty((p) => ({ ...p, contact_person: e.target.value }))} /></Field>
              <Field label="Phone" htmlFor="pt-ph"><input id="pt-ph" type="tel" inputMode="tel" value={newParty.phone} onChange={(e) => setNewParty((p) => ({ ...p, phone: e.target.value }))} /></Field>
              <Field label="Email" span2 htmlFor="pt-em"><input id="pt-em" type="email" inputMode="email" value={newParty.email} onChange={(e) => setNewParty((p) => ({ ...p, email: e.target.value }))} /></Field>
            </div>
            <button type="button" className="ua-btn ua-btn-primary ua-submit" onClick={addParty}>Add supplier</button>
          </SectionCard>
          <SectionCard title="On file" subtitle={`${parties.length} supplier(s)`}>
            {parties.length === 0 ? <EmptyState title="None yet" message="Added suppliers will appear here." /> : (
              <div className="ua-table-wrap">
                <table className="ua-table stack">
                  <thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th></tr></thead>
                  <tbody>
                    {parties.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Name"><strong>{p.name}</strong></td>
                        <td data-label="Contact">{p.contact_person || "—"}</td>
                        <td data-label="Phone">{p.phone || "—"}</td>
                        <td data-label="Email" className="wrap">{p.email || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </Page>
  );
}
