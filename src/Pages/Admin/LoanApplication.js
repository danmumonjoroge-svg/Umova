import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logo from "../../asset/logo/umovalogo.png";
import "./LoanApplicationAdmin.css";

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

// ── Reducing balance amortisation ────────────────────────────────────────────
const buildSchedule = (principal, annualRatePct, months, insRatePct) => {
  if (months <= 0 || principal <= 0) {
    return {
      schedule: [],
      monthlyInstalment: 0,
      totalInterest: 0,
      totalInsurance: 0,
      totalRepayable: principal,
    };
  }

  const r = annualRatePct / 100;
  const insPerMonth = (principal * (insRatePct / 100)) / months;

  let monthlyPrincipalAndInterest;
  if (r === 0) {
    monthlyPrincipalAndInterest = principal / months;
  } else {
    monthlyPrincipalAndInterest = (principal * r) / (1 - Math.pow(1 + r, -months));
  }

  const monthlyInstalment = monthlyPrincipalAndInterest + insPerMonth;
  let balance = principal;
  let totalInterestSum = 0;
  const schedule = [];

  for (let m = 1; m <= months; m++) {
    const interestThisMonth = r > 0 ? balance * r : 0;
    const principalThisMonth = monthlyPrincipalAndInterest - interestThisMonth;
    balance = Math.max(0, balance - principalThisMonth);
    totalInterestSum += interestThisMonth;
    schedule.push({
      month: m,
      principal: Math.round(principalThisMonth),
      interest: Math.round(interestThisMonth),
      insurance: Math.round(insPerMonth),
      total: Math.round(monthlyInstalment),
      balance: Math.round(balance),
    });
  }

  const totalInsurance = insPerMonth * months;
  const totalRepayable = principal + totalInterestSum + totalInsurance;

  return {
    schedule,
    monthlyInstalment,
    totalInterest: totalInterestSum,
    totalInsurance,
    totalRepayable,
  };
};

// ── Product definitions ──────────────────────────────────────────────────────
const buildProducts = (savings, multiplier) => ({
  "Instant Loan":       { rate: 10, insRate: 0, maxDuration: 3,  minMonths: 0, maxAmount: Math.min(10000, savings), reqSecurity: false },
  "Salary Advance":     { rate: 10, insRate: 0, maxDuration: 3,  minMonths: 0, maxAmount: 30000,                   reqSecurity: false },
  "Emergency Loan":     { rate: 3,  insRate: 0, maxDuration: 12, minMonths: 1, maxAmount: savings,                 reqSecurity: false },
  "Development Loan":   { rate: 3,  insRate: 2, maxDuration: 36, minMonths: 3, maxAmount: savings * multiplier,    reqSecurity: true  },
  "Business Loan":      { rate: 4,  insRate: 2, maxDuration: 24, minMonths: 3, maxAmount: savings * multiplier,    reqSecurity: true  },
  "School Fees Loan":   { rate: 3,  insRate: 1, maxDuration: 12, minMonths: 3, maxAmount: savings * multiplier,    reqSecurity: false },
  "Asset Finance Loan": { rate: 5,  insRate: 2, maxDuration: 48, minMonths: 6, maxAmount: savings * multiplier,    reqSecurity: true  },
});

export default function LoanApplicationAdmin() {
  // ── State ─────────────────────────────────────────────────────────────────
  const [members, setMembers]   = useState([]);
  const [member, setMember]     = useState(null);
  const [memberNo, setMemberNo] = useState("");
  const [ledger, setLedger]     = useState([]);
  const [allMembers, setAllMembers] = useState([]);

  const [applications, setApplications] = useState([]);
  const [loadingMember, setLoadingMember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles] = useState([]);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const [form, setForm] = useState({
    loan_type: "", amount: "", duration: "", net_income: "",
    purpose: "", security_type: "", security_value: "",
    guarantor_1_no: "", guarantor_2_no: "",
  });

  const handleInputChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  // ── Bootstrap: load member list + pending applications ──────────────────
  useEffect(() => {
    loadStaticData();
  }, []);

  const loadStaticData = async () => {
    const { data: membersData } = await supabase.from("members").select("*");
    setMembers(membersData || []);

    const { data: gm } = await supabase
      .from("members")
      .select("member_no, name, kyc_status, credit_score");
    setAllMembers(gm || []);

    await loadApplications();
  };

  const loadApplications = async () => {
    const { data: loans } = await supabase
      .from("loan_application")
      .select("*")
      .order("created_at", { ascending: false });
    setApplications(loans || []);
  };

  // ── Load selected member's ledger ────────────────────────────────────────
  useEffect(() => {
    if (!memberNo) {
      setMember(null);
      setLedger([]);
      return;
    }

    const load = async () => {
      setLoadingMember(true);

      const memberData = members.find((m) => m.member_no === memberNo);
      setMember(memberData || null);

      const { data: l, error: lErr } = await supabase
        .from("general_ledger")
        .select("*")
        .eq("member_no", memberNo);

      if (lErr) console.error("Ledger fetch error:", lErr);
      setLedger(l || []);

      setLoadingMember(false);
    };

    load();
  }, [memberNo, members]);

  // ── Core Finance Engine (ported from member self-service) ───────────────
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

    const products = buildProducts(savings, multiplier);

    const p          = products[form.loan_type] || null;
    const reqAmount  = Number(form.amount   || 0);
    const reqMonths  = Number(form.duration || 1);
    const netIncome  = Number(form.net_income || 0);
    const txCharge   = calcTxCharge(reqAmount);
    const netDisbursable = Math.max(0, reqAmount - txCharge);

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
    let complianceRemark = "Select a member and fill in all fields to see the eligibility verdict.";

    if (!memberNo) {
      complianceRemark = "Select a member to begin.";
    } else if (p) {
      if (refinanceBlocked)
        complianceRemark = `REJECTED: Existing loan balance outstanding. Only ${repaidPercent.toFixed(1)}% repaid — minimum 50% required before re-applying.`;
      else if (daysInArrears > 0)
        complianceRemark = `REJECTED: Account in ${arrearsClass} arrears (${daysInArrears} days overdue). Regularize before applying.`;
      else if (outstandingInterest > 0)
        complianceRemark = `REJECTED: Unsettled interest of KES ${outstandingInterest.toLocaleString()} must be cleared first.`;
      else if (membershipMonths < p.minMonths)
        complianceRemark = `REJECTED: Minimum membership of ${p.minMonths} months required. Member has ${membershipMonths} months.`;
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
    } else if (memberNo) {
      complianceRemark = "Select a loan product to begin compliance check.";
    }

    return {
      savings, loanDisbursed, loanPaid, currentLoan,
      outstandingInterest, totalOutstanding, interestCharged, interestPaid,
      daysInArrears, arrearsClass, membershipMonths,
      score, riskRating, multiplier,
      products,
      currentProduct: p,
      txCharge, totalInterest, insuranceFee, totalRepayable,
      monthlyInstallment, dsrCeiling, netDisbursable,
      isDsrValid, isEligible, complianceRemark,
      hasExistingLoan, canRefinance, refinanceBlocked, repaidPercent,
      schedule: amort.schedule,
    };
  }, [ledger, form, member, memberNo]);

  // ── PDF: Official Loan Agreement (filled in by admin on member's behalf) ──
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
      doc.text(`Date: ${today}   |   Reference: ${refNo}   |   Application Channel: Assisted (Admin)`, 42, 33);
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
        doc.text("No loan parameters entered — fill the application form, then click Download to generate full details.", 14, y);
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
        "(g) This application was completed with the assistance of an Umova Investments staff member on behalf of the applicant, who has reviewed and verbally confirmed the details herein.",
        "(h) I acknowledge this document constitutes a legally binding credit agreement upon signing by all parties below.",
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

  // ── Submit Loan Application (on behalf of member) ────────────────────────
  const executeLoanApplication = async () => {
    try {
      if (!memberNo) return alert("Select a member first.");
      if (!finance.currentProduct) return alert("Select a loan product first.");
      if (!finance.isEligible)     return alert(`Cannot submit: ${finance.complianceRemark}`);

      setSubmitting(true);

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
        name:                member?.name || "",
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
        channel:             "assisted",
      }]);
      if (error) throw error;

      alert("Loan application submitted successfully on behalf of the member.");
      setFiles([]);
      setForm({ loan_type: "", amount: "", duration: "", net_income: "", purpose: "",
                security_type: "", security_value: "", guarantor_1_no: "", guarantor_2_no: "" });

      await loadApplications();
    } catch (err) {
      alert(`Submission failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Approve / Reject ──────────────────────────────────────────────────────
  const approveLoan = async (loan) => {
    try {
      const { data, error } = await supabase
        .from("loan_application")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", loan.id)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Update failed");

      alert("Loan approved successfully");
      await loadApplications();
    } catch (err) {
      alert(err.message);
    }
  };

  const submitReject = async (loan) => {
    try {
      const { data, error } = await supabase
        .from("loan_application")
        .update({
          status: "rejected",
          rejected_at: new Date().toISOString(),
          rejection_reason: rejectReason || null,
        })
        .eq("id", loan.id)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Update failed");

      setRejectingId(null);
      setRejectReason("");
      await loadApplications();
    } catch (err) {
      alert(err.message);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const prod = finance.currentProduct;
  const reqAmt = Number(form.amount || 0);
  const pending = applications.filter((a) => a.status === "pending");

  return (
    <div className="loanAdminPage">

      {/* HEADER */}
      <div className="header">
        <span className="eyebrow">Assisted Application · Ledger 1011 / 1020 / 1018</span>
        <h1>Loan Application — Admin</h1>
        <p>Apply on behalf of a member with no device, then review pending loans.</p>
      </div>

      <div className="layout">

        {/* ================= APPLICATION FORM ================= */}
        <div className="panel formPanel">

          <h2>New Application</h2>

          {/* Member selector */}
          <label className="field">
            <span>Member</span>
            <select
              value={memberNo}
              onChange={(e) => setMemberNo(e.target.value)}
            >
              <option value="">— Select Member —</option>
              {members.map((m) => (
                <option key={m.member_no} value={m.member_no}>
                  {m.member_no} — {m.name}
                </option>
              ))}
            </select>
          </label>

          {loadingMember && <p className="loadingText">Loading member account…</p>}

          {/* Member snapshot */}
          {memberNo && !loadingMember && (
            <div className="memberSnapshot">
              <div className="snapRow">
                <span>Savings (1018)</span>
                <strong>KES {finance.savings.toLocaleString()}</strong>
              </div>
              <div className="snapRow">
                <span>Loan Principal (1011)</span>
                <strong>KES {finance.currentLoan.toLocaleString()}</strong>
              </div>
              <div className="snapRow">
                <span>Interest Outstanding (1020)</span>
                <strong className={finance.outstandingInterest > 0 ? "warn" : ""}>
                  KES {finance.outstandingInterest.toLocaleString()}
                </strong>
              </div>
              <div className="snapRow">
                <span>Arrears</span>
                <strong className={finance.daysInArrears > 0 ? "danger" : "good"}>
                  {finance.arrearsClass} · {finance.daysInArrears}d
                </strong>
              </div>
              <div className="snapRow">
                <span>Credit Score / Risk</span>
                <strong>{finance.score} · {finance.riskRating}</strong>
              </div>
              {finance.hasExistingLoan && (
                <div className={`refinanceNotice ${finance.canRefinance ? "ok" : "blocked"}`}>
                  {finance.canRefinance
                    ? `♻ Refinance eligible — ${finance.repaidPercent.toFixed(1)}% repaid`
                    : `🔒 Refinance blocked — ${finance.repaidPercent.toFixed(1)}% repaid (need 50%)`}
                </div>
              )}
            </div>
          )}

          {/* Loan product form */}
          {memberNo && !loadingMember && (
            <>
              <div className="formGrid">

                <label className="field">
                  <span>Loan Product</span>
                  <select name="loan_type" value={form.loan_type} onChange={handleInputChange}>
                    <option value="">— Select Product —</option>
                    {Object.entries(finance.products).map(([name, p]) => (
                      <option key={name} value={name}>
                        {name} — {p.rate}% / max {p.maxDuration}mo / KES {Math.round(p.maxAmount).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Amount (KES)</span>
                  <input
                    type="number" name="amount" placeholder="e.g. 50000"
                    value={form.amount} onChange={handleInputChange}
                  />
                  {prod && reqAmt > 0 && (
                    <small>Max: KES {Math.round(prod.maxAmount).toLocaleString()}</small>
                  )}
                </label>

                <label className="field">
                  <span>Duration (Months)</span>
                  <input
                    type="number" name="duration" placeholder="e.g. 12"
                    value={form.duration} onChange={handleInputChange}
                  />
                  {prod && <small>Max: {prod.maxDuration} months</small>}
                </label>

                <label className="field">
                  <span>Net Monthly Income (KES)</span>
                  <input
                    type="number" name="net_income" placeholder="Verified net pay"
                    value={form.net_income} onChange={handleInputChange}
                  />
                </label>

                <label className="field">
                  <span>Security / Collateral Type</span>
                  <select name="security_type" value={form.security_type} onChange={handleInputChange}>
                    <option value="">— Select —</option>
                    <option value="Deposits">Internal Savings (A/C 1018)</option>
                    <option value="Guarantor">Registered Member Guarantor</option>
                    <option value="Logbook">Motor Vehicle Logbook</option>
                    <option value="Title Deed">Title Deed</option>
                  </select>
                </label>

                {form.security_type === "Guarantor" ? (
                  <label className="field">
                    <span>Primary Guarantor</span>
                    <select name="guarantor_1_no" value={form.guarantor_1_no} onChange={handleInputChange}>
                      <option value="">— Select Guarantor —</option>
                      {allMembers.filter((m) => m.member_no !== memberNo).map((m) => (
                        <option key={m.member_no} value={m.member_no}>{m.name} ({m.member_no})</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="field">
                    <span>Collateral Market Value (KES)</span>
                    <input
                      type="number" name="security_value" placeholder="Appraised value"
                      value={form.security_value} onChange={handleInputChange}
                      disabled={form.security_type === "Deposits"}
                    />
                  </label>
                )}

              </div>

              {form.security_type === "Guarantor" && (
                <label className="field">
                  <span>Secondary Guarantor (Optional)</span>
                  <select name="guarantor_2_no" value={form.guarantor_2_no} onChange={handleInputChange}>
                    <option value="">— Optional —</option>
                    {allMembers.filter((m) => m.member_no !== memberNo && m.member_no !== form.guarantor_1_no).map((m) => (
                      <option key={m.member_no} value={m.member_no}>{m.name} ({m.member_no})</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="field">
                <span>Loan Purpose</span>
                <textarea
                  name="purpose" rows="2" placeholder="Describe the intended use of funds..."
                  value={form.purpose} onChange={handleInputChange}
                />
              </label>

              <label className="field">
                <span>Supporting Documents (ID, Payslip, Bank Statement)</span>
                <input type="file" multiple onChange={(e) => setFiles([...e.target.files])} />
                {files.length > 0 && (
                  <small>{files.length} file(s): {Array.from(files).map((f) => f.name).join(", ")}</small>
                )}
              </label>

              {/* Compliance panel */}
              {prod && (
                <div className={`compliance ${finance.isEligible ? "ok" : "bad"}`}>
                  <div className="complianceHead">
                    <span>SASRA Compliance Engine</span>
                    <span className="verdict">{finance.isEligible ? "✓ APPROVED" : "✗ REJECTED"}</span>
                  </div>

                  <div className="complianceGrid">
                    <div>Principal: <strong>KES {reqAmt.toLocaleString()}</strong></div>
                    <div>Total Interest (reducing bal, {prod.rate}%/yr): <strong>KES {Math.round(finance.totalInterest).toLocaleString()}</strong></div>
                    <div>Insurance ({prod.insRate || 0}%): <strong>KES {Math.round(finance.insuranceFee).toLocaleString()}</strong></div>
                    <div>Tx Charge: <strong>KES {finance.txCharge.toLocaleString()}</strong></div>
                    <div>Net Disbursed: <strong className="positive">KES {finance.netDisbursable.toLocaleString()}</strong></div>
                    <div>Total Repayable: <strong>KES {finance.totalRepayable.toLocaleString()}</strong></div>
                    <div>Monthly Instalment: <strong>KES {Math.round(finance.monthlyInstallment).toLocaleString()}/mo</strong></div>
                    <div>1/3 DSR Ceiling: <strong className={finance.isDsrValid ? "" : "danger"}>KES {Math.round(finance.dsrCeiling).toLocaleString()}/mo</strong></div>
                    <div>Max Cap: <strong>KES {Math.round(prod.maxAmount).toLocaleString()}</strong></div>
                    <div>Max Duration: <strong>{prod.maxDuration} months</strong></div>
                  </div>

                  <div className="txTiers">
                    Tx charge tiers: ≤500=KES10 | 501–1K=KES15 | 1K–5K=KES25 | 5K–10K=KES35 | &gt;10K=KES100
                  </div>

                  <div className="verdictLine">
                    Verdict: {finance.complianceRemark}
                  </div>
                </div>
              )}

              {/* Repayment schedule preview */}
              {finance.schedule.length > 0 && finance.isEligible && (
                <div className="schedule">
                  <h4>Repayment Schedule — Reducing Balance ({finance.schedule.length} months)</h4>
                  <div className="scheduleTableWrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Principal</th>
                          <th>Interest</th>
                          <th>Insurance</th>
                          <th>Instalment</th>
                          <th>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finance.schedule.map((r) => (
                          <tr key={r.month}>
                            <td className="rowLabel">Month {r.month}</td>
                            <td>{r.principal.toLocaleString()}</td>
                            <td className="interest">{r.interest.toLocaleString()}</td>
                            <td>{r.insurance.toLocaleString()}</td>
                            <td className="bold">{r.total.toLocaleString()}</td>
                            <td className="balance">{r.balance.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>TOTAL</td>
                          <td>{finance.schedule.reduce((s, r) => s + r.principal, 0).toLocaleString()}</td>
                          <td className="interest">{Math.round(finance.totalInterest).toLocaleString()}</td>
                          <td>{Math.round(finance.insuranceFee).toLocaleString()}</td>
                          <td>{Math.round(finance.totalRepayable).toLocaleString()}</td>
                          <td>0</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="scheduleNote">
                    Interest computed on reducing balance at {finance.currentProduct?.rate}% per month on outstanding balance.
                  </p>
                </div>
              )}

              {/* Step hint */}
              <div className="hint">
                💡 <strong>Step 1:</strong> Fill all fields above →
                {" "}<strong>Step 2:</strong> Download the PDF agreement for the member to sign →
                {" "}<strong>Step 3:</strong> Submit the application.
              </div>

              {/* Download PDF */}
              <button
                className="btn btnDark"
                disabled={!form.loan_type || !form.amount}
                onClick={downloadOfficialLoanForm}
              >
                ⬇ Download Loan Agreement PDF
                {form.loan_type && form.amount
                  ? ` — KES ${Number(form.amount).toLocaleString()} ${form.loan_type}`
                  : " (select product & amount first)"}
              </button>

              {/* Submit */}
              <button
                className="btn btnPrimary"
                disabled={submitting || !finance.isEligible}
                onClick={executeLoanApplication}
              >
                {submitting ? "Submitting…" : "✓ Submit Application on Behalf of Member"}
              </button>
            </>
          )}

        </div>

        {/* ================= PENDING APPROVALS ================= */}
        <div className="panel approvalsPanel">

          <h2>
            Pending Approvals
            {pending.length > 0 && <span className="badgeCount">{pending.length}</span>}
          </h2>

          {pending.length === 0 ? (
            <p className="loadingText">No pending loan applications.</p>
          ) : (
            <div className="approvalsList">
              {pending.map((l) => (
                <div key={l.id} className="approvalCard">

                  <div className="approvalTop">
                    <div>
                      <div className="approvalMember">{l.member_no} — {l.name || "—"}</div>
                      <div className="approvalMeta">
                        {l.loan_type} · KES {Number(l.amount).toLocaleString()} · {l.duration} mo
                      </div>
                    </div>
                    {l.channel === "assisted" && (
                      <span className="channelTag">Assisted</span>
                    )}
                  </div>

                  <div className="approvalDetails">
                    <span>Monthly: KES {Math.round(l.monthly_installment || 0).toLocaleString()}</span>
                    <span>Total Repayable: KES {Math.round(l.total_repayable || 0).toLocaleString()}</span>
                    <span>Risk: {l.risk_level || "—"} ({l.risk_score ?? "—"})</span>
                  </div>

                  {l.purpose && <div className="approvalPurpose">"{l.purpose}"</div>}

                  <div className="approvalActions">
                    <button className="btn btnApprove" onClick={() => approveLoan(l)}>
                      Approve
                    </button>
                    <button
                      className="btn btnReject"
                      onClick={() => setRejectingId(rejectingId === l.id ? null : l.id)}
                    >
                      Reject
                    </button>
                  </div>

                  {rejectingId === l.id && (
                    <div className="rejectBox">
                      <textarea
                        rows="2"
                        placeholder="Reason for rejection (optional)"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <div className="rejectActions">
                        <button className="btn btnReject" onClick={() => submitReject(l)}>
                          Confirm Reject
                        </button>
                        <button
                          className="btn btnGhost"
                          onClick={() => { setRejectingId(null); setRejectReason(""); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              ))}
            </div>
          )}

        </div>

      </div>

    </div>
  );
}