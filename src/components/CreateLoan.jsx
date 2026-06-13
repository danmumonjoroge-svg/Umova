import { useState } from "react";
import { supabase } from "./supabaseClient";

export default function CreateLoan() {
  const [form, setForm] = useState({ member_id: "", amount: "", rate: "", months: "" });

  function calculateMonthly() {
    const r = form.rate / 100 / 12;
    const m = form.months;
    return (form.amount * r) / (1 - Math.pow(1 + r, -m));
  }

  async function handleSubmit() {
    const monthly = calculateMonthly();
    await supabase.from("loans").insert([{
      member_id: form.member_id,
      amount: Number(form.amount),
      interest_rate: Number(form.rate),
      duration_months: Number(form.months),
      monthly_payment: monthly,
      balance: form.amount,
      status: "ongoing"
    }]);
    alert("Loan created!");
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow max-w-md mx-auto">
      <h2 className="text-xl font-bold mb-4">Create Loan</h2>
      <input className="w-full p-2 border rounded mb-3" placeholder="Member ID" onChange={e => setForm({ ...form, member_id: e.target.value })} />
      <input className="w-full p-2 border rounded mb-3" placeholder="Amount" onChange={e => setForm({ ...form, amount: e.target.value })} />
      <input className="w-full p-2 border rounded mb-3" placeholder="Interest Rate (%)" onChange={e => setForm({ ...form, rate: e.target.value })} />
      <input className="w-full p-2 border rounded mb-3" placeholder="Months" onChange={e => setForm({ ...form, months: e.target.value })} />
      <button className="bg-green-600 text-white px-4 py-2 rounded w-full" onClick={handleSubmit}>Create Loan</button>
    </div>
  );
}