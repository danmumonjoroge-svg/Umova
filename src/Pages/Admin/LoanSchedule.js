import { useState } from "react";
import { generateLoanSchedule } from "../../services/loanAPI";
import { postScheduleToJournal } from "../../services/scheduleJournalAPI";

export default function LoanSchedule() {

  const [memberId, setMemberId] = useState("");
  const [principal, setPrincipal] = useState("");
  const [term, setTerm] = useState(12);
  const [rate, setRate] = useState(0.12);

  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);

  // ================= GENERATE SCHEDULE =================
  const runSchedule = async () => {
    if (!memberId || !principal) {
      alert("Enter member ID and principal");
      return;
    }

    try {
      setLoading(true);

      const res = await generateLoanSchedule({
        member_id: memberId,
        principal: Number(principal),
        term_months: Number(term),
        annual_rate: Number(rate)
      });

      setSchedule(res.schedule || []);

    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ================= POST TO JOURNAL =================
  const postToJournal = async () => {
    if (!schedule.length) {
      alert("No schedule to post");
      return;
    }

    try {
      setPosting(true);

      const res = await postScheduleToJournal({
        member_id: memberId,
        schedule
      });

      alert(`Posted ${res.entries} journal entries successfully`);

    } catch (err) {
      alert(err.message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded shadow">

      {/* ================= HEADER ================= */}
      <h2 className="text-lg font-bold mb-4">
        Loan Schedule Engine (ERP Core Module)
      </h2>

      {/* ================= INPUTS ================= */}
      <input
        className="border p-2 w-full mb-2"
        placeholder="Member ID"
        value={memberId}
        onChange={(e) => setMemberId(e.target.value)}
      />

      <input
        className="border p-2 w-full mb-2"
        placeholder="Principal Amount"
        type="number"
        value={principal}
        onChange={(e) => setPrincipal(e.target.value)}
      />

      <input
        className="border p-2 w-full mb-2"
        placeholder="Term (months)"
        type="number"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />

      <input
        className="border p-2 w-full mb-2"
        placeholder="Annual Interest Rate (e.g. 0.12)"
        type="number"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
      />

      {/* ================= ACTION BUTTONS ================= */}
      <button
        onClick={runSchedule}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded w-full"
      >
        {loading ? "Generating..." : "Generate Schedule"}
      </button>

      <button
        onClick={postToJournal}
        disabled={posting || !schedule.length}
        className="bg-purple-600 text-white px-4 py-2 rounded w-full mt-2"
      >
        {posting ? "Posting..." : "Post Schedule to Journal"}
      </button>

      {/* ================= TABLE ================= */}
      {schedule.length > 0 && (
        <div className="mt-4 overflow-x-auto">

          <table className="w-full text-sm border">

            <thead className="bg-gray-100">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">EMI</th>
                <th className="p-2">Principal</th>
                <th className="p-2">Interest</th>
                <th className="p-2">Balance</th>
              </tr>
            </thead>

            <tbody>
              {schedule.map((row) => (
                <tr key={row.installment} className="text-center border-t">

                  <td className="p-2">{row.installment}</td>
                  <td className="p-2 font-semibold">{row.emi}</td>
                  <td className="p-2 text-green-600">{row.principal}</td>
                  <td className="p-2 text-orange-600">{row.interest}</td>
                  <td className="p-2 font-bold">{row.balance}</td>

                </tr>
              ))}
            </tbody>

          </table>

        </div>
      )}

    </div>
  );
}