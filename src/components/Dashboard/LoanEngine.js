import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { v4 as uuidv4 } from "uuid";

const LoanEngine = () => {
  // =========================
  // MEMBER
  // =========================
  const getMember = () => {
    try {
      const stored = localStorage.getItem("member");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  };

  const member = getMember();
  const memberNo = member?.member_no;

  // =========================
  // STATE
  // =========================
  const [savings, setSavings] = useState(0);
  const [income, setIncome] = useState(0);
  const [score, setScore] = useState(0);
  const [limit, setLimit] = useState(0);

  const [amount, setAmount] = useState("");
  const [months, setMonths] = useState(3);

  const [loanType, setLoanType] = useState("");
  const [purpose, setPurpose] = useState("");
  const [security, setSecurity] = useState("");

  const [documents, setDocuments] = useState([]);

  const [status, setStatus] = useState("");

  // =========================
  // LOAD DATA
  // =========================
  useEffect(() => {
    if (!memberNo) return;
    loadData();
  }, [memberNo]);

  const loadData = async () => {
    console.log("🏦 LOAN ENGINE:", memberNo);

    const { data } = await supabase
      .from("general_ledger")
      .select("*")
      .eq("member_no", memberNo);

    if (!data) return;

    // =========================
    // SAVINGS (1018 LOGIC OPTIONAL)
    // =========================
    const totalSavings = data
      .filter((t) => t.type === "savings")
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    // =========================
    // CASHFLOW
    // =========================
    const incomeTotal = data.reduce(
      (s, t) => s + Number(t.amount || 0),
      0
    );

    setSavings(totalSavings);
    setIncome(incomeTotal);

    // =========================
    // SCORE ENGINE
    // =========================
    let calcScore = 50;

    if (totalSavings > 5000) calcScore += 20;
    if (incomeTotal > 10000) calcScore += 10;

    setScore(calcScore);

    // =========================
    // LOAN LIMIT
    // =========================
    let multiplier = 1;

    if (calcScore >= 80) multiplier = 3;
    else if (calcScore >= 65) multiplier = 2.5;
    else if (calcScore >= 51) multiplier = 2;
    else if (calcScore >= 40) multiplier = 1.5;

    setLimit(totalSavings * multiplier);
  };

  // =========================
  // FILE HANDLER (APPEND SAFE)
  // =========================
  const handleFiles = (e) => {
    const newFiles = Array.from(e.target.files);

    const combined = [...documents, ...newFiles];

    if (combined.length > 10) {
      setStatus("❌ Maximum 10 documents allowed");
      return;
    }

    const valid = combined.every(
      (f) => f.type === "application/pdf"
    );

    if (!valid) {
      setStatus("❌ Only PDF files allowed");
      return;
    }

    setDocuments(combined);
    setStatus(`📎 ${combined.length} document(s) selected`);
  };

  // =========================
  // LOAN VALIDATION
  // =========================
  const evaluateLoan = () => {
    const repayment = Number(amount) / Number(months);

    if (!loanType) return { ok: false, msg: "Select loan type" };
    if (!security) return { ok: false, msg: "Select security type" };

    if (Number(amount) > limit) {
      return { ok: false, msg: "Exceeds loan limit" };
    }

    if (repayment > income * 0.3) {
      return { ok: false, msg: "Exceeds 30% income rule" };
    }

    if (score < 40) {
      return { ok: false, msg: "Low credit score" };
    }

    return { ok: true, msg: "Approved" };
  };

  // =========================
  // APPLY LOAN
  // =========================
  const applyLoan = async () => {
    const result = evaluateLoan();

    if (!result.ok) {
      setStatus(result.msg);
      return;
    }

    // STEP 1: CREATE LOAN RECORD
    const { data, error } = await supabase
      .from("loans")
      .insert([
        {
          member_no: memberNo,
          amount: Number(amount),
          months: Number(months),
          loan_type: loanType,
          purpose,
          security,
          status: "pending",
          score,
        },
      ])
      .select()
      .single();

    if (error) {
      console.log(error);
      setStatus("❌ Loan submission failed");
      return;
    }

    const loanId = data.id;

    // STEP 2: UPLOAD DOCUMENTS (ready for storage upgrade)
    await uploadDocuments(loanId);

    setStatus("✅ Loan submitted successfully");
  };

  // =========================
  // DOCUMENT HANDLER (STORAGE READY)
  // =========================
  const uploadDocuments = async (loanId) => {
    const uploaded = [];

    for (const file of documents) {
      const path = `${memberNo}/${loanId}/${uuidv4()}-${file.name}`;

      const { error } = await supabase.storage
        .from("loan-documents")
        .upload(path, file);

      if (error) {
        console.log("UPLOAD ERROR:", error);
        continue;
      }

      const { data } = supabase.storage
        .from("loan-documents")
        .getPublicUrl(path);

      uploaded.push({
        loan_id: loanId,
        member_no: memberNo,
        file_name: file.name,
        file_url: data.publicUrl,
      });
    }

    if (uploaded.length > 0) {
      await supabase.from("loan_documents").insert(uploaded);
    }
  };

  // =========================
  // GUARD
  // =========================
  if (!memberNo) return <div>Loading loan engine...</div>;

  // =========================
  // UI
  // =========================
  return (
    <div style={{ padding: 20 }}>
      <h2>🏦 Loan Engine</h2>

      {/* SUMMARY */}
      <div style={box}>
        <p>Savings: {savings}</p>
        <p>Income: {income}</p>
        <p>Score: {score}%</p>
        <p>Loan Limit: {limit}</p>
      </div>

      {/* LOAN TYPE */}
      <select
        value={loanType}
        onChange={(e) => setLoanType(e.target.value)}
        style={input}
      >
        <option value="">Select Loan Type</option>
        <option value="emergency">Emergency</option>
        <option value="school_fees">School Fees</option>
        <option value="business">Business</option>
        <option value="asset">Asset Purchase</option>
        <option value="development">Development</option>
        <option value="personal">Personal</option>
      </select>

      {/* PURPOSE */}
      <input
        placeholder="Purpose"
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        style={input}
      />

      {/* SECURITY */}
      <select
        value={security}
        onChange={(e) => setSecurity(e.target.value)}
        style={input}
      >
        <option value="">Select Security</option>
        <option value="own_deposit">Own Deposit</option>
        <option value="logbook">Logbook</option>
        <option value="guarantor">Guarantor</option>
        <option value="chattel">Chattel</option>
        <option value="others">Others</option>
      </select>

      {/* AMOUNT + MONTHS */}
      <input
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={input}
      />

      <input
        placeholder="Months"
        value={months}
        onChange={(e) => setMonths(e.target.value)}
        style={input}
      />

      {/* FILE UPLOAD */}
      <div style={{ marginTop: 10 }}>
        <p>Upload Documents (PDF only, max 10)</p>

        <input
          type="file"
          multiple
          accept="application/pdf"
          onChange={handleFiles}
        />

        <ul>
          {documents.map((f, i) => (
            <li key={i}>{f.name}</li>
          ))}
        </ul>
      </div>

      {/* BUTTON */}
      <button onClick={applyLoan} style={btn}>
        Apply Loan
      </button>

      <p>{status}</p>
    </div>
  );
};

// =========================
// STYLES
// =========================
const box = {
  background: "#f5f5f5",
  padding: 10,
  marginBottom: 10,
};

const input = {
  display: "block",
  marginTop: 10,
  padding: 8,
  width: "100%",
};

const btn = {
  marginTop: 15,
  padding: "10px 15px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
};

export default LoanEngine;