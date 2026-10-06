import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";
import { Page, SectionCard, Field, Tabs, StatusBadge, EmptyState, KpiCard, kes, todayISO } from "./AdminUI";

/**
 * Section 13 — general Accounts Receivable, separate from loan receivables. Flow: Customer -> Invoice (posts Accounts Receivable DR / Income CR,
 * recognised immediately) -> Receipt (posts Cash/Bank DR / Accounts Receivable CR,
 * allocated to a specific invoice). No approve-vs-receipt role gating
 * (RLS is permissive for any authenticated user). Posting logic unchanged;
 * this file only changes the presentation and error reporting.
 */
const EMPTY_PARTY = { name: "", contact_person: "", phone: "", email: "" };
const emptyInvoice = () => ({ customer_id: "", invoice_number: "", invoice_date: todayISO(), due_date: "", income_account_id: "", amount: "", description: "" });
const emptySettle = () => ({ invoice_id: "", amount: "", receipt_date: todayISO(), receipt_method: "Bank", reference: "" });

const statusTone = (s) => (s === "paid" ? "success" : s === "partially_paid" ? "warning" : "neutral");
const statusLabel = (s) => (s === "partially_paid" ? "Part paid" : s);

export default function AccountsReceivable() {
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
    const { data } = await supabase.from("customers").select("*").order("name");
    setParties(data || []);
  };
  const loadInvoices = async () => {
    const { data } = await supabase.from("customer_invoices").select("*, customers(name)").order("invoice_date", { ascending: false });
    setInvoices(data || []);
  };
  const loadAccounts = async () => {
    const { data } = await supabase.from("chart_of_accounts").select("id, name")
      .eq("type", "income").eq("is_active", true).eq("allow_posting", true).order("name");
    setAccounts(data || []);
  };
  const loadSystemAccounts = async () => {
    try {
      const [ACCOUNTS_RECEIVABLE, CASH, BANK] = await Promise.all([getSystemAccount("ACCOUNTS_RECEIVABLE"), getSystemAccount("CASH"), getSystemAccount("BANK")]);
      setAccountIds({ ACCOUNTS_RECEIVABLE, CASH, BANK });
    } catch (err) {
      setResult({ ok: false, text: `Chart of Accounts mapping failed to load: ${err.message || err}` });
    }
  };

  const setInv = (k) => (e) => setInvoiceForm((f) => ({ ...f, [k]: e.target.value }));
  const setSet = (k) => (e) => setSettleForm((f) => ({ ...f, [k]: e.target.value }));

  // ================= PARTIES =================
  const addParty = async () => {
    if (!newParty.name.trim()) return setResult({ ok: false, text: "Customer name is required." });
    const { error } = await supabase.from("customers").insert([newParty]);
    if (error) return setResult({ ok: false, text: `Customer not added: ${error.message}` });
    setResult({ ok: true, text: `${newParty.name} added.` });
    setNewParty(EMPTY_PARTY);
    loadParties();
  };

  // ================= INVOICE =================
  const submitInvoice = async () => {
    const f = invoiceForm;
    if (!f.customer_id || !f.invoice_number || !f.invoice_date || !f.income_account_id || !f.amount) {
      return setResult({ ok: false, text: "Customer, invoice number, date, income category and amount are all required." });
    }
    if (!accountIds) return setResult({ ok: false, text: "Chart of Accounts mapping hasn't loaded yet." });

    setLoading(true); setResult(null);
    let journalRef = null;
    try {
      const amount = Number(f.amount);
      journalRef = `AR-INV-${Date.now()}`;
      await postJournal({
        reference: journalRef,
        date: f.invoice_date,
        description: `Customer invoice ${f.invoice_number} (${f.description || "no description"})`,
        source_module: "accounts_receivable",
        lines: [
          { account_id: accountIds.ACCOUNTS_RECEIVABLE, debit: amount, credit: 0 },
          { account_id: Number(f.income_account_id), debit: 0, credit: amount },
        ],
      });
      const { error } = await supabase.from("customer_invoices").insert([{
        customer_id: f.customer_id, invoice_number: f.invoice_number, invoice_date: f.invoice_date,
        due_date: f.due_date || null, income_account_id: Number(f.income_account_id),
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

  // ================= RECEIPT =================
  const submitSettle = async () => {
    const f = settleForm;
    if (!f.invoice_id || !f.amount || !f.receipt_date || !f.reference) {
      return setResult({ ok: false, text: "Invoice, amount, date and reference are all required." });
    }
    if (!accountIds) return setResult({ ok: false, text: "Chart of Accounts mapping hasn't loaded yet." });
    const invoice = invoices.find((i) => i.id === f.invoice_id);
    if (!invoice) return setResult({ ok: false, text: "Invoice not found." });

    const outstanding = Number(invoice.total_amount) - Number(invoice.amount_received || 0);
    const amount = Number(f.amount);
    if (amount > outstanding + 0.005) {
      return setResult({ ok: false, text: `Receipt (${kes(amount)}) exceeds the outstanding balance (${kes(outstanding)}) on this invoice.` });
    }

    setLoading(true); setResult(null);
    let journalRef = null;
    try {
      journalRef = `AR-RCT-${Date.now()}`;
      const cashOrBank = f.receipt_method === "Cash" ? accountIds.CASH : accountIds.BANK;
      await postJournal({
        reference: journalRef,
        date: f.receipt_date,
        description: `Receipt for invoice ${invoice.invoice_number}`,
        source_module: "accounts_receivable",
        lines: [
          { account_id: cashOrBank, debit: amount, credit: 0 },
          { account_id: accountIds.ACCOUNTS_RECEIVABLE, debit: 0, credit: amount },
        ],
      });

      const newDone = Number(invoice.amount_received || 0) + amount;
      const newStatus = newDone >= Number(invoice.total_amount) - 0.005 ? "paid" : "partially_paid";
      const { error: invErr } = await supabase.from("customer_invoices").update({ amount_received: newDone, status: newStatus }).eq("id", invoice.id);
      if (invErr) throw Object.assign(invErr, { afterPost: true });
      const { error: recErr } = await supabase.from("customer_receipts").insert([{
        customer_id: invoice.customer_id, invoice_id: invoice.id, amount,
        receipt_date: f.receipt_date, receipt_method: f.receipt_method, reference: f.reference, journal_reference: journalRef,
      }]);
      if (recErr) throw Object.assign(recErr, { afterPost: true });

      setResult({ ok: true, text: `Receipt posted · ${invoice.invoice_number} · KES ${kes(amount)} (${journalRef})` });
      setSettleForm(emptySettle());
      loadInvoices();
    } catch (err) {
      setResult({ ok: false, text: err.afterPost
        ? `Journal ${journalRef} WAS posted, but updating the invoice record failed: ${err.message}. Do not post again.`
        : `Receipt not posted: ${err.message || err}` });
    } finally { setLoading(false); }
  };

  const outstandingInvoices = useMemo(() => invoices.filter((i) => i.status === "approved" || i.status === "partially_paid"), [invoices]);
  const totalOutstanding = outstandingInvoices.reduce((s, i) => s + Number(i.total_amount) - Number(i.amount_received || 0), 0);
  const picked = invoices.find((i) => i.id === settleForm.invoice_id);
  const pickedOutstanding = picked ? Number(picked.total_amount) - Number(picked.amount_received || 0) : null;

  return (
    <Page intro="For general debtors (hall rental, services to non-members). Loan repayments stay in Loan Repayments." result={result} onCloseResult={() => setResult(null)}>
      <div className="ua-stat-row">
        <KpiCard label="Outstanding" value={kes(totalOutstanding)} />
        <KpiCard label="Open invoices" value={outstandingInvoices.length} />
        <KpiCard label="Customers" value={parties.length} />
        <KpiCard label="Invoices" value={invoices.length} />
      </div>

      <Tabs value={tab} onChange={setTab} items={[
        { key: "invoice", label: "New invoice" },
        { key: "settle", label: "Receive payment" },
        { key: "invoices", label: "Invoices", count: invoices.length },
        { key: "parties", label: "Customers", count: parties.length },
      ]} />

      {tab === "invoice" && (
        <SectionCard title="Record customer invoice">
          <div className="ua-form cols-2">
            <Field label="Customer" span2 htmlFor="inv-party">
              <select id="inv-party" value={invoiceForm.customer_id} onChange={setInv("customer_id")}>
                <option value="">Select customer</option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Invoice number" htmlFor="inv-no"><input id="inv-no" value={invoiceForm.invoice_number} onChange={setInv("invoice_number")} autoComplete="off" /></Field>
            <Field label="Income category" htmlFor="inv-acct">
              <select id="inv-acct" value={invoiceForm.income_account_id} onChange={setInv("income_account_id")}>
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
        <SectionCard title="Receive payment for an invoice">
          <div className="ua-form cols-2">
            <Field label="Outstanding invoice" span2 htmlFor="st-inv"
              hint={picked ? `Outstanding on this invoice: KES ${kes(pickedOutstanding)}` : undefined}>
              <select id="st-inv" value={settleForm.invoice_id} onChange={setSet("invoice_id")}>
                <option value="">Select invoice</option>
                {outstandingInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoice_number} · {i.customers?.name} · {kes(Number(i.total_amount) - Number(i.amount_received || 0))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" htmlFor="st-amt">
              <div className="ua-amount"><span>KES</span>
                <input id="st-amt" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={settleForm.amount} onChange={setSet("amount")} />
              </div>
            </Field>
            <Field label="Date" htmlFor="st-date"><input id="st-date" type="date" value={settleForm.receipt_date} onChange={setSet("receipt_date")} /></Field>
            <Field label="Method" span2>
              <Tabs className="choice" value={settleForm.receipt_method} onChange={(v) => setSettleForm((f) => ({ ...f, receipt_method: v }))}
                items={[{ key: "Bank", label: "Bank" }, { key: "Cash", label: "Cash" }]} />
            </Field>
            <Field label="Reference / voucher code" span2 htmlFor="st-ref"><input id="st-ref" value={settleForm.reference} onChange={setSet("reference")} autoComplete="off" /></Field>
          </div>
          <button type="button" className="ua-btn ua-btn-primary ua-submit" onClick={submitSettle} disabled={loading || !accountIds}>
            {loading ? "Posting…" : "Post receipt"}
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
                <thead><tr><th>Invoice #</th><th>Customer</th><th>Date</th><th className="num">Total</th><th className="num">Received</th><th>Status</th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td data-label="Invoice #"><strong>{i.invoice_number}</strong></td>
                      <td data-label="Customer" className="wrap">{i.customers?.name}</td>
                      <td data-label="Date">{i.invoice_date}</td>
                      <td data-label="Total" className="num">{kes(i.total_amount)}</td>
                      <td data-label="Received" className="num">{kes(i.amount_received)}</td>
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
          <SectionCard title="Add customer">
            <div className="ua-form cols-2">
              <Field label="Name" span2 htmlFor="pt-name"><input id="pt-name" value={newParty.name} onChange={(e) => setNewParty((p) => ({ ...p, name: e.target.value }))} /></Field>
              <Field label="Contact person" htmlFor="pt-cp"><input id="pt-cp" value={newParty.contact_person} onChange={(e) => setNewParty((p) => ({ ...p, contact_person: e.target.value }))} /></Field>
              <Field label="Phone" htmlFor="pt-ph"><input id="pt-ph" type="tel" inputMode="tel" value={newParty.phone} onChange={(e) => setNewParty((p) => ({ ...p, phone: e.target.value }))} /></Field>
              <Field label="Email" span2 htmlFor="pt-em"><input id="pt-em" type="email" inputMode="email" value={newParty.email} onChange={(e) => setNewParty((p) => ({ ...p, email: e.target.value }))} /></Field>
            </div>
            <button type="button" className="ua-btn ua-btn-primary ua-submit" onClick={addParty}>Add customer</button>
          </SectionCard>
          <SectionCard title="On file" subtitle={`${parties.length} customer(s)`}>
            {parties.length === 0 ? <EmptyState title="None yet" message="Added customers will appear here." /> : (
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
