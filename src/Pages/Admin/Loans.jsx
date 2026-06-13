import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import "../Admin/Loan.css";

// ================= CONFIG =================
const LOAN_ACCOUNT = "1011";
const LOAN_INTEREST_ACCOUNT = "1020";
const INSTALLMENT_DAYS = 30;

// ================= FORMAT =================
const format = (n) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n || 0));

// ================= PAR MODEL =================
const getParCategory = (days) => {
  if (days <= 0) return "Performing";
  if (days <= 30) return "PAR 30";
  if (days <= 60) return "PAR 60";
  if (days <= 90) return "PAR 90";
  return "Default";
};

const getParWeight = (days) => {
  if (days <= 0) return 0.01;
  if (days <= 30) return 0.1;
  if (days <= 60) return 0.25;
  if (days <= 90) return 0.5;
  return 1.0;
};

// ================= BADGE CLASSES =================
const getParClass = (category) => {
  if (category === "Performing") return "par-performing";
  if (category === "PAR 30") return "par-30";
  if (category === "PAR 60") return "par-60";
  if (category === "PAR 90") return "par-90";
  return "par-default";
};

const getRiskClass = (band) => {
  if (band === "Excellent") return "risk-excellent";
  if (band === "Good") return "risk-good";
  if (band === "Fair") return "risk-fair";
  return "risk-high";
};

// ================= FETCH =================
async function fetchAllLedger() {
  let all = [];
  let from = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("general_ledger")
      .select("*")
      .order("date", { ascending: true })
      .range(from, from + limit - 1);

    if (error || !data) {
      console.error(error);
      break;
    }

    all = [...all, ...data];

    from += limit;

    if (data.length < limit) break;
  }

  return all;
}

// ================= MAIN =================
export default function Loan() {
  const [members, setMembers] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);

    const ledger = await fetchAllLedger();

    const map = {};

    const now = new Date();

    // ================= PROCESS LEDGER =================
    ledger.forEach((row) => {
      const member = row.member_no || "UNKNOWN";

      const name = row.name || "";

      const debit = String(
        row.debit_account_id || ""
      ).trim();

      const credit = String(
        row.credit_account_id || ""
      ).trim();

      const amount = Number(row.amount || 0);

      const txDate = new Date(
        row.date || row.created_at
      );

      if (!map[member]) {
        map[member] = {
          member_no: member,
          name,

          // ---- loan principal (1011) ----
          loan: 0, // total disbursed (debits to 1011)
          repaid: 0, // total principal repaid (credits to 1011)

          // ---- interest on loan (1020) ----
          interestCharged: 0, // debits to 1020
          interestPaid: 0, // credits to 1020

          // tracking dates
          lastLoanIncreaseDate: null,
          lastPaymentDate: null,
        };
      }

      // ==================================================
      // LOAN DISBURSEMENT / TOPUP / REFINANCE
      // ==================================================
      // ONLY a debit to 1011 increases the loan principal
      // AND resets the loan cycle date (arrears clock anchor)
      // ==================================================

      if (debit === LOAN_ACCOUNT) {
        map[member].loan += amount;

        // always overwrite with the latest increase date
        map[member].lastLoanIncreaseDate = txDate;
      }

      // ==================================================
      // PRINCIPAL REPAYMENT
      // ==================================================
      // A credit to 1011 = principal repayment received
      // ==================================================

      if (credit === LOAN_ACCOUNT) {
        map[member].repaid += amount;

        map[member].lastPaymentDate = txDate;
      }

      // ==================================================
      // INTEREST CHARGED
      // ==================================================
      // A debit to 1020 = interest accrued/charged on the loan
      // ==================================================

      if (debit === LOAN_INTEREST_ACCOUNT) {
        map[member].interestCharged += amount;
      }

      // ==================================================
      // INTEREST REPAYMENT
      // ==================================================
      // A credit to 1020 = interest repayment received
      // Counts as servicing activity, resets arrears clock
      // ==================================================

      if (credit === LOAN_INTEREST_ACCOUNT) {
        map[member].interestPaid += amount;

        map[member].lastPaymentDate = txDate;
      }
    });

    // ================= TRANSFORM =================
    const result = Object.values(map).map((m) => {
      // principal outstanding
      const balance = m.loan - m.repaid;

      // interest outstanding (charged but not yet paid)
      const interestBalance =
        m.interestCharged - m.interestPaid;

      // total outstanding = principal + interest still owed
      const totalOutstanding = balance + interestBalance;

      // repayment ratio (principal only)
      const ratio = m.loan ? m.repaid / m.loan : 0;

      let arrearsDays = 0;

      let isInArrears = false;

      // ==================================================
      // DPD / ARREARS LOGIC
      // ==================================================
      // RULE:
      // latest payment activity wins
      // BUT if loan was refinanced/topup later,
      // use latest loan increase date
      // ==================================================

      let refDate = null;

      if (m.lastPaymentDate && m.lastLoanIncreaseDate) {
        refDate =
          m.lastPaymentDate > m.lastLoanIncreaseDate
            ? m.lastPaymentDate
            : m.lastLoanIncreaseDate;
      } else {
        refDate = m.lastPaymentDate || m.lastLoanIncreaseDate;
      }

      // ================= CALCULATE DPD =================
      // Arrears apply when there is any outstanding balance
      // (principal and/or interest)
      if (totalOutstanding > 0 && refDate) {
        const nextDue = new Date(refDate);

        nextDue.setDate(nextDue.getDate() + INSTALLMENT_DAYS);

        const dpd = Math.floor(
          (now - nextDue) / (1000 * 60 * 60 * 24)
        );

        if (dpd > 0) {
          arrearsDays = Math.min(dpd, 120);

          isInArrears = true;
        }
      }

      // ================= PAR =================
      const parCategory = getParCategory(arrearsDays);

      const weight = getParWeight(arrearsDays);

      // PAR exposure is calculated on the full outstanding
      // balance (principal + interest), per portfolio-at-risk convention
      const parExposure = totalOutstanding * weight;

      // ================= CREDIT SCORE =================
      let score = 0;

      // repayment behavior
      score += ratio * 40;

      // arrears discipline
      if (arrearsDays <= 0) score += 40;
      else if (arrearsDays <= 30) score += 25;
      else if (arrearsDays <= 60) score += 15;
      else if (arrearsDays <= 90) score += 5;

      // completion bonus
      if (balance <= 0) score += 20;

      score = Math.min(100, score);

      // ================= RISK =================
      let riskBand = "High Risk";

      if (score >= 85) riskBand = "Excellent";
      else if (score >= 70) riskBand = "Good";
      else if (score >= 50) riskBand = "Fair";

      return {
        ...m,

        balance,

        interestBalance,

        totalOutstanding,

        ratio,

        arrearsDays,

        isInArrears,

        score: Number(score.toFixed(2)),

        riskBand,

        parCategory,

        parExposure: Number(parExposure.toFixed(2)),

        lastLoanIncreaseDate: m.lastLoanIncreaseDate,

        lastPaymentDate: m.lastPaymentDate,
      };
    });

    // ================= SORT =================
    result.sort((a, b) => {
      const A = Number(a.member_no.replace(/\D/g, ""));

      const B = Number(b.member_no.replace(/\D/g, ""));

      return A - B;
    });

    // ================= PORTFOLIO TOTALS =================
    // Loan book: total principal ever disbursed (debits to 1011)
    const loanBook = result.reduce((a, b) => a + b.loan, 0);

    // Interest book: total interest ever charged (debits to 1020)
    const interestBook = result.reduce(
      (a, b) => a + b.interestCharged,
      0
    );

    // Combined book: loan principal + interest charged
    const totalBook = loanBook + interestBook;

    // Outstanding principal balance
    const balance = result.reduce((a, b) => a + b.balance, 0);

    // Outstanding interest balance
    const interestBalance = result.reduce(
      (a, b) => a + b.interestBalance,
      0
    );

    // Total outstanding = principal + interest still owed
    const totalOutstanding = balance + interestBalance;

    // Total interest paid (credits to 1020)
    const totalInterestPaid = result.reduce(
      (a, b) => a + b.interestPaid,
      0
    );

    // PAR exposure (computed on principal + interest outstanding)
    const parExposure = result.reduce(
      (a, b) => a + b.parExposure,
      0
    );

    const performing = result.filter(
      (m) => m.parCategory === "Performing"
    ).length;

    const atRisk = result.filter(
      (m) => m.parCategory !== "Performing"
    ).length;

    // PAR rate measured against the total combined book
    // (loan principal + interest charged)
    const parRate =
      totalBook > 0 ? (parExposure / totalBook) * 100 : 0;

    setStats({
      loanBook,
      interestBook,
      totalBook,
      balance,
      interestBalance,
      totalOutstanding,
      totalInterestPaid,
      parExposure,
      parRate,
      performing,
      atRisk,
    });

    setMembers(result);

    setLoading(false);
  };

  // ================= UI =================
  return (
    <div className="page">
      <span className="eyebrow">Credit &amp; Risk · Ledger 1011 / 1020</span>
      <h2>Loan Portfolio Dashboard</h2>

      {/* ================= KPI ================= */}
      <div className="kpiGrid">
        <div className="card">
          <p>Loan Book (1011)</p>
          <h3>{format(stats.loanBook)}</h3>
        </div>

        <div className="card">
          <p>Interest Book (1020)</p>
          <h3>{format(stats.interestBook)}</h3>
        </div>

        <div className="card">
          <p>Total Book (Loan + Interest)</p>
          <h3>{format(stats.totalBook)}</h3>
        </div>

        <div className="card">
          <p>Principal Outstanding</p>
          <h3>{format(stats.balance)}</h3>
        </div>

        <div className="card">
          <p>Interest Outstanding</p>
          <h3>{format(stats.interestBalance)}</h3>
        </div>

        <div className="card">
          <p>Total Outstanding</p>
          <h3>{format(stats.totalOutstanding)}</h3>
        </div>

        <div className="card">
          <p>Total Interest Paid</p>
          <h3>{format(stats.totalInterestPaid)}</h3>
        </div>

        <div className="card">
          <p>PAR Exposure</p>
          <h3 className="negative">
            {format(stats.parExposure)}
          </h3>
        </div>

        <div className="card">
          <p>PAR Rate</p>
          <h3 className="negative">
            {format(stats.parRate)}%
          </h3>
        </div>

        <div className="card">
          <p>Performing</p>
          <h3>{stats.performing}</h3>
        </div>

        <div className="card">
          <p>At Risk</p>
          <h3 className="negative">{stats.atRisk}</h3>
        </div>
      </div>

      {/* ================= TABLE ================= */}
      <div className="tableWrap">
        {loading ? (
          <p className="loading">Loading...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Name</th>
                <th>Principal Bal.</th>
                <th>Interest Bal.</th>
                <th>Total Outstanding</th>
                <th>Interest Paid</th>
                <th>PAR</th>
                <th>DPD</th>
                <th>Score</th>
                <th>Risk</th>
              </tr>
            </thead>

            <tbody>
              {members.map((m) => (
                <tr key={m.member_no}>
                  <td>{m.member_no}</td>

                  <td>{m.name}</td>

                  <td>{format(m.balance)}</td>

                  <td>{format(m.interestBalance)}</td>

                  <td>{format(m.totalOutstanding)}</td>

                  <td>{format(m.interestPaid)}</td>

                  <td>
                    <span className={`par-badge ${getParClass(m.parCategory)}`}>
                      {m.parCategory}
                    </span>
                  </td>

                  <td
                    className={
                      m.isInArrears ? "arrears bad" : "arrears good"
                    }
                  >
                    {m.arrearsDays}
                  </td>

                  <td>{format(m.score)}</td>

                  <td>
                    <span className={`risk-badge ${getRiskClass(m.riskBand)}`}>
                      {m.riskBand}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}