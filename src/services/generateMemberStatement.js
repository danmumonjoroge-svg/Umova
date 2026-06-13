// src/services/generateMemberStatement.js

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import logo from "../asset/logo/umovalogo.png";

/* =====================================================
   MONEY FORMAT
===================================================== */

const money = (v) => {

  return Number(v || 0)
    .toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
};

/* =====================================================
   ACCOUNT GROUPS
===================================================== */

const ACCOUNT_GROUPS = {
  savings: [1018],
  shares: [1012],
  loans: [1011, 1020]
};

/* =====================================================
   ACCOUNT TITLES
===================================================== */

const TITLES = {
  savings: "Savings Account",
  shares: "Shares Account",
  loans: "Loan Account"
};

/* =====================================================
   GENERATE MEMBER STATEMENT
===================================================== */

export const generateMemberStatement = async (
  member,
  ledger = []
) => {

  const doc = new jsPDF();

  /* =====================================================
     COLORS
  ===================================================== */

  const green = [0, 102, 51];
  const gold = [212, 175, 55];
  const light = [248, 248, 248];

  /* =====================================================
     SORT LEDGER
  ===================================================== */

  ledger.sort((a, b) => {

    return (
      new Date(a.date) -
      new Date(b.date)
    );
  });

  /* =====================================================
     HEADER
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
     TITLE
  ===================================================== */

  doc.setTextColor(255, 255, 255);

  doc.setFontSize(22);

  doc.text(
    "Umova investment ltd",
    105,
    16,
    {
      align: "center"
    }
  );

  doc.setFontSize(11);

  doc.text(
    "Member Statement",
    105,
    26,
    {
      align: "center"
    }
  );

  doc.text(
    "umova Statementn",
    105,
    33,
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
    30,
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
    `Member No: ${member?.member_no || "-"}`,
    120,
    y
  );

  y += 8;

  doc.text(
    `Phone: ${member?.phone || "-"}`,
    15,
    y
  );

  doc.text(
    `Generated: ${new Date()
      .toLocaleDateString()}`,
    120,
    y
  );

  y += 18;

  /* =====================================================
     ACCOUNT TABLES
  ===================================================== */

  Object.entries(ACCOUNT_GROUPS)
    .forEach(([group, codes]) => {

      /* =====================================================
         FILTER ROWS
      ===================================================== */

      const rows = ledger.filter((r) => {

        const credit =
          Number(r.credit_account_id);

        const debit =
          Number(r.debit_account_id);

        return (
          codes.includes(credit) ||
          codes.includes(debit)
        );
      });

      if (rows.length === 0) return;

      /* =====================================================
         PAGE BREAK
      ===================================================== */

      if (y > 220) {

        doc.addPage();

        y = 20;
      }

      /* =====================================================
         ACCOUNT TITLE
      ===================================================== */

      doc.setFillColor(...gold);

      doc.rect(
        14,
        y,
        182,
        8,
        "F"
      );

      doc.setTextColor(255, 255, 255);

      doc.setFontSize(12);

      doc.text(
        TITLES[group],
        16,
        y + 5.5
      );

      y += 12;

      /* =====================================================
         RUNNING BALANCE
      ===================================================== */

      let running = 0;

      /* =====================================================
         BODY
      ===================================================== */

      const body = rows.map((r) => {

        const amount =
          Number(r.amount || 0);

        const credit =
          Number(r.credit_account_id);

        const debit =
          Number(r.debit_account_id);

        let type = "";

        let debitAmount = "";
        let creditAmount = "";

        /* =====================================================
           TYPE
        ===================================================== */

        if (
          credit === 1011 ||
          debit === 1011
        ) {
          type = "Loan Account";
        }

        if (
          credit === 1020 ||
          debit === 1020
        ) {
          type = "Loan Interest";
        }

        if (
          credit === 1018 ||
          debit === 1018
        ) {
          type = "Savings";
        }

        if (
          credit === 1012 ||
          debit === 1012
        ) {
          type = "Shares";
        }

        /* =====================================================
           LOAN LOGIC
        ===================================================== */

        if (group === "loans") {

          /*
            DISBURSEMENT
            increases balance
          */

          if (
            debit === 1011 ||
            debit === 1020
          ) {

            debitAmount =
              money(amount);

            running += amount;

          } else {

            /*
              REPAYMENT
              reduces balance
            */

            creditAmount =
              money(amount);

            running -= amount;
          }

        } else {

          /*
            SAVINGS / SHARES
          */

          if (
            debit === 1018 ||
            debit === 1012
          ) {

            debitAmount =
              money(amount);

            running -= amount;

          } else {

            creditAmount =
              money(amount);

            running += amount;
          }
        }

        return [
          r.date || "",
          r.receipt_no || "",
          type,
          r.description || "",
          debitAmount,
          creditAmount,
          money(running)
        ];
      });

      /* =====================================================
         TABLE
      ===================================================== */

      autoTable(doc, {

        startY: y,

        head: [[
          "Date",
          "Receipt",
          "Type",
          "Description",
          "Debit",
          "Credit",
          "Balance"
        ]],

        body,

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
          fontSize: 8
        },

        columnStyles: {
          4: {
            halign: "right"
          },
          5: {
            halign: "right"
          },
          6: {
            halign: "right"
          }
        },

        margin: {
          left: 14,
          right: 14
        }
      });

      y =
        doc.lastAutoTable.finalY + 10;

      /* =====================================================
         CLOSING BALANCE BOX
      ===================================================== */

      doc.setFillColor(...light);

      doc.roundedRect(
        120,
        y,
        70,
        10,
        2,
        2,
        "F"
      );

      doc.setTextColor(...green);

      doc.setFontSize(10);

      doc.text(
        `Closing Balance: KES ${money(running)}`,
        155,
        y + 6,
        {
          align: "center"
        }
      );

      y += 18;
    });

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
     FOOTER
  ===================================================== */

  doc.setTextColor(100);

  doc.setFontSize(9);

  doc.text(
    "Engineered for properity|Rooted in Faith|Drivenby Inovation.United for a New Era",
    105,
    282,
    {
      align: "center"
    }
  );

  doc.text(
    "Email:umovainvestment@GiMail.com|Tel:+254794960505|nairobi,Kenya.",
    105,
    288,
    {
      align: "center"
    }
  );

  /* =====================================================
     RETURN PDF
  ===================================================== */

  return doc.output("blob");
};