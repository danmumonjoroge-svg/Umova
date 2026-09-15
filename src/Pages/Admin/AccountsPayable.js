import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";

/**
 * Section 12. Nothing existing in this codebase relates to Financial-side
 * Accounts Payable — purchaseService.js/inventoryService.js found in this
 * ZIP are POS/MSME module files (their own headers say so), not this.
 *
 * Flow: Supplier -> Invoice (posts Expense DR / Accounts Payable CR,
 * recognizing the liability immediately) -> Payment (posts Accounts
 * Payable DR / Cash or Bank CR, allocated to a specific invoice).
 *
 * Deliberately NOT built: separate approve-vs-pay role gating (Section 19
 * calls for this) — RLS here is permissive for any authenticated user.
 * That needs a real status-transition permission model, not bolted on
 * quickly alongside everything else here.
 */
export default function AccountsPayable() {
  const [suppliers, setSuppliers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [accountIds, setAccountIds] = useState(null);

  const [newSupplier, setNewSupplier] = useState({ name: "", contact_person: "", phone: "", email: "" });

  const [invoiceForm, setInvoiceForm] = useState({
    supplier_id: "", invoice_number: "", invoice_date: "", due_date: "",
    expense_account_id: "", amount: "", description: "",
  });

  const [paymentForm, setPaymentForm] = useState({
    invoice_id: "", amount: "", payment_date: "", payment_method: "Bank", reference: "",
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSuppliers();
    loadInvoices();
    loadExpenseAccounts();
    loadSystemAccounts();
  }, []);

  const loadSuppliers = async () => {
    const { data } = await supabase.from("suppliers").select("*").order("name");
    setSuppliers(data || []);
  };

  const loadInvoices = async () => {
    const { data } = await supabase
      .from("supplier_invoices")
      .select("*, suppliers(name)")
      .order("invoice_date", { ascending: false });
    setInvoices(data || []);
  };

  const loadExpenseAccounts = async () => {
    const { data } = await supabase
      .from("chart_of_accounts")
      .select("id, name")
      .eq("type", "expense")
      .eq("is_active", true)
      .eq("allow_posting", true)
      .order("name");
    setExpenseAccounts(data || []);
  };

  const loadSystemAccounts = async () => {
    try {
      const [ACCOUNTS_PAYABLE, CASH, BANK] = await Promise.all([
        getSystemAccount("ACCOUNTS_PAYABLE"),
        getSystemAccount("CASH"),
        getSystemAccount("BANK"),
      ]);
      setAccountIds({ ACCOUNTS_PAYABLE, CASH, BANK });
    } catch (err) {
      alert(`Failed to load Chart of Accounts mapping: ${err.message || err}`);
    }
  };

  // ================= SUPPLIERS =================
  const addSupplier = async () => {
    if (!newSupplier.name) return alert("Supplier name is required");
    const { error } = await supabase.from("suppliers").insert([newSupplier]);
    if (error) return alert(`Failed to add supplier: ${error.message}`);
    setNewSupplier({ name: "", contact_person: "", phone: "", email: "" });
    loadSuppliers();
  };

  // ================= INVOICE =================
  const submitInvoice = async () => {
    const f = invoiceForm;
    if (!f.supplier_id || !f.invoice_number || !f.invoice_date || !f.expense_account_id || !f.amount) {
      return alert("Supplier, invoice number, date, expense category, and amount are all required.");
    }
    if (!accountIds) return alert("Chart of Accounts mapping hasn't loaded yet.");

    setLoading(true);
    try {
      const amount = Number(f.amount);
      const journalRef = `AP-INV-${Date.now()}`;

      // Recognize the liability immediately (accrual basis) — not at
      // payment time. Expense DR, Accounts Payable CR.
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
        supplier_id: f.supplier_id,
        invoice_number: f.invoice_number,
        invoice_date: f.invoice_date,
        due_date: f.due_date || null,
        expense_account_id: Number(f.expense_account_id),
        amount,
        total_amount: amount,
        description: f.description,
        status: "approved",
        journal_reference: journalRef,
      }]);
      if (error) throw error;

      alert("✅ Invoice recorded and posted");
      setInvoiceForm({ supplier_id: "", invoice_number: "", invoice_date: "", due_date: "", expense_account_id: "", amount: "", description: "" });
      loadInvoices();
    } catch (err) {
      alert(`Failed to record invoice: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  // ================= PAYMENT =================
  const submitPayment = async () => {
    const f = paymentForm;
    if (!f.invoice_id || !f.amount || !f.payment_date || !f.reference) {
      return alert("Invoice, amount, date, and reference are all required.");
    }
    if (!accountIds) return alert("Chart of Accounts mapping hasn't loaded yet.");

    const invoice = invoices.find((i) => i.id === f.invoice_id);
    if (!invoice) return alert("Invoice not found");

    const outstanding = Number(invoice.total_amount) - Number(invoice.amount_paid || 0);
    const amount = Number(f.amount);
    if (amount > outstanding + 0.005) {
      return alert(`Payment (${amount}) exceeds outstanding balance (${outstanding}) on this invoice.`);
    }

    setLoading(true);
    try {
      const journalRef = `AP-PMT-${Date.now()}`;
      const cashOrBank = f.payment_method === "Cash" ? accountIds.CASH : accountIds.BANK;

      // Settle the liability. Accounts Payable DR, Cash/Bank CR.
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

      const newAmountPaid = Number(invoice.amount_paid || 0) + amount;
      const newStatus = newAmountPaid >= Number(invoice.total_amount) - 0.005 ? "paid" : "partially_paid";

      const { error: invErr } = await supabase
        .from("supplier_invoices")
        .update({ amount_paid: newAmountPaid, status: newStatus })
        .eq("id", invoice.id);
      if (invErr) throw invErr;

      const { error: payErr } = await supabase.from("supplier_payments").insert([{
        supplier_id: invoice.supplier_id,
        invoice_id: invoice.id,
        amount,
        payment_date: f.payment_date,
        payment_method: f.payment_method,
        reference: f.reference,
        journal_reference: journalRef,
      }]);
      if (payErr) throw payErr;

      alert("✅ Payment posted");
      setPaymentForm({ invoice_id: "", amount: "", payment_date: "", payment_method: "Bank", reference: "" });
      loadInvoices();
    } catch (err) {
      alert(`Failed to post payment: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const outstandingInvoices = invoices.filter((i) => i.status === "approved" || i.status === "partially_paid");

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h2>Accounts Payable</h2>

      <h4>Suppliers</h4>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input placeholder="Name" value={newSupplier.name} onChange={(e) => setNewSupplier((s) => ({ ...s, name: e.target.value }))} />
        <input placeholder="Contact person" value={newSupplier.contact_person} onChange={(e) => setNewSupplier((s) => ({ ...s, contact_person: e.target.value }))} />
        <input placeholder="Phone" value={newSupplier.phone} onChange={(e) => setNewSupplier((s) => ({ ...s, phone: e.target.value }))} />
        <input placeholder="Email" value={newSupplier.email} onChange={(e) => setNewSupplier((s) => ({ ...s, email: e.target.value }))} />
        <button onClick={addSupplier}>Add Supplier</button>
      </div>
      <p style={{ color: "#666" }}>{suppliers.length} supplier(s) on file.</p>

      <h4>Record Supplier Invoice</h4>
      <div style={{ display: "grid", gap: 8, maxWidth: 420, marginBottom: 32 }}>
        <select value={invoiceForm.supplier_id} onChange={(e) => setInvoiceForm((f) => ({ ...f, supplier_id: e.target.value }))}>
          <option value="">-- Select supplier --</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input placeholder="Invoice number" value={invoiceForm.invoice_number} onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_number: e.target.value }))} />
        <label>Invoice date<input type="date" value={invoiceForm.invoice_date} onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_date: e.target.value }))} /></label>
        <label>Due date<input type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm((f) => ({ ...f, due_date: e.target.value }))} /></label>
        <select value={invoiceForm.expense_account_id} onChange={(e) => setInvoiceForm((f) => ({ ...f, expense_account_id: e.target.value }))}>
          <option value="">-- Expense category --</option>
          {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input type="number" placeholder="Amount" value={invoiceForm.amount} onChange={(e) => setInvoiceForm((f) => ({ ...f, amount: e.target.value }))} />
        <input placeholder="Description" value={invoiceForm.description} onChange={(e) => setInvoiceForm((f) => ({ ...f, description: e.target.value }))} />
        <button onClick={submitInvoice} disabled={loading}>Record & Post Invoice</button>
      </div>

      <h4>Pay an Invoice</h4>
      <div style={{ display: "grid", gap: 8, maxWidth: 420, marginBottom: 32 }}>
        <select value={paymentForm.invoice_id} onChange={(e) => setPaymentForm((f) => ({ ...f, invoice_id: e.target.value }))}>
          <option value="">-- Select outstanding invoice --</option>
          {outstandingInvoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.invoice_number} — {i.suppliers?.name} — outstanding {Number(i.total_amount) - Number(i.amount_paid || 0)}
            </option>
          ))}
        </select>
        <input type="number" placeholder="Amount" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} />
        <label>Payment date<input type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))} /></label>
        <select value={paymentForm.payment_method} onChange={(e) => setPaymentForm((f) => ({ ...f, payment_method: e.target.value }))}>
          <option value="Bank">Bank</option>
          <option value="Cash">Cash</option>
        </select>
        <input placeholder="Reference / voucher code" value={paymentForm.reference} onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))} />
        <button onClick={submitPayment} disabled={loading}>Post Payment</button>
      </div>

      <h4>Invoices</h4>
      <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th>Invoice #</th><th>Supplier</th><th>Date</th><th>Total</th><th>Paid</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{i.invoice_number}</td>
              <td>{i.suppliers?.name}</td>
              <td>{i.invoice_date}</td>
              <td>{i.total_amount}</td>
              <td>{i.amount_paid || 0}</td>
              <td>{i.status}</td>
            </tr>
          ))}
          {invoices.length === 0 && <tr><td colSpan={6}>No invoices recorded yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
