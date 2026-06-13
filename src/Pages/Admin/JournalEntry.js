import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function JournalEntry() {

  const [members, setMembers] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    reference: "",
    domain: "member",
    transaction_type: "",
    member_no: "",
    vendor: "",
    invoice_no: "",
    invoice_date: "",
    description: "",
    amount: "",
    debit: "",
    credit: "",
  });

  // ================= LOAD =================
  useEffect(() => {
    load();
    generateRef();
  }, []);

  const load = async () => {
    const { data: m } = await supabase.from("members").select("*");
    setMembers(m || []);

    setAccounts([
      { code: 1007, name: "Cashbook" },
      { code: 1011, name: "Loan Account" },
      { code: 1018, name: "Savings Account" },
      { code: 1012, name: "Shares Account" },
      { code: 1020, name: "Loan Interest Income" },
      { code: 1006, name: "Savings Interest Expense" },
      { code: 1005, name: "Income Account" }
    ]);
  };

  const generateRef = () => {
    const ref = `JV-${Date.now()}`;
    setForm((f) => ({ ...f, reference: ref }));
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // ================= SMART AUTO RULES =================
  const autoSetAccounts = (type) => {

    switch (type) {

      case "loan_repayment":
        return { debit: 1007, credit: 1011 };

      case "loan_disbursement":
        return { debit: 1011, credit: 1007 };

      case "savings_deposit":
        return { debit: 1007, credit: 1018 };

      case "loan_interest":
        return { debit: 1011, credit: 1020 };

      case "savings_interest":
        return { debit: 1006, credit: 1018 };

      default:
        return { debit: "", credit: "" };
    }
  };

  // ================= POST =================
  const postJournal = async () => {

    const payload = {
      date: form.date,
      reference: form.reference,
      domain: form.domain,
      transaction_type: form.transaction_type,
      member_no: form.member_no || null,
      vendor: form.vendor || null,
      invoice_no: form.invoice_no || null,
      invoice_date: form.invoice_date || null,
      description: form.description,
      amount: Number(form.amount),
      debit_account_id: Number(form.debit),
      credit_account_id: Number(form.credit),
      status: "pending",
      created_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from("general_ledger")
      .insert([payload]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Journal Posted Successfully");

    setForm({
      ...form,
      description: "",
      amount: "",
      debit: "",
      credit: "",
      vendor: "",
      invoice_no: "",
      invoice_date: "",
      member_no: ""
    });

    generateRef();
  };

  // ================= UI =================
  return (
    <div className="p-4 bg-white rounded shadow">

      <h2 className="font-bold mb-3">Journal Entry Engine</h2>

      {/* DATE + REF */}
      <div className="grid grid-cols-2 gap-2 mb-2">

        <input
          type="date"
          name="date"
          value={form.date}
          onChange={handleChange}
          className="border p-2"
        />

        <input
          value={form.reference}
          disabled
          className="border p-2 bg-gray-100"
        />

      </div>

      {/* 🔷 FIRST LAYER: DOMAIN */}
      <select
        name="domain"
        value={form.domain}
        onChange={handleChange}
        className="border p-2 w-full mb-2"
      >
        <option value="member">Member Transactions</option>
        <option value="cash">Cash / Bank</option>
        <option value="asset">Asset Transactions</option>
        <option value="income">Income / Expense</option>
        <option value="transfer">Internal Transfer</option>
        <option value="system">System Adjustment</option>
      </select>

      {/* SECOND LAYER */}
      <select
        name="transaction_type"
        value={form.transaction_type}
        onChange={(e) => {
          handleChange(e);

          const auto = autoSetAccounts(e.target.value);
          setForm(f => ({
            ...f,
            transaction_type: e.target.value,
            debit: auto.debit,
            credit: auto.credit
          }));
        }}
        className="border p-2 w-full mb-2"
      >
        <option value="">Select Transaction Type</option>

        <option value="loan_repayment">Loan Repayment</option>
        <option value="loan_disbursement">Loan Disbursement</option>
        <option value="savings_deposit">Savings Deposit</option>
        <option value="loan_interest">Loan Interest</option>
        <option value="savings_interest">Savings Interest</option>

      </select>

      {/* MEMBER */}
      {form.domain === "member" && (
        <select
          name="member_no"
          onChange={handleChange}
          className="border p-2 w-full mb-2"
        >
          <option>Select Member</option>
          {members.map(m => (
            <option key={m.member_no} value={m.member_no}>
              {m.member_no} - {m.name}
            </option>
          ))}
        </select>
      )}

      {/* VENDOR */}
      {form.domain === "asset" && (
        <>
          <input
            name="vendor"
            placeholder="Vendor"
            onChange={handleChange}
            className="border p-2 w-full mb-2"
          />

          <input
            name="invoice_no"
            placeholder="Invoice No"
            onChange={handleChange}
            className="border p-2 w-full mb-2"
          />

          <input
            type="date"
            name="invoice_date"
            onChange={handleChange}
            className="border p-2 w-full mb-2"
          />
        </>
      )}

      {/* DESCRIPTION */}
      <input
        name="description"
        placeholder="Description"
        onChange={handleChange}
        className="border p-2 w-full mb-2"
      />

      {/* AMOUNT */}
      <input
        name="amount"
        placeholder="Amount"
        onChange={handleChange}
        className="border p-2 w-full mb-2"
      />

      {/* ACCOUNTS */}
      <select name="debit" onChange={handleChange} className="border p-2 w-full mb-2">
        <option>Debit Account</option>
        {accounts.map(a => (
          <option key={a.code} value={a.code}>
            {a.code} - {a.name}
          </option>
        ))}
      </select>

      <select name="credit" onChange={handleChange} className="border p-2 w-full mb-2">
        <option>Credit Account</option>
        {accounts.map(a => (
          <option key={a.code} value={a.code}>
            {a.code} - {a.name}
          </option>
        ))}
      </select>

      {/* SUBMIT */}
      <button
        onClick={postJournal}
        className="bg-green-600 text-white px-4 py-2 rounded w-full"
      >
        Post Journal Entry
      </button>

    </div>
  );
}