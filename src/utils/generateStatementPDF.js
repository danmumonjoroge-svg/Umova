import jsPDF from "jspdf";
import logo from "../asset/logo/umovalogo.png";

const ACC = {
  SAVINGS: 1018,
  SHARES: 1012,
  LOANS: 1011,

  // interest control accounts
  LOAN_INTEREST: 1020,
  INTEREST_INCOME: 1005,
  CASH_BOOK: 1007,
  SAVINGS_INTEREST: 1006,
};

const n = (v) => Number(v || 0);

const format = (v) =>
  n(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const generateStatementPDF = (member, ledger = []) => {
  const doc = new jsPDF();

  let y = 20;
  let page = 1;

  const PAGE_BOTTOM = 275;
  const ROW_HEIGHT = 6;

  const COLORS = {
    primary: [0, 102, 51],
    savings: [22, 163, 74],
    loans: [220, 38, 38],
    shares: [37, 99, 235],
    gray: [120, 120, 120],
  };

  // ================= HEADER =================
  const drawHeader = () => {
    doc.setFillColor(...COLORS.primary);
    doc.rect(0, 0, 210, 28, "F");

    if (logo) doc.addImage(logo, "PNG", 10, 5, 18, 18);

    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");

    doc.setFontSize(13);
    doc.text("UMOVA SACCO", 32, 12);

    doc.setFontSize(9);
    doc.text("OFFICIAL MEMBER STATEMENT", 32, 18);

    doc.setFontSize(8);
    doc.text(`Member: ${member?.member_no || "-"}`, 150, 12);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 150, 18);

    y = 35;
  };

  const drawFooter = () => {
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.gray);
    doc.text(`Page ${page}`, 200, 285, { align: "right" });
  };

  const newPage = () => {
    drawFooter();
    doc.addPage();
    page++;
    drawHeader();
    drawMemberInfo();
  };

  const checkPage = (space) => {
    if (y + space > PAGE_BOTTOM) newPage();
  };

  // ================= MEMBER INFO =================
  const drawMemberInfo = () => {
    checkPage(12);

    doc.setTextColor(0);
    doc.setFontSize(9);

    doc.text(`Name: ${member?.name || "-"}`, 14, y);
    doc.text(`Member No: ${member?.member_no || "-"}`, 110, y);

    y += 5;

    doc.text(`Phone: ${member?.phone || "-"}`, 14, y);
    doc.text(`ID: ${member?.national_id || "-"}`, 110, y);

    y += 8;
  };

  drawHeader();
  drawMemberInfo();

  // ================= SUMMARY =================
  let savingsBal = 0;
  let sharesBal = 0;
  let loanBal = 0;

  ledger.forEach((t) => {
    const amt = n(t.amount);

    // SAVINGS
    if (Number(t.credit_account_id) === ACC.SAVINGS) savingsBal += amt;
    if (Number(t.debit_account_id) === ACC.SAVINGS) savingsBal -= amt;

    // SAVINGS INTEREST
    if (Number(t.credit_account_id) === ACC.SAVINGS_INTEREST)
      savingsBal += amt;

    if (Number(t.debit_account_id) === ACC.SAVINGS_INTEREST)
      savingsBal -= amt;

    // SHARES
    if (Number(t.credit_account_id) === ACC.SHARES) sharesBal += amt;
    if (Number(t.debit_account_id) === ACC.SHARES) sharesBal -= amt;

    // LOANS PRINCIPAL
    if (Number(t.debit_account_id) === ACC.LOANS) loanBal += amt;
    if (Number(t.credit_account_id) === ACC.LOANS) loanBal -= amt;

    // ================= FIXED INTEREST FLOW =================

    // Interest charged: Dr 1020 / Cr 1005 (income)
    if (Number(t.debit_account_id) === ACC.LOAN_INTEREST) {
      loanBal += amt;
    }

    // Interest income is NOT part of loan balance
    if (Number(t.credit_account_id) === ACC.INTEREST_INCOME) {
      // ignore in loan balance (income account)
    }

    // Interest repayment: Dr 1007 / Cr 1020
    if (Number(t.credit_account_id) === ACC.LOAN_INTEREST) {
      loanBal -= amt;
    }
  });

  loanBal = Math.abs(loanBal);

  // ================= SUMMARY BOX =================
  const drawSummary = () => {
    checkPage(30);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("ACCOUNT SUMMARY", 14, y);

    y += 6;

    doc.setDrawColor(...COLORS.primary);
    doc.rect(10, y, 190, 24);

    doc.setFont("helvetica", "normal");

    doc.text("Savings", 14, y + 8);
    doc.text(format(savingsBal), 90, y + 8, { align: "right" });

    doc.text("Loans", 110, y + 8);
    doc.text(format(loanBal), 190, y + 8, { align: "right" });

    doc.text("Shares", 14, y + 18);
    doc.text(format(sharesBal), 90, y + 18, { align: "right" });

    y += 30;
  };

  drawSummary();

  // ================= TABLE HEADER =================
  const drawTableHeader = (title, color) => {
    checkPage(14);

    doc.setFillColor(...color);
    doc.rect(10, y, 190, 8, "F");

    doc.setTextColor(255);
    doc.setFontSize(9);
    doc.text(title, 14, y + 6);

    y += 10;

    doc.setTextColor(0);
    doc.setFontSize(8);

    doc.text("DATE", 14, y);
    doc.text("DESCRIPTION", 45, y);
    doc.text("DEBIT", 120, y, { align: "right" });
    doc.text("CREDIT", 150, y, { align: "right" });
    doc.text("BALANCE", 190, y, { align: "right" });

    y += 4;
    doc.line(10, y, 200, y);
    y += 4;
  };

  // ================= ACCOUNT ENGINE =================
  const renderAccount = (title, acc, color) => {
    const rows = ledger
      .filter(
        (t) =>
          Number(t.debit_account_id) === acc ||
          Number(t.credit_account_id) === acc ||
          (acc === ACC.LOANS &&
            Number(t.debit_account_id) === ACC.LOAN_INTEREST) ||
          (acc === ACC.LOANS &&
            Number(t.credit_account_id) === ACC.LOAN_INTEREST) ||
          (acc === ACC.SAVINGS &&
            Number(t.credit_account_id) === ACC.SAVINGS_INTEREST)
      )
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!rows.length) return;

    let balance = 0;
    let index = 0;

    while (index < rows.length) {
      drawTableHeader(
        index === 0 ? title : `${title} (continued)`,
        color
      );

      while (index < rows.length) {
        checkPage(ROW_HEIGHT);

        const t = rows[index];
        const amt = n(t.amount);

        let debit = "-";
        let credit = "-";

        // ================= LOANS =================
        if (acc === ACC.LOANS) {
          if (Number(t.debit_account_id) === ACC.LOANS) {
            balance += amt;
            debit = format(amt);
          }

          if (Number(t.credit_account_id) === ACC.LOANS) {
            balance -= amt;
            credit = format(amt);
          }

          // INTEREST charged (1020 → income 1005)
          if (Number(t.debit_account_id) === ACC.LOAN_INTEREST) {
            balance += amt;
            debit = `INT ${format(amt)}`;
          }

          // INTEREST repayment (1007 → 1020)
          if (Number(t.credit_account_id) === ACC.LOAN_INTEREST) {
            balance -= amt;
            credit = `INT REP ${format(amt)}`;
          }
        }

        // ================= SAVINGS =================
        if (acc === ACC.SAVINGS) {
          if (Number(t.credit_account_id) === ACC.SAVINGS) {
            balance += amt;
            credit = format(amt);
          }

          if (Number(t.debit_account_id) === ACC.SAVINGS) {
            balance -= amt;
            debit = format(amt);
          }

          if (Number(t.credit_account_id) === ACC.SAVINGS_INTEREST) {
            balance += amt;
            credit = `INT ${format(amt)}`;
          }
        }

        // ================= SHARES =================
        if (acc === ACC.SHARES) {
          if (Number(t.credit_account_id) === ACC.SHARES) {
            balance += amt;
            credit = format(amt);
          }

          if (Number(t.debit_account_id) === ACC.SHARES) {
            balance -= amt;
            debit = format(amt);
          }
        }

        doc.text(String(t.date || ""), 14, y);
        doc.text(String(t.description || "-"), 45, y);

        doc.text(debit, 120, y, { align: "right" });
        doc.text(credit, 150, y, { align: "right" });

        doc.text(format(Math.abs(balance)), 190, y, {
          align: "right",
        });

        y += ROW_HEIGHT;
        index++;

        if (y + ROW_HEIGHT > PAGE_BOTTOM) {
          newPage();
          break;
        }
      }
    }

    doc.setDrawColor(...color);
    doc.line(10, y, 200, y);

    y += 6;

    doc.setFont("helvetica", "bold");
    doc.text("TOTAL BALANCE", 14, y);
    doc.text(format(Math.abs(balance)), 190, y, {
      align: "right",
    });

    y += 12;
  };

  renderAccount("SAVINGS ACCOUNT", ACC.SAVINGS, COLORS.savings);
  renderAccount("LOAN ACCOUNT", ACC.LOANS, COLORS.loans);
  renderAccount("SHARE CAPITAL ACCOUNT", ACC.SHARES, COLORS.shares);

  drawFooter();

  doc.save(`STATEMENT_${member?.member_no || "UNKNOWN"}.pdf`);
};