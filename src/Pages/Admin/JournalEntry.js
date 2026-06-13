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
    description: "",
  });

  const [lines, setLines] = useState([
    { type: "debit", account_id: "", amount: "" },
    { type: "credit", account_id: "", amount: "" }
  ]);

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
    setForm(f => ({ ...f, reference: `JV-${Date.now()}` }));
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // ================= LINE HANDLERS =================
  const updateLine = (index, field, value) => {
    const updated = [...lines];
    updated[index][field] = value;
    setLines(updated);
  };

  const addLine = (type) => {
    setLines([...lines, { type, account_id: "", amount: "" }]);
  };

  const removeLine = (index) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  // ================= TOTALS =================
  const totalDebit = lines
    .filter(l => l.type === "debit")
    .reduce((s, l) => s + Number(l.amount || 0), 0);

  const totalCredit = lines
    .filter(l => l.type === "credit")
    .reduce((s, l) => s + Number(l.amount || 0), 0);

  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  // ================= SMART TEMPLATES =================
  const applyTemplate = (type) => {

    let newLines = [];

    switch (type) {

      case "loan_repayment":
        newLines = [
          { type: "debit", account_id: 1007, amount: "" },
          { type: "credit", account_id: 1011, amount: "" }
        ];
        break;

      case "split_repayment":
        newLines = [
          { type: "debit", account_id: 1007, amount: "" },
          { type: "credit", account_id: 1011, amount: "" },
          { type: "credit", account_id: 1020, amount: "" }
        ];
        break;

      case "loan_disbursement":
        newLines = [
          { type: "debit", account_id: 1011, amount: "" },
          { type: "credit", account_id: 1007, amount: "" }
        ];
        break;

      case "savings_deposit":
        newLines = [
          { type: "debit", account_id: 1007, amount: "" },
          { type: "credit", account_id: 1018, amount: "" }
        ];
        break;

      default:
        newLines = lines;
    }

    setLines(newLines);
  };

  // ================= POST =================
  const postJournal = async () => {

    if (!isBalanced) {
      alert("Debits and Credits must be equal");
      return;
    }

    try {

      const payload = {
        date: form.date,
        reference: form.reference,
        domain: form.domain,
        transaction_type: form.transaction_type,
        member_no: form.member_no || null,
        description: form.description,
        status: "pending",
        created_at: new Date().toISOString(),

        lines: lines.map(l => ({
          account_id: Number(l.account_id),
          debit: l.type === "debit" ? Number(l.amount) : 0,
          credit: l.type === "credit" ? Number(l.amount) : 0,
        }))
      };

      const { error } = await supabase
        .from("general_ledger")
        .insert(payload.lines.map(l => ({
          ...l,
          date: payload.date,
          reference: payload.reference,
          domain: payload.domain,
          transaction_type: payload.transaction_type,
          member_no: payload.member_no,
          description: payload.description,
          status: payload.status,
          created_at: payload.created_at
        })));

      if (error) throw error;

      alert("Journal Posted Successfully");

      setLines([
        { type: "debit", account_id: "", amount: "" },
        { type: "credit", account_id: "", amount: "" }
      ]);

      generateRef();

    } catch (err) {
      alert(err.message);
    }
  };

  // ================= UI =================
  return (
    <div className="p-6 bg-white rounded shadow max-w-4xl mx-auto">

      <h2 className="text-xl font-bold mb-4">
        Advanced Multi-Line Journal Engine
      </h2>

      {/* HEADER */}
      <div className="grid grid-cols-2 gap-2 mb-3">

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

      {/* MEMBER */}
      <select
        name="member_no"
        onChange={handleChange}
        className="border p-2 w-full mb-3"
      >
        <option value="">Select Member</option>
        {members.map(m => (
          <option key={m.member_no} value={m.member_no}>
            {m.member_no} - {m.name}
          </option>
        ))}
      </select>

      {/* DESCRIPTION */}
      <input
        name="description"
        placeholder="Description"
        onChange={handleChange}
        className="border p-2 w-full mb-3"
      />

      {/* TEMPLATE BUTTONS */}
      <div className="flex gap-2 mb-3 flex-wrap">

        <button onClick={() => applyTemplate("loan_repayment")} className="bg-blue-600 text-white px-3 py-1 rounded">
          Loan Repayment
        </button>

        <button onClick={() => applyTemplate("split_repayment")} className="bg-purple-600 text-white px-3 py-1 rounded">
          Split (Loan + Interest)
        </button>

        <button onClick={() => applyTemplate("loan_disbursement")} className="bg-green-600 text-white px-3 py-1 rounded">
          Loan Disbursement
        </button>

        <button onClick={() => applyTemplate("savings_deposit")} className="bg-gray-600 text-white px-3 py-1 rounded">
          Savings Deposit
        </button>

      </div>

      {/* LINES */}
      <div className="space-y-2">

        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">

            <select
              className="col-span-3 border p-2"
              value={l.type}
              onChange={(e) => updateLine(i, "type", e.target.value)}
            >
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>

            <select
              className="col-span-5 border p-2"
              value={l.account_id}
              onChange={(e) => updateLine(i, "account_id", e.target.value)}
            >
              <option>Select Account</option>
              {accounts.map(a => (
                <option key={a.code} value={a.code}>
                  {a.code} - {a.name}
                </option>
              ))}
            </select>

            <input
              type="number"
              className="col-span-3 border p-2"
              placeholder="Amount"
              value={l.amount}
              onChange={(e) => updateLine(i, "amount", e.target.value)}
            />

            <button
              className="col-span-1 bg-red-500 text-white"
              onClick={() => removeLine(i)}
            >
              X
            </button>

          </div>
        ))}

      </div>

      {/* ADD LINES */}
      <div className="flex gap-2 mt-3">

        <button onClick={() => addLine("debit")} className="bg-blue-500 text-white px-3 py-1 rounded">
          + Debit Line
        </button>

        <button onClick={() => addLine("credit")} className="bg-green-500 text-white px-3 py-1 rounded">
          + Credit Line
        </button>

      </div>

      {/* BALANCE CHECK */}
      <div className="mt-4 p-3 border rounded bg-gray-50 text-sm">

        <p>Total Debit: <b>{totalDebit}</b></p>
        <p>Total Credit: <b>{totalCredit}</b></p>

        <p className={isBalanced ? "text-green-600" : "text-red-600 font-bold"}>
          {isBalanced ? "Balanced ✓" : "Not Balanced ⚠"}
        </p>

      </div>

      {/* POST */}
      <button
        onClick={postJournal}
        className="bg-green-700 text-white w-full mt-4 py-2 rounded"
      >
        Post Journal Entry
      </button>

    </div>
  );
}