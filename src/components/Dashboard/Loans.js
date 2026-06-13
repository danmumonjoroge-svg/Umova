import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logo from "../../asset/logo/umovalogo.png";
import "./loan.css";

// ── Sub-Ledger Account Codes ─────────────────────────────────────────────────
const LOAN_ACCOUNT     = 1011;
const SAVINGS_ACCOUNT  = 1018;
const INTEREST_ACCOUNT = 1020;

// ── Transaction charge schedule ──────────────────────────────────────────────
const calcTxCharge = (amount) => {
  const a = Number(amount || 0);
  if (a <= 0)      return 0;
  if (a <= 500)    return 10;
  if (a <= 1000)   return 15;
  if (a <= 5000)   return 25;
  if (a <= 10000)  return 35;
  return 100;
};

export default function Loan() {
  // ── State ─────────────────────────────────────────────────────────────────
  const [member,     setMember]     = useState(null);
  const [memberNo,   setMemberNo]   = useState(null);
  const [ledger,     setLedger]     = useState([]);
  const [allMembers, setAllMembers] = useState([]);

  const [showApply,     setShowApply]     = useState(false);
  const [showStatement, setShowStatement] = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [files,         setFiles]         = useState([]);
  const [dataReady,     setDataReady]     = useState(false);

  const [form, setForm] = useState({
    loan_type: "", amount: "", duration: "", net_income: "",
    purpose: "", security_type: "", security_value: "",
    guarantor_1_no: "", guarantor_2_no: "",
  });

  const handleInputChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  // ── Data Bootstrap ────────────────────────────────────────────────────────
  // STRATEGY: Always use the live Supabase auth session to identify who is
  // logged in. Never rely on localStorage keys like "remembered_member_no"
  // which persist across logins and return the WRONG member.
  //
  // Flow:
  //   1. supabase.auth.getSession() → gives us the current user's UUID (auth_user_id)
  //   2. Query members table WHERE auth_user_id = UUID → gives us member_no + all details
  //   3. Use that member_no to query general_ledger
  //
  // This means your members table MUST have an auth_user_id column that stores
  // the Supabase auth UUID (the "sub" in the JWT). If your column is named
  // differently (e.g. "user_id", "supabase_uid"), update the .eq() call below.
  useEffect(() => {
    const load = async () => {
      try {
        // Step 1: Get the currently logged-in Supabase user
        const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr || !session?.user) {
          console.error("AUTH: No active Supabase session found. User may not be logged in.");
          return;
        }
        const authUid = session.user.id; // Supabase UUID e.g. "c55e3522-012f-4bd3-b7c5-..."
        console.log("AUTH: Logged-in Supabase UID:", authUid);

        // Step 2: Look up the member record using auth_user_id column
        const { data: memberData, error: memberErr } = await supabase
          .from("members")
          .select("*")
          .eq("auth_user_id", authUid)
          .single();

        if (memberErr || !memberData) {
          console.error("AUTH: No member found for auth_user_id:", authUid, memberErr?.message);
          return;
        }

        const no = memberData.member_no;
        console.log("AUTH: Resolved member_no:", no, "Name:", memberData.name);
        setMemberNo(no);
        setMember(memberData);

        // Step 3: Fetch this member's ledger entries using their member_no
        const { data: l, error: lErr } = await supabase
          .from("general_ledger")
          .select("*")
          .eq("member_no", no);
        if (lErr) console.error("Ledger fetch error:", lErr);
        if (l) setLedger(l);

        // Fetch all members for guarantor dropdown (excluding current member)
        const { data: gm } = await supabase
          .from("members")
          .select("member_no, name, kyc_status, credit_score");
        if (gm) setAllMembers(gm);

        setDataReady(true);
      } catch (err) {
        console.error("Bootstrap failure:", err);
      }
    };
    load();
  }, []);

  // ── Core Finance Engine ───────────────────────────────────────────────────
  const finance = useMemo(() => {
    let savings = 0, loanDisbursed = 0, loanPaid = 0;
    let interestCharged = 0, interestPaid = 0;
    let lastActivityDate = null;

    ledger.forEach((t) => {
      const amt    = Number(t.amount || 0);
      const txDate = new Date(t.transaction_date || t.created_at);
      const debit  = Number(t.debit_account_id);
      const credit = Number(t.credit_account_id);

      // 1018 Savings
      if (credit === SAVINGS_ACCOUNT) savings += amt;
      if (debit  === SAVINGS_ACCOUNT) savings -= amt;

      // 1011 Loan Principal
      if (debit === LOAN_ACCOUNT) {
        loanDisbursed += amt;
        if (!lastActivityDate || txDate > lastActivityDate) lastActivityDate = txDate;
      }
      if (credit === LOAN_ACCOUNT) {
        loanPaid += amt;
        if (!lastActivityDate || txDate > lastActivityDate) lastActivityDate = txDate;
      }

      // 1020 Interest
      if (credit === INTEREST_ACCOUNT) interestCharged += amt;
      if (debit  === INTEREST_ACCOUNT) interestPaid    += amt;
    });

    const currentLoan         = Math.max(0, loanDisbursed - loanPaid);
    const outstandingInterest = Math.max(0, interestCharged - interestPaid);
    const totalOutstanding    = currentLoan + outstandingInterest;

    // Arrears
    let daysInArrears = 0;
    let arrearsClass  = "Current";
    if (currentLoan > 0 && lastActivityDate) {
      const days = Math.floor((new Date() - lastActivityDate) / 86400000);
      if (days > 30) {
        daysInArrears = days - 30;
        if      (daysInArrears <= 30)  arrearsClass = "Watch";
        else if (daysInArrears <= 60)  arrearsClass = "Substandard";
        else if (daysInArrears <= 90)  arrearsClass = "Doubtful";
        else                           arrearsClass = "Loss";
      }
    }

    // Membership age
    const membershipMonths = member?.created_at
      ? Math.floor((Date.now() - new Date(member.created_at)) / (86400000 * 30.4375))
      : 0;

    // Credit score & multiplier
    const score = member?.credit_score || 75;
    let riskRating = "Moderate Standard Risk";
    let multiplier = 2.25;
    if      (score > 80) { riskRating = "Low Risk Profile";         multiplier = 3.0; }
    else if (score >= 70){ riskRating = "Moderate Standard Risk";   multiplier = 2.25; }
    else if (score >= 55){ riskRating = "Substandard Risk Factor";  multiplier = 1.80; }
    else                 { riskRating = "High Institutional Risk";  multiplier = 1.0; }

    // Product definitions
    const products = {
      "Instant Loan":       { rate: 10, insRate: 0, maxDuration: 3,  minMonths: 0, maxAmount: Math.min(10000, savings), reqSecurity: false },
      "Salary Advance":     { rate: 10, insRate: 0, maxDuration: 3,  minMonths: 0, maxAmount: 30000,                   reqSecurity: false },
      "Emergency Loan":     { rate: 3,  insRate: 0, maxDuration: 12, minMonths: 1, maxAmount: savings,                 reqSecurity: false },
      "Development Loan":   { rate: 3,  insRate: 2, maxDuration: 36, minMonths: 3, maxAmount: savings * multiplier,    reqSecurity: true  },
      "Business Loan":      { rate: 4,  insRate: 2, maxDuration: 24, minMonths: 3, maxAmount: savings * multiplier,    reqSecurity: true  },
      "School Fees Loan":   { rate: 3,  insRate: 1, maxDuration: 12, minMonths: 3, maxAmount: savings * multiplier,    reqSecurity: false },
      "Asset Finance Loan": { rate: 5,  insRate: 2, maxDuration: 48, minMonths: 6, maxAmount: savings * multiplier,    reqSecurity: true  },
    };

    const p          = products[form.loan_type] || null;
    const reqAmount  = Number(form.amount   || 0);
    const reqMonths  = Number(form.duration || 1);
    const netIncome  = Number(form.net_income || 0);
    const txCharge   = calcTxCharge(reqAmount);
    const netDisbursable = Math.max(0, reqAmount - txCharge);

    // ── REDUCING BALANCE amortisation ────────────────────────────────────
    // Monthly interest rate = annual rate / 12
    // Each month: interest = outstanding balance × monthly rate
    //             principal = fixed instalment − interest
    // Fixed monthly instalment formula (annuity):
    //   P × r / (1 − (1+r)^−n)   where r = monthly rate, n = months
    // Insurance (if any) is charged as a one-off % of original principal
    // and spread equally over the months on top of the amortised instalment.
    const buildSchedule = (principal, annualRatePct, months, insRatePct) => {
      if (months <= 0 || principal <= 0) {
        return { schedule: [], monthlyInstallment: 0, totalInterest: 0,
                 totalInsurance: 0, totalRepayable: principal };
      }
      const r = annualRatePct / 100;               // monthly interest rate (rate is already per month)
      const insPerMonth = (principal * (insRatePct / 100)) / months;

      let monthlyPrincipalAndInterest;
      if (r === 0) {
        // Zero-interest product — pure principal split
        monthlyPrincipalAndInterest = principal / months;
      } else {
        // Standard annuity formula
        monthlyPrincipalAndInterest = principal * r / (1 - Math.pow(1 + r, -months));
      }

      const monthlyInstalment = monthlyPrincipalAndInterest + insPerMonth;
      let balance = principal;
      let totalInterestSum = 0;
      const schedule = [];

      for (let m = 1; m <= months; m++) {
        const interestThisMonth  = r > 0 ? balance * r : 0;
        const principalThisMonth = monthlyPrincipalAndInterest - interestThisMonth;
        balance = Math.max(0, balance - principalThisMonth);
        totalInterestSum += interestThisMonth;
        schedule.push({
          month:     m,
          principal: Math.round(principalThisMonth),
          interest:  Math.round(interestThisMonth),
          insurance: Math.round(insPerMonth),
          total:     Math.round(monthlyInstalment),
          balance:   Math.round(balance),
        });
      }

      const totalInsurance = insPerMonth * months;
      const totalRepayable = principal + totalInterestSum + totalInsurance;
      return { schedule, monthlyInstalment, totalInterest: totalInterestSum,
               totalInsurance, totalRepayable };
    };

    const amort = p && reqAmount > 0 && reqMonths > 0
      ? buildSchedule(reqAmount, p.rate, reqMonths, p.insRate || 0)
      : { schedule: [], monthlyInstalment: 0, totalInterest: 0, totalInsurance: 0, totalRepayable: 0 };

    const totalInterest      = amort.totalInterest;
    const insuranceFee       = amort.totalInsurance;
    const totalRepayable     = amort.totalRepayable;
    const monthlyInstallment = amort.monthlyInstalment;
    const dsrCeiling         = netIncome / 3;
    const isDsrValid         = netIncome > 0 ? monthlyInstallment <= dsrCeiling : true;

    // Refinance gate: must have repaid >= 50% AND zero arrears AND zero interest
    const repaidPercent    = loanDisbursed > 0 ? (loanPaid / loanDisbursed) * 100 : 100;
    const hasExistingLoan  = currentLoan > 0;
    const canRefinance     = hasExistingLoan && daysInArrears === 0
                             && outstandingInterest === 0 && repaidPercent >= 50;
    const refinanceBlocked = hasExistingLoan && !canRefinance;

    // Compliance verdict
    let isEligible = false;
    let complianceRemark = "Fill in all fields to see eligibility verdict.";

    if (p) {
      if (refinanceBlocked)
        complianceRemark = `REJECTED: Existing loan balance outstanding. Only ${repaidPercent.toFixed(1)}% repaid — minimum 50% required before re-applying.`;
      else if (daysInArrears > 0)
        complianceRemark = `REJECTED: Account in ${arrearsClass} arrears (${daysInArrears} days overdue). Regularize before applying.`;
      else if (outstandingInterest > 0)
        complianceRemark = `REJECTED: Unsettled interest of KES ${outstandingInterest.toLocaleString()} must be cleared first.`;
      else if (membershipMonths < p.minMonths)
        complianceRemark = `REJECTED: Minimum membership of ${p.minMonths} months required. You have ${membershipMonths} months.`;
      else if (reqAmount <= 0 || reqAmount > p.maxAmount)
        complianceRemark = `REJECTED: Amount must be between KES 1 and KES ${Math.round(p.maxAmount).toLocaleString()}.`;
      else if (reqMonths <= 0 || reqMonths > p.maxDuration)
        complianceRemark = `REJECTED: Duration must be 1–${p.maxDuration} months for this product.`;
      else if (!isDsrValid)
        complianceRemark = `REJECTED: Monthly instalment KES ${Math.round(monthlyInstallment).toLocaleString()} exceeds 1/3 pay ceiling (KES ${Math.round(dsrCeiling).toLocaleString()}).`;
      else if (p.reqSecurity && !form.security_type)
        complianceRemark = "REJECTED: Collateral/security type is mandatory for this product.";
      else {
        isEligible = true;
        complianceRemark = canRefinance
          ? `APPROVED (REFINANCE): ${repaidPercent.toFixed(1)}% of existing loan repaid. All parameters cleared.`
          : "APPROVED: All SASRA compliance parameters cleared. Ready for submission.";
      }
    }

    return {
      savings, loanDisbursed, loanPaid, currentLoan,
      outstandingInterest, totalOutstanding, interestCharged, interestPaid,
      daysInArrears, arrearsClass, membershipMonths,
      score, riskRating, multiplier,
      products: products,
      currentProduct: p,
      txCharge, totalInterest, insuranceFee, totalRepayable,
      monthlyInstallment, dsrCeiling, netDisbursable,
      isDsrValid, isEligible, complianceRemark,
      hasExistingLoan, canRefinance, refinanceBlocked, repaidPercent,
      schedule: amort.schedule,
    };
  }, [ledger, form, member]);

  // ── PDF: Official Loan Agreement ──────────────────────────────────────────
  const downloadOfficialLoanForm = () => {
    try {
      const doc   = new jsPDF();
      const GREEN = [21, 128, 61];
      const DARK  = [30, 41, 59];
      const GRAY  = [100, 116, 139];
      const LGRAY = [248, 250, 252];
      const W     = doc.internal.pageSize.getWidth();
      const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      const refNo = `LOAN-${memberNo}-${Date.now().toString().slice(-6)}`;

      // ── Header ──────────────────────────────────────────────────────────
      doc.addImage(logo, "PNG", 14, 10, 26, 26);
      doc.setFillColor(...GREEN);
      doc.rect(42, 10, W - 56, 12, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text("UMOVA INVESTMENTS LTD — SACCO CREDIT AGREEMENT", 45, 18.5);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      doc.text("P.O. Box 00100, Nairobi  |  info@umovainvestments.co.ke  |  www.umovainvestments.co.ke", 42, 28);
      doc.text(`Date: ${today}   |   Reference: ${refNo}`, 42, 33);
      doc.setDrawColor(...GREEN);
      doc.setLineWidth(0.5);
      doc.line(14, 37, W - 14, 37);

      let y = 43;

      const sectionHeader = (title) => {
        doc.setFillColor(240, 253, 244);
        doc.rect(14, y - 1, W - 28, 7, "F");
        doc.setDrawColor(...GREEN);
        doc.setLineWidth(0.3);
        doc.rect(14, y - 1, W - 28, 7, "S");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...GREEN);
        doc.text(title, 17, y + 4);
        y += 10;
      };

      const tbl = (body, colStyles) => {
        autoTable(doc, {
          startY: y,
          margin: { left: 14, right: 14 },
          body,
          theme: "plain",
          styles: { fontSize: 8.5, cellPadding: 2.8, textColor: DARK },
          alternateRowStyles: { fillColor: LGRAY },
          columnStyles: colStyles || {
            0: { fontStyle: "bold", cellWidth: 72 },
            1: { cellWidth: 50 },
            2: { fontStyle: "bold", cellWidth: 38 },
            3: {},
          },
        });
        y = doc.lastAutoTable.finalY + 6;
      };

      // ── Section 1: Member Profile ────────────────────────────────────────
      sectionHeader("SECTION 1 — MEMBER PROFILE");
      tbl([
        ["Full Legal Name:",   member?.name        || "—", "Member No:",      memberNo || "—"],
        ["National ID / PP:",  member?.id_no        || member?.national_id || member?.id_number || "—",
                                                         "Phone Number:",   member?.phone || member?.phone_number || member?.phone_no || "—"],
        ["Email Address:",     member?.email        || "—", "KYC Status:",    (member?.kyc_status || "—").toUpperCase()],
        ["Date of Joining:",   member?.created_at ? new Date(member.created_at).toLocaleDateString("en-GB") : "—",
                                                         "Credit Score:",   `${finance.score} / 100`],
      ]);

      // ── Section 2: Account Standing ──────────────────────────────────────
      sectionHeader("SECTION 2 — CURRENT ACCOUNT STANDING");
      tbl([
        ["Savings Balance (A/C 1018):",       `KES ${finance.savings.toLocaleString()}`,
         "Loan Principal (A/C 1011):",         `KES ${finance.currentLoan.toLocaleString()}`],
        ["Interest Outstanding (A/C 1020):",  `KES ${finance.outstandingInterest.toLocaleString()}`,
         "Total Amount Owed:",                 `KES ${finance.totalOutstanding.toLocaleString()}`],
        ["Risk Classification:",              finance.riskRating,
         "Multiplier Factor:",                `${finance.multiplier}x`],
        ["Days in Arrears:",                  `${finance.daysInArrears} Days (${finance.arrearsClass})`,
         "Max Eligible Cap:",                 `KES ${Math.round(Math.max(0, finance.savings * finance.multiplier - finance.currentLoan)).toLocaleString()}`],
        ["Membership Age:",                   `${finance.membershipMonths} Months`,
         "Refinance Status:",                  finance.hasExistingLoan
           ? (finance.canRefinance ? `ELIGIBLE — ${finance.repaidPercent.toFixed(1)}% repaid` : `BLOCKED — ${finance.repaidPercent.toFixed(1)}% repaid`)
           : "N/A — No existing loan"],
      ]);

      // ── Section 3: Loan Application Details ─────────────────────────────
      sectionHeader("SECTION 3 — LOAN APPLICATION DETAILS");
      const hasApp = !!form.loan_type && Number(form.amount) > 0;
      if (hasApp) {
        tbl([
          ["Product Type:",           form.loan_type,
           "Principal Requested:",    `KES ${Number(form.amount).toLocaleString()}`],
          ["Repayment Period:",        `${form.duration} Month(s)`,
           "Interest Rate (Flat):",   `${finance.currentProduct?.rate || 0}%`],
          ["Net Monthly Income:",     `KES ${Number(form.net_income || 0).toLocaleString()}`,
           "1/3 DSR Ceiling:",        `KES ${Math.round(finance.dsrCeiling).toLocaleString()}/mo`],
          ["Security Type:",          form.security_type || "—",
           "Collateral Value:",       form.security_type === "Deposits"
             ? "Internal Savings" : `KES ${Number(form.security_value || 0).toLocaleString()}`],
          ["Loan Purpose:",           form.purpose || "—", "", ""],
        ]);

        // Charges breakdown table
        autoTable(doc, {
          startY: y,
          margin: { left: 14, right: 14 },
          head: [["Charge Item", "Amount (KES)"]],
          body: [
            ["Principal Amount",                  `KES ${Number(form.amount).toLocaleString()}`],
            [`Interest — Reducing Balance (${finance.currentProduct?.rate}% p.m.)`, `KES ${Math.round(finance.totalInterest).toLocaleString()}`],
            [`Insurance/Admin Fee (${finance.currentProduct?.insRate || 0}%)`, `KES ${finance.insuranceFee.toLocaleString()}`],
            ["Transaction Processing Charge",     `KES ${finance.txCharge.toLocaleString()}`],
            ["NET Amount Disbursed to Member",    `KES ${finance.netDisbursable.toLocaleString()}`],
            ["TOTAL Amount Repayable",            `KES ${finance.totalRepayable.toLocaleString()}`],
            ["Monthly Instalment",                `KES ${Math.round(finance.monthlyInstallment).toLocaleString()}/mo`],
          ],
          headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8, fontStyle: "bold" },
          styles: { fontSize: 8.5, cellPadding: 3, textColor: DARK },
          alternateRowStyles: { fillColor: LGRAY },
          columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right", fontStyle: "bold" } },
          didParseCell: (data) => {
            const bold = ["NET Amount Disbursed to Member", "TOTAL Amount Repayable", "Monthly Instalment"];
            if (data.column.index === 0 && bold.includes(data.cell.raw)) {
              data.cell.styles.fillColor = [220, 252, 231];
            }
            if (data.column.index === 1 && bold.includes(data.row.cells[0]?.raw)) {
              data.cell.styles.fillColor = [220, 252, 231];
              data.cell.styles.textColor = GREEN;
            }
          },
        });
        y = doc.lastAutoTable.finalY + 6;

        // ── Section 4: Repayment Schedule (Reducing Balance) ─────────────
        if (finance.isEligible && finance.schedule.length > 0) {
          if (y > 220) { doc.addPage(); y = 20; }
          sectionHeader("SECTION 4 — INDICATIVE REPAYMENT SCHEDULE (REDUCING BALANCE)");
          const sched   = finance.schedule;
          const display = sched.slice(0, 24);
          const rows    = display.map((r) => [
            `Month ${r.month}`,
            `KES ${r.principal.toLocaleString()}`,
            `KES ${r.interest.toLocaleString()}`,
            `KES ${r.insurance.toLocaleString()}`,
            `KES ${r.total.toLocaleString()}`,
            `KES ${r.balance.toLocaleString()}`,
          ]);
          if (sched.length > 24)
            rows.push(["...", "...", "...", "...", "...", `(${sched.length - 24} more months)`]);
          const totalPrin = sched.reduce((s, r) => s + r.principal, 0);
          const totalInt  = sched.reduce((s, r) => s + r.interest,  0);
          const totalIns  = sched.reduce((s, r) => s + r.insurance, 0);
          const totalPay  = sched.reduce((s, r) => s + r.total,     0);
          autoTable(doc, {
            startY: y,
            margin: { left: 14, right: 14 },
            head: [["Period", "Principal", "Interest", "Insurance", "Instalment", "Balance"]],
            body: rows,
            foot: [["TOTAL",
              `KES ${Math.round(totalPrin).toLocaleString()}`,
              `KES ${Math.round(totalInt).toLocaleString()}`,
              `KES ${Math.round(totalIns).toLocaleString()}`,
              `KES ${Math.round(totalPay).toLocaleString()}`,
              "KES 0"]],
            headStyles: { fillColor: GREEN, textColor: 255, fontSize: 7.5, fontStyle: "bold" },
            footStyles: { fillColor: DARK,  textColor: 255, fontSize: 7.5, fontStyle: "bold" },
            styles: { fontSize: 7.5, cellPadding: 2, textColor: DARK, halign: "right" },
            alternateRowStyles: { fillColor: LGRAY },
            columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
          });
          y = doc.lastAutoTable.finalY + 6;
        }
      } else {
        doc.setFontSize(8.5);
        doc.setTextColor(...GRAY);
        doc.text("No loan parameters entered — fill the Apply form, then click Download to generate full details.", 14, y);
        y += 8;
      }

      // ── Section 5: Charge Schedule ───────────────────────────────────────
      if (y > 220) { doc.addPage(); y = 20; }
      sectionHeader("SECTION 5 — TRANSACTION PROCESSING CHARGE SCHEDULE");
      autoTable(doc, {
        startY: y,
        margin: { left: 14, right: 14 },
        head: [["Tier", "Amount Band (KES)", "Processing Fee (KES)"]],
        body: [
          ["Tier 1", "KES 1 – 500",         "KES 10"],
          ["Tier 2", "KES 501 – 1,000",     "KES 15"],
          ["Tier 3", "KES 1,001 – 5,000",   "KES 25"],
          ["Tier 4", "KES 5,001 – 10,000",  "KES 35"],
          ["Tier 5", "Above KES 10,000",    "KES 100"],
        ],
        headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8, fontStyle: "bold" },
        styles: { fontSize: 8.5, cellPadding: 3, textColor: DARK, halign: "center" },
        alternateRowStyles: { fillColor: LGRAY },
        columnStyles: { 2: { fontStyle: "bold" } },
      });
      y = doc.lastAutoTable.finalY + 8;

      // ── Section 6: Declaration & Signatures ──────────────────────────────
      if (y > 210) { doc.addPage(); y = 20; }
      sectionHeader("SECTION 6 — MEMBER DECLARATION & OATH");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.2);
      doc.setTextColor(...DARK);
      const oathLines = [
        "I, the undersigned member, hereby solemnly declare and agree as follows:",
        "(a) All information provided in this application is true, accurate and complete to the best of my knowledge.",
        "(b) I have read and agree to be bound by the Umova Investments SACCO By-Laws and the specific loan product terms stated herein.",
        "(c) I authorize Umova Investments Ltd to deduct monthly loan installments from my salary, savings (A/C 1018), or any other account held with the SACCO.",
        "(d) I understand that failure to repay as scheduled may result in recovery from my deposits, designated guarantors, or legal action under Kenyan law.",
        "(e) I confirm the stated loan purpose is accurate and funds will not be used for unlawful or purely speculative activities.",
        "(f) Transaction processing charges are non-refundable and will be deducted at the point of disbursement.",
        "(g) I acknowledge this document constitutes a legally binding credit agreement upon signing by all parties below.",
      ];
      oathLines.forEach((line) => {
        const split = doc.splitTextToSize(line, W - 28);
        doc.text(split, 14, y);
        y += split.length * 4.8;
      });

      y += 6;
      if (y > 240) { doc.addPage(); y = 20; }

      // Signature boxes
      const boxes = [
        { label: "Applicant Signature & Date",        sub: `Name: ${member?.name || "____________________"}`, x: 14 },
        { label: "Guarantor 1 Signature & Date",      sub: `ID: ${form.guarantor_1_no || "____________________"}`,    x: 80 },
        { label: "Credit Officer Signature & Stamp",  sub: "Umova Investments Ltd",                           x: 146 },
      ];
      boxes.forEach(({ label, sub, x }) => {
        doc.setDrawColor(...GRAY);
        doc.setLineWidth(0.4);
        doc.roundedRect(x, y, 58, 22, 2, 2);
        doc.setFontSize(7);
        doc.setTextColor(...GRAY);
        doc.text(label, x + 2, y + 8);
        doc.setDrawColor(...GRAY);
        doc.setLineWidth(0.2);
        doc.line(x + 2, y + 15, x + 55, y + 15);
        doc.setFontSize(6.5);
        doc.text(sub, x + 2, y + 20);
      });

      y += 28;
      doc.setFontSize(7);
      doc.setTextColor(...GRAY);
      doc.text(
        "Umova Investments SACCO Ltd is licensed and regulated by SASRA. This is a computer-generated document and is legally binding upon execution.",
        14, y, { maxWidth: W - 28 }
      );

      // ── Footer on every page ─────────────────────────────────────────────
      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        const pH = doc.internal.pageSize.getHeight();
        doc.setDrawColor(...GREEN);
        doc.setLineWidth(0.3);
        doc.line(14, pH - 12, W - 14, pH - 12);
        doc.setFontSize(7);
        doc.setTextColor(...GRAY);
        doc.text(
          `Umova Investments Ltd  |  Ref: ${refNo}  |  Confidential — Member Use Only  |  Page ${p} of ${totalPages}`,
          W / 2, pH - 6, { align: "center" }
        );
      }

      doc.save(`Umova_Loan_Agreement_${memberNo}_${Date.now().toString().slice(-6)}.pdf`);
    } catch (err) {
      console.error("PDF generation error:", err);
      alert("PDF generation failed: " + err.message);
    }
  };

  // ── PDF: Account Statement ────────────────────────────────────────────────
  const downloadStatement = () => {
    const doc   = new jsPDF();
    const GREEN = [21, 128, 61];
    const GRAY  = [100, 116, 139];
    const W     = doc.internal.pageSize.getWidth();

    doc.addImage(logo, "PNG", 14, 10, 26, 26);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...GREEN);
    doc.text("UMOVA INVESTMENTS LTD", 44, 18);
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.setFont("helvetica", "normal");
    doc.text("Loan & Interest Account Statement", 44, 24);
    doc.text(`Member: ${member?.name || memberNo}   |   Generated: ${new Date().toLocaleDateString("en-GB")}`, 44, 30);
    doc.setDrawColor(...GREEN);
    doc.line(14, 36, W - 14, 36);

    const rows = statementRows.map((t) => {
      const badge = getTxBadge(t);
      return [
        new Date(t.transaction_date || t.created_at).toLocaleDateString("en-GB"),
        t.receipt_no || "—",
        badge.label,
        `KES ${Number(t.amount).toLocaleString()}`,
      ];
    });

    autoTable(doc, {
      startY: 42,
      margin: { left: 14, right: 14 },
      head: [["Date", "Receipt No", "Transaction Type", "Amount (KES)"]],
      body: rows,
      foot: [[
        "", "", "Closing Balances →",
        `Principal: KES ${finance.currentLoan.toLocaleString()}  |  Interest: KES ${finance.outstandingInterest.toLocaleString()}`,
      ]],
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8 },
      footStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8 },
      styles: { fontSize: 8.5, cellPadding: 2.8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    doc.save(`Umova_Statement_${memberNo}.pdf`);
  };

  // ── Submit Loan Application ───────────────────────────────────────────────
  const executeLoanApplication = async () => {
    try {
      if (!finance.currentProduct) return alert("Select a loan product first.");
      if (!finance.isEligible)     return alert(`Cannot submit: ${finance.complianceRemark}`);
      setLoading(true);

      // Guarantor validation
      if (form.security_type === "Guarantor") {
        if (!form.guarantor_1_no) throw new Error("Primary guarantor is required.");
        const { data: gLedger } = await supabase
          .from("general_ledger").select("*").eq("member_no", form.guarantor_1_no);
        let gDisbursed = 0, gPaid = 0, gIntCharged = 0, gIntPaid = 0, gLastDate = null;
        (gLedger || []).forEach((t) => {
          const amt = Number(t.amount);
          const d = Number(t.debit_account_id), c = Number(t.credit_account_id);
          if (d === LOAN_ACCOUNT)     { gDisbursed   += amt; gLastDate = new Date(t.transaction_date || t.created_at); }
          if (c === LOAN_ACCOUNT)     { gPaid        += amt; gLastDate = new Date(t.transaction_date || t.created_at); }
          if (c === INTEREST_ACCOUNT)   gIntCharged  += amt;
          if (d === INTEREST_ACCOUNT)   gIntPaid     += amt;
        });
        const gLoan   = gDisbursed - gPaid;
        const gIntOwed = gIntCharged - gIntPaid;
        let gArrears = 0;
        if (gLoan > 0 && gLastDate) {
          const days = Math.floor((Date.now() - gLastDate) / 86400000);
          if (days > 30) gArrears = days - 30;
        }
        if (gLoan > 0 || gIntOwed > 0 || gArrears > 0)
          throw new Error(`Guarantor ${form.guarantor_1_no} has an active loan balance or arrears and cannot stand as guarantor.`);
      }

      // File uploads
      const docUrls = [];
      for (const f of files) {
        const path = `${memberNo}/${Date.now()}-${f.name}`;
        await supabase.storage.from("loan_documents").upload(path, f);
        const { data: u } = supabase.storage.from("loan_documents").getPublicUrl(path);
        docUrls.push(u.publicUrl);
      }

      const { error } = await supabase.from("loan_application").insert([{
        member_no:           memberNo,
        loan_type:           form.loan_type,
        amount:              Number(form.amount),
        duration:            Number(form.duration),
        net_income:          Number(form.net_income),
        purpose:             form.purpose,
        security_type:       form.security_type,
        security_value:      Number(form.security_value || 0),
        guarantors:          [form.guarantor_1_no, form.guarantor_2_no].filter(Boolean),
        total_interest:      finance.totalInterest,
        insurance_fee:       finance.insuranceFee,
        total_repayable:     finance.totalRepayable,
        monthly_installment: finance.monthlyInstallment,
        risk_score:          finance.score,
        risk_level:          finance.riskRating,
        documents:           docUrls,
        status:              "pending",
        arrears_days:        0,
      }]);
      if (error) throw error;

      alert("Loan application submitted successfully.");
      setShowApply(false);
      setFiles([]);
      setForm({ loan_type: "", amount: "", duration: "", net_income: "", purpose: "",
                security_type: "", security_value: "", guarantor_1_no: "", guarantor_2_no: "" });
    } catch (err) {
      alert(`Submission failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Statement helpers ─────────────────────────────────────────────────────
  const statementRows = useMemo(() =>
    ledger
      .filter((t) => {
        const d = Number(t.debit_account_id), c = Number(t.credit_account_id);
        return d === LOAN_ACCOUNT || c === LOAN_ACCOUNT ||
               d === INTEREST_ACCOUNT || c === INTEREST_ACCOUNT;
      })
      .sort((a, b) => new Date(a.transaction_date || a.created_at) - new Date(b.transaction_date || b.created_at)),
  [ledger]);

  const getTxBadge = (t) => {
    const d = Number(t.debit_account_id), c = Number(t.credit_account_id);
    if (d === LOAN_ACCOUNT     && c !== LOAN_ACCOUNT)     return { label: "Loan Disbursement",      cls: "bg-amber-50 text-amber-700 border-amber-200" };
    if (c === LOAN_ACCOUNT     && d !== LOAN_ACCOUNT)     return { label: "Principal Repayment",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    if (c === INTEREST_ACCOUNT)                           return { label: "Interest Charged",       cls: "bg-orange-50 text-orange-700 border-orange-200" };
    if (d === INTEREST_ACCOUNT)                           return { label: "Interest Paid",          cls: "bg-blue-50 text-blue-700 border-blue-200" };
    return { label: "Transaction", cls: "bg-slate-50 text-slate-600 border-slate-200" };
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const prod = finance.currentProduct;
  const reqAmt = Number(form.amount || 0);

  return (
    <div className="loan-container main-content-fade p-6 max-w-7xl mx-auto space-y-6">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white border border-slate-100 rounded-2xl p-4 shadow-sm gap-2">
        <div>
          <span className="text-[10px] font-black tracking-widest text-emerald-800 uppercase bg-emerald-50 px-2.5 py-1 rounded-md">
            SASRA Real-Time Ledger Node
          </span>
          <h1 className="text-xl font-black text-slate-800 tracking-tight uppercase mt-1.5">
            {dataReady ? (member?.name || memberNo) : "Loading account…"}
          </h1>
          {memberNo && <p className="text-[11px] text-slate-400 font-mono mt-0.5">Member No: {memberNo}</p>}
        </div>
        <p className="text-xs font-mono font-bold text-slate-400">
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {/* DASHBOARD CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">

        <div className="bg-white border border-slate-100 rounded-3xl p-5 border-l-4 border-green-700 shadow-sm space-y-1">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Savings Balance (1018)</h4>
          <h2 className="text-2xl font-black text-slate-800 font-mono">KES {finance.savings.toLocaleString()}</h2>
          <p className="text-[10px] text-emerald-800 font-extrabold uppercase tracking-wider">
            Multiplier: {finance.multiplier}x &nbsp;·&nbsp; Max Cap: KES {Math.round(finance.savings * finance.multiplier).toLocaleString()}
          </p>
        </div>

        <div className="bg-white border border-slate-100 rounded-3xl p-5 border-l-4 border-slate-600 shadow-sm space-y-1">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Loan Principal (1011)</h4>
          <h2 className="text-2xl font-black text-slate-800 font-mono">KES {finance.currentLoan.toLocaleString()}</h2>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            Disbursed: {finance.loanDisbursed.toLocaleString()} &nbsp;·&nbsp; Repaid: {finance.loanPaid.toLocaleString()}
          </p>
        </div>

        <div className={`bg-white border border-slate-100 rounded-3xl p-5 border-l-4 shadow-sm space-y-1 ${finance.outstandingInterest > 0 ? "border-orange-500" : "border-emerald-500"}`}>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Interest Outstanding (1020)</h4>
          <h2 className={`text-2xl font-black font-mono ${finance.outstandingInterest > 0 ? "text-orange-600" : "text-slate-800"}`}>
            KES {finance.outstandingInterest.toLocaleString()}
          </h2>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            Charged: {finance.interestCharged.toLocaleString()} &nbsp;·&nbsp; Paid: {finance.interestPaid.toLocaleString()}
          </p>
        </div>

        <div className={`bg-white border border-slate-100 rounded-3xl p-5 border-l-4 shadow-sm space-y-1 ${finance.daysInArrears > 0 ? "border-rose-600 bg-rose-50/30" : "border-emerald-600"}`}>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Arrears Status</h4>
          <h2 className={`text-2xl font-black font-mono ${finance.daysInArrears > 0 ? "text-rose-700 animate-pulse" : "text-slate-800"}`}>
            {finance.arrearsClass}
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {finance.daysInArrears} Days &nbsp;·&nbsp; Risk: <span className="text-slate-700">{finance.riskRating}</span>
          </p>
        </div>
      </div>

      {/* TOTAL OWED BANNER */}
      {finance.totalOutstanding > 0 && (
        <div className="bg-slate-800 text-white rounded-2xl px-5 py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Total Amount Owed (Principal + Interest)</div>
          <div className="text-xl font-black font-mono">KES {finance.totalOutstanding.toLocaleString()}</div>
          {finance.hasExistingLoan && (
            <div className={`text-[10px] font-bold uppercase px-3 py-1 rounded-full ${finance.canRefinance ? "bg-blue-500 text-white" : "bg-rose-500 text-white"}`}>
              {finance.canRefinance
                ? `♻ Refinance Eligible — ${finance.repaidPercent.toFixed(1)}% repaid`
                : `🔒 Refinance Blocked — ${finance.repaidPercent.toFixed(1)}% repaid (need 50%)`}
            </div>
          )}
        </div>
      )}

      {/* ACTION BUTTONS */}
      <div className="flex flex-wrap gap-3 pt-1">
        <button className="bg-green-800 hover:bg-green-900 font-bold text-xs tracking-tight rounded-xl px-5 py-3 transition text-white shadow-sm cursor-pointer"
          onClick={() => { setShowApply(true); setShowStatement(false); }}>
          Apply for Loan
        </button>
        <button className="bg-slate-800 hover:bg-slate-900 font-bold text-xs tracking-tight rounded-xl px-5 py-3 transition text-white shadow-sm cursor-pointer"
          onClick={() => { setShowStatement(true); setShowApply(false); }}>
          View Statement
        </button>
        <button className="bg-white border border-slate-200 text-slate-500 font-bold text-xs tracking-tight rounded-xl px-5 py-3 transition shadow-sm cursor-not-allowed relative group" disabled
          title="Open the Apply form, fill in loan details, then use the Download button inside">
          Download Agreement PDF
          <span className="absolute -top-10 left-0 w-72 bg-slate-800 text-white text-[10px] rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition pointer-events-none z-20">
            Fill the Apply form first, then click ⬇ Download Agreement PDF inside the form
          </span>
        </button>
      </div>

      {/* ── APPLY MODAL ─────────────────────────────────────────────────────── */}
      {showApply && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto">

            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 rounded-t-3xl z-10">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Umova SACCO — Credit Application</h3>
                  <p className="text-[11px] text-slate-400 font-medium mt-0.5">All parameters validated live against SASRA rules</p>
                </div>
                <button className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer leading-none"
                  onClick={() => setShowApply(false)}>✕</button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">

              {/* Refinance Notice */}
              {finance.hasExistingLoan && (
                <div className={`rounded-2xl px-4 py-3 border text-xs font-semibold flex items-start gap-3 ${finance.canRefinance ? "bg-blue-50 border-blue-200 text-blue-900" : "bg-rose-50 border-rose-200 text-rose-900"}`}>
                  <span className="text-lg leading-none mt-0.5">{finance.canRefinance ? "♻️" : "🔒"}</span>
                  <div>
                    <div className="font-black uppercase text-[10px] tracking-wider mb-0.5">
                      {finance.canRefinance ? "Refinance Eligible" : "Refinance Blocked"}
                    </div>
                    <div>{finance.canRefinance
                      ? `${finance.repaidPercent.toFixed(1)}% of existing loan repaid — refinance is permitted.`
                      : `Only ${finance.repaidPercent.toFixed(1)}% repaid. You must repay at least 50% before applying again.`}
                    </div>
                    <div className="text-[10px] mt-1 opacity-70">
                      Balance: KES {finance.currentLoan.toLocaleString()} &nbsp;·&nbsp;
                      Repaid: KES {finance.loanPaid.toLocaleString()} of KES {finance.loanDisbursed.toLocaleString()}
                    </div>
                  </div>
                </div>
              )}

              {/* Form Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Loan Product</label>
                  <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-700"
                    name="loan_type" value={form.loan_type} onChange={handleInputChange}>
                    <option value="">— Select Product —</option>
                    {Object.entries(finance.products).map(([name, p]) => (
                      <option key={name} value={name}>
                        {name} — {p.rate}% / max {p.maxDuration}mo / KES {Math.round(p.maxAmount).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Amount (KES)</label>
                  <input className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-700"
                    type="number" name="amount" placeholder="e.g. 50000" value={form.amount} onChange={handleInputChange} />
                  {prod && reqAmt > 0 && (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Max: KES {Math.round(prod.maxAmount).toLocaleString()}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Duration (Months)</label>
                  <input className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-700"
                    type="number" name="duration" placeholder="e.g. 12" value={form.duration} onChange={handleInputChange} />
                  {prod && <p className="text-[10px] text-slate-400 mt-0.5">Max: {prod.maxDuration} months</p>}
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Net Monthly Income (KES)</label>
                  <input className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-700"
                    type="number" name="net_income" placeholder="Verified net pay" value={form.net_income} onChange={handleInputChange} />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Security / Collateral Type</label>
                  <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-700"
                    name="security_type" value={form.security_type} onChange={handleInputChange}>
                    <option value="">— Select —</option>
                    <option value="Deposits">Internal Savings (A/C 1018)</option>
                    <option value="Guarantor">Registered Member Guarantor</option>
                    <option value="Logbook">Motor Vehicle Logbook</option>
                    <option value="Title Deed">Title Deed</option>
                  </select>
                </div>

                {form.security_type === "Guarantor" ? (
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Primary Guarantor</label>
                    <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-700"
                      name="guarantor_1_no" value={form.guarantor_1_no} onChange={handleInputChange}>
                      <option value="">— Select Guarantor —</option>
                      {allMembers.filter((m) => m.member_no !== memberNo).map((m) => (
                        <option key={m.member_no} value={m.member_no}>{m.name} ({m.member_no})</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Collateral Market Value (KES)</label>
                    <input className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-700 disabled:opacity-40"
                      type="number" name="security_value" placeholder="Appraised value"
                      value={form.security_value} onChange={handleInputChange}
                      disabled={form.security_type === "Deposits"} />
                  </div>
                )}
              </div>

              {/* Secondary Guarantor */}
              {form.security_type === "Guarantor" && (
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Secondary Guarantor (Optional)</label>
                  <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-700"
                    name="guarantor_2_no" value={form.guarantor_2_no} onChange={handleInputChange}>
                    <option value="">— Optional —</option>
                    {allMembers.filter((m) => m.member_no !== memberNo && m.member_no !== form.guarantor_1_no).map((m) => (
                      <option key={m.member_no} value={m.member_no}>{m.name} ({m.member_no})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Purpose */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Loan Purpose</label>
                <textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-700"
                  name="purpose" rows="2" placeholder="Describe the intended use of funds..."
                  value={form.purpose} onChange={handleInputChange} />
              </div>

              {/* File Upload */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">
                  Supporting Documents (ID, Payslip, Bank Statement)
                </label>
                <input type="file" multiple onChange={(e) => setFiles([...e.target.files])}
                  className="w-full text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-2 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-green-800 file:text-white cursor-pointer" />
                {files.length > 0 && (
                  <p className="text-[10px] text-slate-400 mt-1">{files.length} file(s): {Array.from(files).map((f) => f.name).join(", ")}</p>
                )}
              </div>

              {/* Live Compliance Panel */}
              {prod && (
                <div className={`rounded-2xl border p-4 space-y-3 text-xs ${finance.isEligible ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
                  <div className="flex justify-between items-center border-b border-current/10 pb-2">
                    <span className="font-black uppercase text-[10px] tracking-wider text-slate-700">SASRA Compliance Engine</span>
                    <span className={`font-black text-[10px] uppercase tracking-wider ${finance.isEligible ? "text-emerald-700" : "text-rose-700 animate-pulse"}`}>
                      {finance.isEligible ? "✓ APPROVED" : "✗ REJECTED"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-[11px] text-slate-700">
                    <div>Principal: <strong>KES {reqAmt.toLocaleString()}</strong></div>
                    <div>Total Interest (reducing bal, {prod.rate}%/yr): <strong>KES {Math.round(finance.totalInterest).toLocaleString()}</strong></div>
                    <div>Insurance ({prod.insRate || 0}%): <strong>KES {Math.round(finance.insuranceFee).toLocaleString()}</strong></div>
                    <div>Tx Charge: <strong>KES {finance.txCharge.toLocaleString()}</strong></div>
                    <div>Net Disbursed: <strong className="text-emerald-700">KES {finance.netDisbursable.toLocaleString()}</strong></div>
                    <div>Total Repayable: <strong>KES {finance.totalRepayable.toLocaleString()}</strong></div>
                    <div>Monthly Instalment: <strong>KES {Math.round(finance.monthlyInstallment).toLocaleString()}/mo</strong></div>
                    <div>1/3 DSR Ceiling: <strong className={finance.isDsrValid ? "" : "text-rose-600"}>KES {Math.round(finance.dsrCeiling).toLocaleString()}/mo</strong></div>
                    <div>Max Cap: <strong>KES {Math.round(prod.maxAmount).toLocaleString()}</strong></div>
                    <div>Max Duration: <strong>{prod.maxDuration} months</strong></div>
                  </div>
                  <div className="text-[10px] text-slate-500 bg-slate-100 rounded-lg px-3 py-1.5 font-medium">
                    Tx charge tiers: ≤500=KES10 | 501–1K=KES15 | 1K–5K=KES25 | 5K–10K=KES35 | &gt;10K=KES100
                  </div>
                  <div className={`text-[11px] font-bold pt-1 border-t border-current/10 ${finance.isEligible ? "text-emerald-800" : "text-rose-800"}`}>
                    Verdict: {finance.complianceRemark}
                  </div>
                </div>
              )}

              {/* Live Reducing Balance Mini-Schedule */}
              {finance.schedule.length > 0 && finance.isEligible && (
                <div className="space-y-2">
                  <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Repayment Schedule — Reducing Balance ({finance.schedule.length} months)
                  </h4>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="max-h-52 overflow-y-auto">
                      <table className="min-w-full text-[10px] font-mono">
                        <thead className="bg-green-800 text-white sticky top-0">
                          <tr>
                            {["Month","Principal","Interest","Insurance","Instalment","Balance"].map(h => (
                              <th key={h} className="px-2 py-1.5 text-right first:text-left font-bold tracking-wide">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {finance.schedule.map((r) => (
                            <tr key={r.month} className={`${r.month % 2 === 0 ? "bg-slate-50" : "bg-white"} hover:bg-emerald-50/40`}>
                              <td className="px-2 py-1.5 font-bold text-slate-600">Month {r.month}</td>
                              <td className="px-2 py-1.5 text-right text-slate-700">{r.principal.toLocaleString()}</td>
                              <td className="px-2 py-1.5 text-right text-orange-600 font-semibold">{r.interest.toLocaleString()}</td>
                              <td className="px-2 py-1.5 text-right text-slate-500">{r.insurance.toLocaleString()}</td>
                              <td className="px-2 py-1.5 text-right font-bold text-slate-800">{r.total.toLocaleString()}</td>
                              <td className="px-2 py-1.5 text-right text-emerald-700 font-semibold">{r.balance.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-slate-800 text-white text-[10px] font-black">
                          <tr>
                            <td className="px-2 py-2">TOTAL</td>
                            <td className="px-2 py-2 text-right">
                              {finance.schedule.reduce((s,r)=>s+r.principal,0).toLocaleString()}
                            </td>
                            <td className="px-2 py-2 text-right text-orange-300">
                              {Math.round(finance.totalInterest).toLocaleString()}
                            </td>
                            <td className="px-2 py-2 text-right">
                              {Math.round(finance.insuranceFee).toLocaleString()}
                            </td>
                            <td className="px-2 py-2 text-right">
                              {Math.round(finance.totalRepayable).toLocaleString()}
                            </td>
                            <td className="px-2 py-2 text-right">0</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium">
                    Interest computed on reducing balance at {finance.currentProduct?.rate}% per month on outstanding balance.
                  </p>
                </div>
              )}

              {/* Step Hint */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[10px] font-semibold text-amber-800 flex items-center gap-2">
                <span>💡</span>
                <span>
                  <strong>Step 1:</strong> Fill all fields above &nbsp;→&nbsp;
                  <strong>Step 2:</strong> Download the PDF agreement below &nbsp;→&nbsp;
                  <strong>Step 3:</strong> Submit the application.
                </span>
              </div>

              {/* Download Button */}
              <button
                className="w-full py-3.5 rounded-xl font-black text-xs tracking-widest uppercase bg-slate-800 hover:bg-slate-700 text-white transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40"
                disabled={loading || !form.loan_type || !form.amount}
                onClick={downloadOfficialLoanForm}
              >
                <span className="text-base">⬇</span>
                Download Loan Agreement PDF
                {form.loan_type && form.amount
                  ? ` — KES ${Number(form.amount).toLocaleString()} ${form.loan_type}`
                  : " (select product & amount first)"}
              </button>

              {/* Submit / Cancel */}
              <div className="flex justify-between items-center pt-1 border-t border-slate-100">
                <button className="px-5 py-2.5 rounded-xl font-bold text-xs bg-slate-100 text-slate-600 hover:bg-slate-200 transition cursor-pointer"
                  disabled={loading} onClick={() => setShowApply(false)}>Cancel</button>
                <button
                  className="px-7 py-2.5 rounded-xl font-bold text-xs bg-green-900 text-white hover:bg-green-800 shadow-sm transition disabled:opacity-40 cursor-pointer"
                  disabled={loading || !finance.isEligible}
                  onClick={executeLoanApplication}>
                  {loading ? "Submitting…" : "✓ Submit Application"}
                </button>
              </div>

            </div>{/* end px-6 */}
          </div>
        </div>
      )}

      {/* ── STATEMENT MODAL ──────────────────────────────────────────────────── */}
      {showStatement && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-5xl bg-white border border-slate-200 rounded-3xl shadow-2xl max-h-[92vh] flex flex-col">

            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 rounded-t-3xl flex justify-between items-start">
              <div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Loan & Interest Statement</h3>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">Accounts 1011 (Principal) · 1020 (Interest) — {member?.name || memberNo}</p>
              </div>
              <div className="flex items-center gap-3">
                <button className="px-4 py-2 rounded-xl text-xs font-bold bg-green-800 text-white hover:bg-green-700 cursor-pointer transition"
                  onClick={downloadStatement}>⬇ Export PDF</button>
                <button className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer leading-none"
                  onClick={() => setShowStatement(false)}>✕</button>
              </div>
            </div>

            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-px bg-slate-100 text-center text-xs">
              {[
                ["Principal Outstanding", `KES ${finance.currentLoan.toLocaleString()}`, finance.currentLoan > 0 ? "text-rose-600" : "text-emerald-700"],
                ["Interest Outstanding",  `KES ${finance.outstandingInterest.toLocaleString()}`, finance.outstandingInterest > 0 ? "text-orange-600" : "text-emerald-700"],
                ["Total Owed",            `KES ${finance.totalOutstanding.toLocaleString()}`, finance.totalOutstanding > 0 ? "text-slate-800" : "text-emerald-700"],
              ].map(([label, val, cls]) => (
                <div key={label} className="bg-white py-3 px-4">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
                  <div className={`text-lg font-black font-mono ${cls}`}>{val}</div>
                </div>
              ))}
            </div>

            <div className="overflow-y-auto flex-1">
              <table className="min-w-full divide-y divide-slate-100 text-xs text-left">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {["Date", "Receipt No", "Description", "Type", "Amount (KES)"].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {statementRows.length === 0 ? (
                    <tr><td colSpan="5" className="px-4 py-10 text-center text-slate-400 font-semibold">No loan or interest transactions found.</td></tr>
                  ) : statementRows.map((t, i) => {
                    const badge = getTxBadge(t);
                    return (
                      <tr key={i} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {new Date(t.transaction_date || t.created_at).toLocaleDateString("en-GB")}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-400 text-[10px]">{t.receipt_no || "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{t.description || t.type || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold border ${badge.cls}`}>{badge.label}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold font-mono text-slate-800">
                          {Number(t.amount).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {statementRows.length > 0 && (
                  <tfoot className="bg-slate-800 text-white text-[10px] font-black uppercase tracking-wide">
                    <tr>
                      <td className="px-4 py-3" colSpan="3">Closing Balances</td>
                      <td className="px-4 py-3">Principal / Interest</td>
                      <td className="px-4 py-3 text-right">
                        <div>KES {finance.currentLoan.toLocaleString()}</div>
                        <div className={finance.outstandingInterest > 0 ? "text-orange-300" : ""}>KES {finance.outstandingInterest.toLocaleString()}</div>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}