// src/services/receiptService.js

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import logo from "../asset/logo/umovalogo.png";

/* =====================================================
   ACCOUNT LABELS
===================================================== */

const ACCOUNTS = {
  1018: "Savings",
  1012: "Shares",
  1011: "Loan Repayment",
  1020: "Loan Interest",
  1001: "Fees",
};

/* =====================================================
   MONEY FORMAT
===================================================== */

const money = (value) => {

  return Number(value || 0)
    .toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
};

/* =====================================================
   NUMBER TO WORDS
===================================================== */

const ones = [
  "",
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "TEN",
  "ELEVEN",
  "TWELVE",
  "THIRTEEN",
  "FOURTEEN",
  "FIFTEEN",
  "SIXTEEN",
  "SEVENTEEN",
  "EIGHTEEN",
  "NINETEEN"
];

const tens = [
  "",
  "",
  "TWENTY",
  "THIRTY",
  "FORTY",
  "FIFTY",
  "SIXTY",
  "SEVENTY",
  "EIGHTY",
  "NINETY"
];

const convertHundreds = (num) => {

  let str = "";

  if (num > 99) {

    str +=
      ones[Math.floor(num / 100)] +
      " HUNDRED ";

    num %= 100;
  }

  if (num > 19) {

    str +=
      tens[Math.floor(num / 10)] +
      " ";

    num %= 10;
  }

  if (num > 0) {

    str +=
      ones[num] +
      " ";
  }

  return str.trim();
};

const numberToWords = (num) => {

  if (!num || Number(num) === 0) {
    return "ZERO SHILLINGS ONLY";
  }

  num = Math.floor(Number(num));

  let words = "";

  if (num >= 1000000) {

    words +=
      convertHundreds(
        Math.floor(num / 1000000)
      ) +
      " MILLION ";

    num %= 1000000;
  }

  if (num >= 1000) {

    words +=
      convertHundreds(
        Math.floor(num / 1000)
      ) +
      " THOUSAND ";

    num %= 1000;
  }

  if (num > 0) {

    words +=
      convertHundreds(num);
  }

  return (
    words.trim() +
    " SHILLINGS ONLY"
  );
};

/* =====================================================
   GENERATE RECEIPT PDF
===================================================== */

export const generateReceiptPDF = async (
  member,
  trx,
  ledgerLines = []
) => {

  const doc = new jsPDF();

  /* =====================================================
     COLORS
  ===================================================== */

  const green = [0, 102, 51];
  const gold = [212, 175, 55];
  const light = [245, 247, 250];

  /* =====================================================
     HEADER BACKGROUND
  ===================================================== */

  doc.setFillColor(...green);

  doc.rect(
    0,
    0,
    210,
    40,
    "F"
  );

  /* =====================================================
     LOGO
  ===================================================== */

  doc.addImage(
    logo,
    "PNG",
    12,
    7,
    24,
    24
  );

  /* =====================================================
     SACCO HEADER
  ===================================================== */

  doc.setTextColor(255, 255, 255);

  doc.setFontSize(22);

  doc.text(
    "UMOVA SACCO",
    105,
    16,
    {
      align: "center"
    }
  );

  doc.setFontSize(10);

  doc.text(
    "Official SACCO Payment Receipt",
    105,
    24,
    {
      align: "center"
    }
  );

  doc.text(
    "P.O Box 000 - Nairobi | Tel: 0700 000000",
    105,
    31,
    {
      align: "center"
    }
  );

  /* =====================================================
     MEMBER INFO BOX
  ===================================================== */

  let y = 52;

  doc.setFillColor(...light);

  doc.roundedRect(
    10,
    y,
    190,
    40,
    3,
    3,
    "F"
  );

  y += 10;

  doc.setTextColor(0, 0, 0);

  doc.setFontSize(11);

  doc.text(
    `Member Name: ${member?.name || "-"}`,
    15,
    y
  );

  doc.text(
    `Receipt No: ${trx?.receipt_no || "-"}`,
    120,
    y
  );

  y += 8;

  doc.text(
    `Member No: ${member?.member_no || "-"}`,
    15,
    y
  );

  doc.text(
    `Date: ${trx?.date || "-"}`,
    120,
    y
  );

  y += 8;

  doc.text(
    `Phone: ${member?.phone || "-"}`,
    15,
    y
  );

  y += 20;

  /* =====================================================
     RECEIPT TABLE
  ===================================================== */

  let total = 0;

  const rows = [];

  ledgerLines.forEach((line) => {

    const account =
      ACCOUNTS[
        Number(line.credit_account_id)
      ] || "Other";

    const amount =
      Number(line.amount || 0);

    total += amount;

    rows.push([
      account,
      `KES ${money(amount)}`
    ]);
  });

  /* =====================================================
     TABLE
  ===================================================== */

  autoTable(doc, {

    startY: y,

    head: [[
      "Account Allocation",
      "Amount"
    ]],

    body: rows,

    theme: "grid",

    headStyles: {
      fillColor: green,
      textColor: 255,
      fontStyle: "bold"
    },

    alternateRowStyles: {
      fillColor: [248, 248, 248]
    },

    styles: {
      fontSize: 10
    }
  });

  y =
    doc.lastAutoTable.finalY + 15;

  /* =====================================================
     TOTAL BOX
  ===================================================== */

  doc.setFillColor(...gold);

  doc.roundedRect(
    120,
    y,
    70,
    14,
    2,
    2,
    "F"
  );

  doc.setTextColor(255, 255, 255);

  doc.setFontSize(12);

  doc.text(
    `TOTAL: KES ${money(total)}`,
    155,
    y + 9,
    {
      align: "center"
    }
  );

  /* =====================================================
     AMOUNT IN WORDS
  ===================================================== */

  y += 28;

  doc.setTextColor(0, 0, 0);

  doc.setDrawColor(180);

  doc.roundedRect(
    12,
    y - 6,
    185,
    18,
    2,
    2
  );

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.setFontSize(10);

  doc.text(
    "Amount In Words:",
    15,
    y
  );

  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.text(
    numberToWords(total),
    15,
    y + 8
  );

  /* =====================================================
     SIGNATURE SECTION
  ===================================================== */

  y += 35;

  doc.line(
    20,
    y,
    80,
    y
  );

  doc.line(
    120,
    y,
    180,
    y
  );

  doc.setFontSize(9);

  doc.text(
    "Authorized By",
    35,
    y + 6
  );

  doc.text(
    "Member Signature",
    135,
    y + 6
  );

  /* =====================================================
     FOOTER LINE
  ===================================================== */

  doc.setDrawColor(...green);

  doc.line(
    10,
    275,
    200,
    275
  );

  /* =====================================================
     FOOTER TEXT
  ===================================================== */

  doc.setTextColor(100);

  doc.setFontSize(9);

  doc.text(
    "Thank you for supporting UMOVA SACCO.",
    105,
    282,
    {
      align: "center"
    }
  );

  doc.text(
    "This is a computer generated receipt.",
    105,
    288,
    {
      align: "center"
    }
  );

  /* =====================================================
     RETURN PDF BLOB
  ===================================================== */

  return doc.output("blob");
};