import jsPDF from "jspdf";

// ===============================
// HELPERS
// ===============================
const num = (v) => Number(v) || 0;
const str = (v, f = "-") =>
  v === undefined || v === null || v === "" ? f : String(v);

// ===============================
// NUMBER TO WORDS
// ===============================
function numberToWords(num) {
  if (num === 0) return "Zero";

  const a = ["", "One", "Two", "Three", "Four", "Five", "Six",
    "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
    "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"];

  const b = ["", "", "Twenty", "Thirty", "Forty",
    "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const convert = (n) => {
    if (n < 20) return a[n];
    if (n < 100)
      return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    if (n < 1000)
      return a[Math.floor(n / 100)] + " Hundred " + convert(n % 100);
    if (n < 1000000)
      return convert(Math.floor(n / 1000)) + " Thousand " + convert(n % 1000);
    return "Amount Too Large";
  };

  return convert(num) + " Kenya Shillings Only";
}

// ===============================
// LOAD IMAGE → BASE64
// ===============================
async function loadImage(url) {
  const res = await fetch(url);
  const blob = await res.blob();

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// ===============================
// BUILD RECEIPT
// ===============================
function buildReceipt(rows, receiptNo) {
  const group = rows.filter(
    r => (r.reference || r.receipt_no) === receiptNo
  );

  if (!group.length) throw new Error("Receipt not found");

  const total = group.reduce((s, r) => s + num(r.amount), 0);

  return {
    base: group[0],
    total,
    entries: group
  };
}

// ===============================
// MAIN FUNCTION
// ===============================
export async function generateReceiptPDF(
  rows,
  receiptNo,
  logoUrl = null
) {
  try {
    const pdf = new jsPDF("p", "mm", "a4");

    const { base, total, entries } = buildReceipt(rows, receiptNo);

    let y = 15;

    // ================= LOAD LOGO =================
    let logo = null;
    if (logoUrl) {
      try {
        logo = await loadImage(logoUrl);
      } catch {
        console.warn("Logo load failed");
      }
    }

    // ================= HEADER =================
    pdf.setFillColor(15, 81, 50);
    pdf.rect(0, 0, 210, 32, "F");

    if (logo) {
      pdf.addImage(logo, "PNG", 10, 5, 20, 20);
    }

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(16);
    pdf.text("SACCO FINANCIAL RECEIPT", 50, 14);

    pdf.setFontSize(10);
    pdf.text(`Receipt No: ${receiptNo}`, 50, 22);

    pdf.setTextColor(0, 0, 0);

    // ================= WATERMARK =================
    pdf.setTextColor(200, 200, 200);
    pdf.setFontSize(40);
    pdf.text("PAID", 70, 150, { angle: 45 });

    pdf.setTextColor(0, 0, 0);

    y = 45;

    // ================= MEMBER =================
    pdf.setFontSize(11);
    pdf.setFont(undefined, "bold");
    pdf.text("MEMBER DETAILS", 10, y);

    y += 6;
    pdf.line(10, y, 200, y);
    y += 8;

    pdf.setFont(undefined, "normal");
    pdf.text(`Member No: ${base.member_no}`, 10, y);
    pdf.text(`Name: ${base.name}`, 110, y);

    y += 7;
    pdf.text(`Date: ${base.date}`, 10, y);
    pdf.text(`Mode: ${base.mode}`, 110, y);

    y += 12;

    // ================= TOTAL =================
    pdf.setFillColor(230, 245, 235);
    pdf.roundedRect(10, y, 190, 32, 3, 3, "F");

    pdf.setFontSize(12);
    pdf.setFont(undefined, "bold");
    pdf.text("TOTAL AMOUNT PAID", 15, y + 8);

    pdf.setFontSize(16);
    pdf.text(`KES ${total.toLocaleString()}`, 15, y + 18);

    pdf.setFontSize(9);
    pdf.setFont(undefined, "normal");

    const words = numberToWords(total);
    pdf.text(`In Words: ${words}`, 15, y + 27);

    pdf.setFontSize(10);
    pdf.text("STATUS: APPROVED", 130, y + 16);

    y += 40;

    // ================= TABLE =================
    pdf.setFontSize(10);
    pdf.setFont(undefined, "bold");

    pdf.text("TYPE", 10, y);
    pdf.text("DEBIT", 60, y);
    pdf.text("CREDIT", 100, y);
    pdf.text("AMOUNT", 150, y);

    pdf.line(10, y + 2, 200, y + 2);

    y += 8;

    pdf.setFont(undefined, "normal");

    entries.forEach((e) => {
      pdf.text(str(e.type).toUpperCase(), 10, y);
      pdf.text(str(e.debit_account_id || "-"), 60, y);
      pdf.text(str(e.credit_account_id || "-"), 100, y);
      pdf.text(num(e.amount).toLocaleString(), 150, y);

      y += 7;

      if (y > 265) {
        pdf.addPage();
        y = 20;
      }
    });

    // ================= QR CODE =================
    const qrData = `
Receipt: ${receiptNo}
Member: ${base.name}
Amount: ${total}
Date: ${base.date}
`;

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrData)}`;

    try {
      const qrImage = await loadImage(qrUrl);
      pdf.addImage(qrImage, "PNG", 160, 230, 30, 30);
    } catch {
      console.warn("QR failed");
    }

    // ================= FOOTER =================
    pdf.setFontSize(8);
    pdf.setTextColor(120);

    pdf.text(
      "Scan QR to verify this receipt.",
      10,
      280
    );

    pdf.text(
      `Generated: ${new Date().toLocaleString()}`,
      10,
      285
    );

    // ================= DOWNLOAD =================
    pdf.save(`RECEIPT_${receiptNo}.pdf`);

    return { total };

  } catch (err) {
    console.error(err);
    alert("Receipt generation failed");
    return null;
  }
}