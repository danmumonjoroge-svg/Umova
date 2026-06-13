// pages/AmortizationSchedule.jsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "./supabaseClient";
import jsPDF from "jspdf";
import "jspdf-autotable";

export default function AmortizationSchedule() {
  const { loanId } = useParams();
  const [loan, setLoan] = useState(null);
  const [schedule, setSchedule] = useState([]);

  useEffect(() => {
    fetchLoan();
  }, []);

  // Fetch loan details from Supabase
  async function fetchLoan() {
    const { data } = await supabase
      .from("loans")
      .select("*")
      .eq("id", loanId)
      .single();

    if (data) {
      setLoan(data);
      setSchedule(generateAmortization(data.amount, data.interest_rate, data.duration_months));
    }
  }

  // Generate monthly amortization schedule
  function generateAmortization(amount, annualRate, months) {
    const monthlyRate = annualRate / 100 / 12;
    const monthlyPayment = (amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));

    let balance = amount;
    const schedule = [];

    for (let i = 1; i <= months; i++) {
      const interest = balance * monthlyRate;
      const principal = monthlyPayment - interest;
      balance -= principal;

      schedule.push({
        month: i,
        payment: monthlyPayment,
        principal,
        interest,
        balance: balance > 0 ? balance : 0
      });
    }

    return schedule;
  }

  // Download PDF of amortization schedule
  function downloadPDF() {
    const doc = new jsPDF();
    doc.text(`Loan Amortization - Member ${loan?.member_id}`, 14, 15);

    const tableData = schedule.map(s => [
      s.month,
      s.payment.toFixed(2),
      s.principal.toFixed(2),
      s.interest.toFixed(2),
      s.balance.toFixed(2)
    ]);

    doc.autoTable({
      head: [["Month", "Payment", "Principal", "Interest", "Balance"]],
      body: tableData,
      startY: 25
    });

    doc.save(`Loan_${loan?.id}_Amortization.pdf`);
  }

  if (!loan) return <p>Loading...</p>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">
        Loan Amortization - Member {loan.member_id}
      </h1>

      <button
        onClick={downloadPDF}
        className="bg-blue-600 text-white px-4 py-2 rounded mb-4"
      >
        Download PDF
      </button>

      <table className="min-w-full table-auto bg-white rounded-xl shadow">
        <thead className="bg-gray-200">
          <tr>
            <th className="p-3 text-left">Month</th>
            <th className="p-3 text-left">Payment</th>
            <th className="p-3 text-left">Principal</th>
            <th className="p-3 text-left">Interest</th>
            <th className="p-3 text-left">Balance</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map(s => (
            <tr key={s.month} className="border-b hover:bg-gray-100">
              <td className="p-3">{s.month}</td>
              <td className="p-3">{s.payment.toFixed(2)}</td>
              <td className="p-3">{s.principal.toFixed(2)}</td>
              <td className="p-3">{s.interest.toFixed(2)}</td>
              <td className="p-3">{s.balance.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}