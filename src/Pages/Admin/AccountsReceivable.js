import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";

/**
 * Section 13 — general Accounts Receivable, deliberately separate from
 * loan receivables (1101-1103). Mirrors AccountsPayable.js's structure:
 * Customer -> Invoice (posts Accounts Receivable DR / Income CR,
 * recognizing revenue immediately) -> Receipt (posts Cash/Bank DR /
 * Accounts Receivable CR, allocated to a specific invoice).
 *
 * Same deliberate scope-cut as Accounts Payable: no approve-vs-receive
 * role gating yet — RLS is permissive for any authenticated user.
 */
export default function AccountsReceivable() {
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [incomeAccounts, setIncomeAccounts] = useState([]);
  const [accountIds, setAccountIds] = useState(null);

  const [newCustomer, setNewCustomer] = useState({ name: "", contact_person: "", phone: "", email: "" });

  const [invoiceForm, setInvoiceForm] = useState({
    customer_id: "", invoice_number: "", invoice_date: "", due_date: "",
    income_account_id: "", amount: "", description: "",
  });

  const [receiptForm, setReceiptForm] = useState({
    invoice_id: "", amount: "", receipt_date: "", receipt_method: "Bank", reference: "",
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCustomers();
    loadInvoices();
    loadIncomeAccounts();
    loadSystemAccounts();
  }, []);

  const loadCustomers = async () => {
    const { data } = await supabase.from("customers").select("*").order("name");
    setCustomers(data || []);
  };

  const loadInvoices = async () => {
    const { data } = await supabase
      .from("customer_invoices")
      .select("*, customers(name)")
      .order("invoice_date", { ascending: false });
    setInvoices(data || []);
  };

  const loadIncomeAccounts = async () => {
    const { data } = await supabase
      .from("chart_of_accounts")
      .select("id, name")
      .eq("type", "income")
      .eq("is_active", true)
      .eq("allow_posting", true)
      .order("name");
    setIncomeAccounts(data || []);
  };

  const loadSystemAccounts = async () => {
    try {
      const [ACCOUNTS_RECEIVABLE, CASH, BANK] = await Promise.all([
        getSystemAccount("ACCOUNTS_RECEIVABLE"),
        getSystemAccount("CASH"),
        getSystemAccount("BANK"),
      ]);
      setAccountIds({ ACCOUNTS_RECEIVABLE, CASH, BANK });
    } catch (err) {
      alert(`Failed to load Chart of Accounts mapping: ${err.message || err}`);
    }
  };

  // ================= CUSTOMERS =================
  const addCustomer = async () => {
    if (!newCustomer.name) return alert("Customer name is required");
    const { error } = await supabase.from("customers").insert([newCustomer]);
    if (error) return alert(`Failed to add customer: ${error.message}`);
    setNewCustomer({ name: "", contact_person: "", phone: "", email: "" });
    loadCustomers();
  };

  // ================= INVOICE =================
  const submitInvoice = async () => {
    const f = invoiceForm;
    if (!f.customer_id || !f.invoice_number || !f.invoice_date || !f.income_account_id || !f.amount) {
      return alert("Customer, invoice number, date, income category, and amount are all required.");
    }
    if (!accountIds) return alert("Chart of Accounts mapping hasn't loaded yet.");

    setLoading(true);
    try {
      const amount = Number(f.amount);
      const journalRef = `AR-INV-${Date.now()}`;

      // Recognize revenue immediately (accrual basis), not at receipt time.
      // Accounts Receivable DR, Income CR.
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
        customer_id: f.customer_id,
        invoice_number: f.invoice_number,
        invoice_date: f.invoice_date,
        due_date: f.due_date || null,
        income_account_id: Number(f.income_account_id),
        amount,
        total_amount: amount,
        description: f.description,
        status: "approved",
        journal_reference: journalRef,
      }]);
      if (error) throw error;

      alert("✅ Invoice recorded and posted");
      setInvoiceForm({ customer_id: "", invoice_number: "", invoice_date: "", due_date: "", income_account_id: "", amount: "", description: "" });
      loadInvoices();
    } catch (err) {
      alert(`Failed to record invoice: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  // ================= RECEIPT =================
  const submitReceipt = async () => {
    const f = receiptForm;
    if (!f.invoice_id || !f.amount || !f.receipt_date || !f.reference) {
      return alert("Invoice, amount, date, and reference are all required.");
    }
    if (!accountIds) return alert("Chart of Accounts mapping hasn't loaded yet.");

    const invoice = invoices.find((i) => i.id === f.invoice_id);
    if (!invoice) return alert("Invoice not found");

    const outstanding = Number(invoice.total_amount) - Number(invoice.amount_received || 0);
    const amount = Number(f.amount);
    if (amount > outstanding + 0.005) {
      return alert(`Receipt (${amount}) exceeds outstanding balance (${outstanding}) on this invoice.`);
    }

    setLoading(true);
    try {
      const journalRef = `AR-RCT-${Date.now()}`;
      const cashOrBank = f.receipt_method === "Cash" ? accountIds.CASH : accountIds.BANK;

      // Settle the receivable. Cash/Bank DR, Accounts Receivable CR.
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

      const newAmountReceived = Number(invoice.amount_received || 0) + amount;
      const newStatus = newAmountReceived >= Number(invoice.total_amount) - 0.005 ? "paid" : "partially_paid";

      const { error: invErr } = await supabase
        .from("customer_invoices")
        .update({ amount_received: newAmountReceived, status: newStatus })
        .eq("id", invoice.id);
      if (invErr) throw invErr;

      const { error: rcptErr } = await supabase.from("customer_receipts").insert([{
        customer_id: invoice.customer_id,
        invoice_id: invoice.id,
        amount,
        receipt_date: f.receipt_date,
        receipt_method: f.receipt_method,
        reference: f.reference,
        journal_reference: journalRef,
      }]);
      if (rcptErr) throw rcptErr;

      alert("✅ Receipt posted");
      setReceiptForm({ invoice_id: "", amount: "", receipt_date: "", receipt_method: "Bank", reference: "" });
      loadInvoices();
    } catch (err) {
      alert(`Failed to post receipt: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const outstandingInvoices = invoices.filter((i) => i.status === "approved" || i.status === "partially_paid");

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h2>Accounts Receivable</h2>
      <p style={{ color: "#666" }}>
        For general debtors (e.g. hall rental, services rendered to non-members) —
        not loan repayments, which stay in Loan Repayments.
      </p>

      <h4>Customers</h4>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input placeholder="Name" value={newCustomer.name} onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))} />
        <input placeholder="Contact person" value={newCustomer.contact_person} onChange={(e) => setNewCustomer((c) => ({ ...c, contact_person: e.target.value }))} />
        <input placeholder="Phone" value={newCustomer.phone} onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))} />
        <input placeholder="Email" value={newCustomer.email} onChange={(e) => setNewCustomer((c) => ({ ...c, email: e.target.value }))} />
        <button onClick={addCustomer}>Add Customer</button>
      </div>
      <p style={{ color: "#666" }}>{customers.length} customer(s) on file.</p>

      <h4>Record Customer Invoice</h4>
      <div style={{ display: "grid", gap: 8, maxWidth: 420, marginBottom: 32 }}>
        <select value={invoiceForm.customer_id} onChange={(e) => setInvoiceForm((f) => ({ ...f, customer_id: e.target.value }))}>
          <option value="">-- Select customer --</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input placeholder="Invoice number" value={invoiceForm.invoice_number} onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_number: e.target.value }))} />
        <label>Invoice date<input type="date" value={invoiceForm.invoice_date} onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_date: e.target.value }))} /></label>
        <label>Due date<input type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm((f) => ({ ...f, due_date: e.target.value }))} /></label>
        <select value={invoiceForm.income_account_id} onChange={(e) => setInvoiceForm((f) => ({ ...f, income_account_id: e.target.value }))}>
          <option value="">-- Income category --</option>
          {incomeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input type="number" placeholder="Amount" value={invoiceForm.amount} onChange={(e) => setInvoiceForm((f) => ({ ...f, amount: e.target.value }))} />
        <input placeholder="Description" value={invoiceForm.description} onChange={(e) => setInvoiceForm((f) => ({ ...f, description: e.target.value }))} />
        <button onClick={submitInvoice} disabled={loading}>Record & Post Invoice</button>
      </div>

      <h4>Receive Payment for an Invoice</h4>
      <div style={{ display: "grid", gap: 8, maxWidth: 420, marginBottom: 32 }}>
        <select value={receiptForm.invoice_id} onChange={(e) => setReceiptForm((f) => ({ ...f, invoice_id: e.target.value }))}>
          <option value="">-- Select outstanding invoice --</option>
          {outstandingInvoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.invoice_number} — {i.customers?.name} — outstanding {Number(i.total_amount) - Number(i.amount_received || 0)}
            </option>
          ))}
        </select>
        <input type="number" placeholder="Amount" value={receiptForm.amount} onChange={(e) => setReceiptForm((f) => ({ ...f, amount: e.target.value }))} />
        <label>Receipt date<input type="date" value={receiptForm.receipt_date} onChange={(e) => setReceiptForm((f) => ({ ...f, receipt_date: e.target.value }))} /></label>
        <select value={receiptForm.receipt_method} onChange={(e) => setReceiptForm((f) => ({ ...f, receipt_method: e.target.value }))}>
          <option value="Bank">Bank</option>
          <option value="Cash">Cash</option>
        </select>
        <input placeholder="Reference / voucher code" value={receiptForm.reference} onChange={(e) => setReceiptForm((f) => ({ ...f, reference: e.target.value }))} />
        <button onClick={submitReceipt} disabled={loading}>Post Receipt</button>
      </div>

      <h4>Invoices</h4>
      <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th>Invoice #</th><th>Customer</th><th>Date</th><th>Total</th><th>Received</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{i.invoice_number}</td>
              <td>{i.customers?.name}</td>
              <td>{i.invoice_date}</td>
              <td>{i.total_amount}</td>
              <td>{i.amount_received || 0}</td>
              <td>{i.status}</td>
            </tr>
          ))}
          {invoices.length === 0 && <tr><td colSpan={6}>No invoices recorded yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
