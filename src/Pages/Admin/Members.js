import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import "./Members.css";

import {
  runRiskEngine,
  getParCategory,
} from "../../utils/riskEngine";

/* ======================================================
   ACCOUNT CODES
====================================================== */

const SAVINGS_ACCOUNT = "1018";
const LOAN_ACCOUNT = "1011";
const LOAN_INTEREST_ACCOUNT = "1020";
const SHARES_ACCOUNT = "1012";

const INSTALLMENT_DAYS = 30;

/* ======================================================
   FORMAT
====================================================== */

const format = (n) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/* ======================================================
   GENERATE NEXT MEMBER NUMBER
   (adjust this to match your real numbering scheme)
====================================================== */

const generateMemberNo = (existingMembers) => {
  const nums = existingMembers
    .map((m) => Number(String(m.member_no || "").replace(/\D/g, "")))
    .filter((n) => !isNaN(n));

  const max = nums.length ? Math.max(...nums) : 0;

  return `UI-${String(max + 1).padStart(4, "0")}`;
};

/* ======================================================
   COMPONENT
====================================================== */

export default function Members() {

  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(null);

  const [loading, setLoading] = useState(false);

  const [searchType, setSearchType] =
    useState("member_no");

  const [searchText, setSearchText] =
    useState("");

  /* ================= APPLICATIONS ================= */

  const [applications, setApplications] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [showApplications, setShowApplications] = useState(false);

  /* ================= ADD MEMBER MODAL ================= */

  const [showAddMember, setShowAddMember] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    national_id: "",
    email: "",
    phone: "",
    branch: "",
  });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  /* ======================================================
     LOAD MEMBERS + LEDGER
  ====================================================== */

  const load = async () => {

    setLoading(true);

    /* ================= MEMBERS ================= */

    const { data: memberData } =
      await supabase
        .from("members")
        .select("*");

    /* ================= LEDGER ================= */

    const { data: ledgerData } =
      await supabase
        .from("general_ledger")
        .select("*");

    const ledger = ledgerData || [];

    /* ======================================================
       MEMBER MAP
    ====================================================== */

    const map = {};

    /* ======================================================
       INITIALIZE
    ====================================================== */

    (memberData || []).forEach((m) => {

      map[m.member_no] = {

        ...m,

        savings: 0,
        shares: 0,

        loanIssued: 0,
        loanPaid: 0,

        interestPaid: 0,

        loanBalance: 0,

        arrearsDays: 0,
        parCategory: "Performing",

        lastPaymentDate: null,
        lastLoanIncreaseDate: null,

        repaymentRatio: 0,

        refinanceCount: 0,
        activeLoans: 1,

        monthlySavings: 0,
        savingsFrequency: 0,

        dormantMonths: 0,
        savingsTrend: "stable",

        activityConsistency: 80,

        withdrawalFrequency: 0,

        suspiciousActivity: false,
        rapidWithdrawals: false,

        score: 0,
        riskLabel: "Unknown",

      };
    });

    /* ======================================================
       PROCESS LEDGER
    ====================================================== */

    ledger.forEach((row) => {

      const member =
        row.member_no;

      if (!member) return;

      if (!map[member]) {

        map[member] = {

          member_no: member,
          name:
            row.name ||
            "Unknown",

          savings: 0,
          shares: 0,

          loanIssued: 0,
          loanPaid: 0,

          interestPaid: 0,

          loanBalance: 0,

          arrearsDays: 0,
          parCategory:
            "Performing",

          lastPaymentDate: null,
          lastLoanIncreaseDate:
            null,

          repaymentRatio: 0,

          refinanceCount: 0,
          activeLoans: 1,

          monthlySavings: 0,
          savingsFrequency: 0,

          dormantMonths: 0,
          savingsTrend:
            "stable",

          activityConsistency: 80,

          withdrawalFrequency: 0,

          suspiciousActivity: false,
          rapidWithdrawals: false,

          score: 0,
          riskLabel: "Unknown",

        };
      }

      const debit = String(
        row.debit_account_id || ""
      ).trim();

      const credit = String(
        row.credit_account_id || ""
      ).trim();

      const amount = Number(
        row.amount || 0
      );

      const date = new Date(
        row.date ||
          row.created_at
      );

      /* ======================================================
         SAVINGS
      ====================================================== */

      if (
        credit ===
        SAVINGS_ACCOUNT
      ) {

        map[member].savings +=
          amount;

        map[
          member
        ].monthlySavings += amount;

        map[
          member
        ].savingsFrequency += 1;
      }

      if (
        debit === SAVINGS_ACCOUNT
      ) {

        map[member].savings -=
          amount;

        map[
          member
        ].withdrawalFrequency += 1;
      }

      /* ======================================================
         SHARES
      ====================================================== */

      if (
        credit === SHARES_ACCOUNT
      ) {
        map[member].shares +=
          amount;
      }

      if (
        debit === SHARES_ACCOUNT
      ) {
        map[member].shares -=
          amount;
      }

      /* ======================================================
         LOAN ISSUE
         A debit to 1011 (loan account) = new loan disbursed.
         This is the anchor date for the 30-day arrears clock.
      ====================================================== */

      if (
        debit === LOAN_ACCOUNT
      ) {

        map[
          member
        ].loanIssued += amount;

        map[
          member
        ].lastLoanIncreaseDate =
          date;
      }

      /* ======================================================
         PRINCIPAL PAYMENT
         A credit to 1011 = principal repayment received.
      ====================================================== */

      if (
        credit === LOAN_ACCOUNT
      ) {

        map[
          member
        ].loanPaid += amount;

        map[
          member
        ].lastPaymentDate =
          date;
      }

      /* ======================================================
         INTEREST PAYMENT
         A debit to 1020 (interest on loan) = interest accrued/charged.
         Only debits are counted per spec.
      ====================================================== */

      if (
        debit ===
        LOAN_INTEREST_ACCOUNT
      ) {

        map[
          member
        ].interestPaid += amount;

      }

      /* Credits to 1020 (interest repayments received) still
         update the last payment date so the arrears clock resets
         when a member pays interest. */
      if (
        credit ===
        LOAN_INTEREST_ACCOUNT
      ) {

        map[
          member
        ].lastPaymentDate =
          date;
      }

    });

    /* ======================================================
       FINAL PROCESSING
    ====================================================== */

    const now = new Date();

    const result = Object.values(
      map
    ).map((m) => {

      /* =========================
         BALANCE
      ========================= */

      const loanBalance =
        m.loanIssued -
        m.loanPaid;

      /* =========================
         REPAYMENT RATIO
      ========================= */

      const repaymentRatio =
        m.loanIssued > 0
          ? m.loanPaid /
            m.loanIssued
          : 0;

      /* =========================
         REFERENCE DATE
         Arrears clock starts 30 days after the most recent
         debit to 1011 (loan issue), unless a later payment
         (credit to 1011 or 1020) reset it.
      ========================= */

      let refDate =
        m.lastPaymentDate ||
        m.lastLoanIncreaseDate;

      /* =========================
         REFINANCE RESET
      ========================= */

      if (
        m.lastLoanIncreaseDate &&
        (!m.lastPaymentDate ||
          m.lastLoanIncreaseDate >
            m.lastPaymentDate)
      ) {

        refDate =
          m.lastLoanIncreaseDate;
      }

      /* =========================
         DPD
         arrearsDays = days past (refDate + 30)
      ========================= */

      let arrearsDays = 0;

      if (
        loanBalance > 0 &&
        refDate
      ) {

        const nextDue =
          new Date(refDate);

        nextDue.setDate(
          nextDue.getDate() +
            INSTALLMENT_DAYS
        );

        const dpd = Math.floor(
          (now - nextDue) /
            (1000 *
              60 *
              60 *
              24)
        );

        if (dpd > 0) {
          arrearsDays = dpd;
        }
      }

      /* =========================
         MEMBERSHIP MONTHS
      ========================= */

      const created =
        new Date(
          m.created_at || now
        );

      const membershipMonths =
        Math.max(
          1,
          Math.floor(
            (now - created) /
              (1000 *
                60 *
                60 *
                24 *
                30)
          )
        );

      /* =========================
         RUN RISK ENGINE
      ========================= */

      const risk =
        runRiskEngine({

          arrearsDays,

          repaymentRatio,

          missedPayments:
            Math.floor(
              arrearsDays / 30
            ),

          refinanceCount:
            m.refinanceCount,

          monthlySavings:
            m.monthlySavings,

          savingsFrequency:
            m.savingsFrequency,

          dormantMonths: 0,

          savingsTrend:
            "stable",

          loanBalance,

          totalSavings:
            m.savings,

          activeLoans: 1,

          membershipMonths,

          activityConsistency:
            80,

          monthlyIncome:
            Number(
              m.salary || 0
            ),

          monthlyInstallment:
            loanBalance / 12,

          existingDeductions: 0,

          withdrawalFrequency:
            m.withdrawalFrequency,

          suspiciousActivity:
            false,

          rapidWithdrawals:
            false,

        });

      return {

        ...m,

        totalSavings:
          m.savings,

        totalShares:
          m.shares,

        loanBalance,

        repaymentRatio,

        arrearsDays,

        parCategory:
          getParCategory(
            arrearsDays
          ),

        score: risk.score,

        riskLabel:
          risk.riskLabel,

      };
    });

    /* ======================================================
       SORT
    ====================================================== */

    result.sort((a, b) => {

      const A = Number(
        String(
          a.member_no || ""
        ).replace(/\D/g, "")
      );

      const B = Number(
        String(
          b.member_no || ""
        ).replace(/\D/g, "")
      );

      return A - B;
    });

    setMembers(result);

    setLoading(false);
  };

  /* ======================================================
     LOAD PENDING APPLICATIONS
  ====================================================== */

  const loadApplications = async () => {

    setAppsLoading(true);

    const { data, error } = await supabase
      .from("membership_applications")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (!error) {
      setApplications(data || []);
    }

    setAppsLoading(false);
  };

  useEffect(() => {
    load();
    loadApplications();
  }, []);

  /* ======================================================
     APPROVE APPLICATION
     -> creates a member record + marks application approved
  ====================================================== */

  const approveApplication = async (app) => {

    const member_no = generateMemberNo(members);

    const { error: insertError } = await supabase
      .from("members")
      .insert([
        {
          member_no,
          name: app.name,
          national_id: app.national_id,
          email: app.email,
          phone: app.phone,
          branch: app.branch || null,
          status: "active",
          kyc_status: "PENDING",
          first_login: true,
          first_time_login: false,
        },
      ]);

    if (insertError) {
      alert("Failed to create member: " + insertError.message);
      return;
    }

    const { error: updateError } = await supabase
      .from("membership_applications")
      .update({ status: "approved" })
      .eq("id", app.id);

    if (updateError) {
      alert("Member created, but failed to update application status: " + updateError.message);
    }

    await loadApplications();
    await load();
  };

  /* ======================================================
     REJECT APPLICATION
  ====================================================== */

  const rejectApplication = async (app) => {

    const confirmed = window.confirm(
      `Reject application from ${app.name}?`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("membership_applications")
      .update({ status: "rejected" })
      .eq("id", app.id);

    if (error) {
      alert("Failed to reject application: " + error.message);
      return;
    }

    await loadApplications();
  };

  /* ======================================================
     ADD MEMBER MANUALLY
  ====================================================== */

  const submitAddMember = async (e) => {
    e.preventDefault();

    setAddError("");

    if (!addForm.name.trim()) {
      setAddError("Name is required.");
      return;
    }

    setAddSaving(true);

    const member_no = generateMemberNo(members);

    const { error } = await supabase
      .from("members")
      .insert([
        {
          member_no,
          name: addForm.name.trim(),
          national_id: addForm.national_id.trim() || null,
          email: addForm.email.trim() || null,
          phone: addForm.phone.trim() || null,
          branch: addForm.branch.trim() || null,
          status: "active",
          kyc_status: "PENDING",
          first_login: true,
          first_time_login: false,
        },
      ]);

    setAddSaving(false);

    if (error) {
      setAddError(error.message);
      return;
    }

    setAddForm({
      name: "",
      national_id: "",
      email: "",
      phone: "",
      branch: "",
    });

    setShowAddMember(false);

    await load();
  };

  /* ======================================================
     FILTER
  ====================================================== */

  const filtered = members.filter(
    (m) => {

      const q = String(
        searchText || ""
      )
        .toLowerCase()
        .trim();

      if (!q) return true;

      const value = String(
        m[searchType] || ""
      )
        .toLowerCase()
        .trim();

      return value.includes(q);
    }
  );

  /* ======================================================
     COLORS
  ====================================================== */

  const getRiskClass = (
    label
  ) => {

    if (label === "Excellent")
      return "excellent";

    if (label === "Very Good")
      return "verygood";

    if (label === "Good")
      return "good";

    if (label === "Fair")
      return "fair";

    if (label === "Poor")
      return "poor";

    return "verypoor";
  };

  const getDpdClass = (
    days
  ) => {

    if (days <= 0)
      return "good";

    if (days <= 30)
      return "warning";

    if (days <= 60)
      return "bad";

    return "danger";
  };

  /* ======================================================
     UI
  ====================================================== */

  return (
    <div className="members-page">

      {/* HEADER */}
      <div className="header">

        <h1>
          🏦 Member Registry
        </h1>

        <p>
          SACCO Intelligence
          Dashboard
        </p>

      </div>

      {/* ACTION BAR */}
      <div className="action-bar">

        <button
          className="action-btn"
          onClick={() => setShowApplications(true)}
        >
          📥 Pending Applications
          {applications.length > 0 && (
            <span className="badge-count">
              {applications.length}
            </span>
          )}
        </button>

        <button
          className="action-btn"
          onClick={() => setShowAddMember(true)}
        >
          ➕ Add Member
        </button>

      </div>

      {/* SEARCH */}
      <div className="search-bar">

        <select
          value={searchType}
          onChange={(e) =>
            setSearchType(
              e.target.value
            )
          }
        >

          <option value="member_no">
            Member No
          </option>

          <option value="name">
            Name
          </option>

          <option value="phone">
            Phone
          </option>

          <option value="national_id">
            National ID
          </option>

        </select>

        <input
          type="text"
          placeholder={`Search by ${searchType}`}
          value={searchText}
          onChange={(e) =>
            setSearchText(
              e.target.value
            )
          }
        />

      </div>

      {/* TABLE */}
      <div className="table-wrapper">

        {loading ? (

          <div className="loading">
            <div className="loading-rows">
              {Array.from({ length: 8 }).map((_, i) => (
                <div className="loading-row" key={i} />
              ))}
            </div>
            <p className="loading-text">Loading members...</p>
          </div>

        ) : (

          <table className="members-table">

            <thead>

              <tr>

                <th>
                  Member No
                </th>

                <th>Name</th>

                <th>Savings</th>

                <th>Shares</th>

                <th>
                  Loan Balance
                </th>

                <th>DPD</th>

                <th>Score</th>

                <th>Risk</th>

              </tr>

            </thead>

            <tbody>

              {filtered.map((m) => (

                <tr
                  key={m.member_no}
                  className="clickable-row"
                  onClick={() =>
                    setSelected(m)
                  }
                >

                  <td>
                    {m.member_no}
                  </td>

                  <td>{m.name}</td>

                  <td>
                    {format(
                      m.totalSavings
                    )}
                  </td>

                  <td>
                    {format(
                      m.totalShares
                    )}
                  </td>

                  <td>
                    {format(
                      m.loanBalance
                    )}
                  </td>

                  <td>

                    <span
                      className={`dpd-badge ${getDpdClass(
                        m.arrearsDays
                      )}`}
                    >
                      {
                        m.arrearsDays
                      }
                    </span>

                  </td>

                  <td>
                    {m.score}
                  </td>

                  <td>

                    <span
                      className={`risk-badge ${getRiskClass(
                        m.riskLabel
                      )}`}
                    >
                      {
                        m.riskLabel
                      }
                    </span>

                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        )}

      </div>

      {/* ======================================================
         POPUP MEMBER CARD
      ====================================================== */}

      {selected && (

        <div className="popup-overlay">

          <div className="member-popup">

            {/* CLOSE */}
            <button
              className="close-btn"
              onClick={() =>
                setSelected(null)
              }
            >
              ✕
            </button>

            {/* PROFILE */}
            <div className="popup-header">

              <div className="avatar">

                {selected.name
                  ?.charAt(0)
                  ?.toUpperCase()}

              </div>

              <div>

                <h2>
                  {selected.name}
                </h2>

                <p>
                  {
                    selected.member_no
                  }
                </p>

              </div>

            </div>

            {/* DETAILS */}
            <div className="popup-body">

              <div className="detail-grid">

                <div className="detail-card">
                  <span>
                    Savings
                  </span>

                  <h3>
                    {format(
                      selected.totalSavings
                    )}
                  </h3>
                </div>

                <div className="detail-card">
                  <span>
                    Shares
                  </span>

                  <h3>
                    {format(
                      selected.totalShares
                    )}
                  </h3>
                </div>

                <div className="detail-card">
                  <span>
                    Loan Balance
                  </span>

                  <h3>
                    {format(
                      selected.loanBalance
                    )}
                  </h3>
                </div>

                <div className="detail-card">
                  <span>
                    Interest Due (1020)
                  </span>

                  <h3>
                    {format(
                      selected.interestPaid
                    )}
                  </h3>
                </div>

              </div>

              {/* RISK SECTION */}
              <div className="risk-section">

                <h3>
                  Risk Analysis
                </h3>

                <div
                  className={`risk-big ${getRiskClass(
                    selected.riskLabel
                  )}`}
                >
                  {
                    selected.riskLabel
                  }
                </div>

                <div className="score-big">
                  <span className="gauge-value">
                    Score: {selected.score}
                  </span>
                  <div className="gauge-track">
                    <div
                      className="gauge-fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, Number(selected.score) || 0))}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="par-box">

                  PAR:
                  {" "}
                  {
                    selected.parCategory
                  }

                </div>

                <div
                  className={`dpd-big ${getDpdClass(
                    selected.arrearsDays
                  )}`}
                >

                  {
                    selected.arrearsDays
                  }
                  {" "}
                  Days In Arrears

                </div>

              </div>

              {/* PERSONAL DETAILS */}
              <div className="personal-section">

                <h3>
                  Member Details
                </h3>

                <p>
                  📞
                  {" "}
                  {
                    selected.phone
                  }
                </p>

                <p>
                  🆔
                  {" "}
                  {
                    selected.national_id
                  }
                </p>

                <p>
                  📧
                  {" "}
                  {
                    selected.email
                  }
                </p>

                <p>
                  💼
                  {" "}
                  {
                    selected.occupation
                  }
                </p>

              </div>

            </div>

          </div>

        </div>

      )}

      {/* ======================================================
         PENDING APPLICATIONS PANEL
      ====================================================== */}

      {showApplications && (

        <div className="popup-overlay">

          <div className="member-popup applications-popup">

            <button
              className="close-btn"
              onClick={() => setShowApplications(false)}
            >
              ✕
            </button>

            <div className="popup-header">
              <div>
                <h2>Pending Applications</h2>
                <p>{applications.length} awaiting review</p>
              </div>
            </div>

            <div className="popup-body">

              {appsLoading ? (
                <p className="loading-text">Loading applications...</p>
              ) : applications.length === 0 ? (
                <p className="loading-text">No pending applications.</p>
              ) : (

                <table className="members-table">

                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>National ID</th>
                      <th>Phone</th>
                      <th>Email</th>
                      <th>Branch</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {applications.map((app) => (
                      <tr key={app.id}>
                        <td>{app.name}</td>
                        <td>{app.national_id}</td>
                        <td>{app.phone}</td>
                        <td>{app.email}</td>
                        <td>{app.branch || "—"}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="approve-btn"
                              onClick={() => approveApplication(app)}
                            >
                              Approve
                            </button>
                            <button
                              className="reject-btn"
                              onClick={() => rejectApplication(app)}
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>

                </table>
              )}

            </div>

          </div>

        </div>

      )}

      {/* ======================================================
         ADD MEMBER MODAL
      ====================================================== */}

      {showAddMember && (

        <div className="popup-overlay">

          <div className="member-popup add-member-popup">

            <button
              className="close-btn"
              onClick={() => setShowAddMember(false)}
            >
              ✕
            </button>

            <div className="popup-header">
              <h2>Add New Member</h2>
            </div>

            <div className="popup-body">

              <form className="add-member-form" onSubmit={submitAddMember}>

                <label>
                  Full Name *
                  <input
                    type="text"
                    value={addForm.name}
                    onChange={(e) =>
                      setAddForm({ ...addForm, name: e.target.value })
                    }
                    required
                  />
                </label>

                <label>
                  National ID
                  <input
                    type="text"
                    value={addForm.national_id}
                    onChange={(e) =>
                      setAddForm({ ...addForm, national_id: e.target.value })
                    }
                  />
                </label>

                <label>
                  Phone
                  <input
                    type="text"
                    value={addForm.phone}
                    onChange={(e) =>
                      setAddForm({ ...addForm, phone: e.target.value })
                    }
                  />
                </label>

                <label>
                  Email
                  <input
                    type="email"
                    value={addForm.email}
                    onChange={(e) =>
                      setAddForm({ ...addForm, email: e.target.value })
                    }
                  />
                </label>

                <label>
                  Branch
                  <input
                    type="text"
                    value={addForm.branch}
                    onChange={(e) =>
                      setAddForm({ ...addForm, branch: e.target.value })
                    }
                  />
                </label>

                {addError && <p className="form-error">{addError}</p>}

                <button
                  type="submit"
                  className="save-btn"
                  disabled={addSaving}
                >
                  {addSaving ? "Saving..." : "Save Member"}
                </button>

              </form>

            </div>

          </div>

        </div>

      )}

    </div>
  );
}