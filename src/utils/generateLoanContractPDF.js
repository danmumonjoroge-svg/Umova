import jsPDF from "jspdf";
import QRCode from "qrcode";
import logo from "../asset/logo/umovalogo.png";

// ================= NUMBER TO WORDS =================
const numberToWords = (num) => {
  const a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
  "Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];

  const b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];

  if (num === 0) return "Zero";
  if (num < 20) return a[num];
  if (num < 100) return b[Math.floor(num / 10)] + " " + a[num % 10];
  if (num < 1000)
    return a[Math.floor(num / 100)] + " Hundred " + numberToWords(num % 100);

  if (num < 1000000)
    return numberToWords(Math.floor(num / 1000)) + " Thousand " +
           numberToWords(num % 1000);

  return numberToWords(Math.floor(num / 1000000)) + " Million " +
         numberToWords(num % 1000000);
};

// ================= FORMAT MONEY =================
const formatMoney = (v) =>
  `KES ${Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

// ================= FINGERPRINT =================
const generateFingerprint = (data) => {
  const raw = `${data.member_no}|${data.amount}|${data.loan_type}|${data.interest_rate}`;

  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) + raw.charCodeAt(i);
  }

  return "LC-" + Math.abs(hash).toString(16).toUpperCase();
};

// ================= MAIN CONTRACT =================
export const generateLoanContractPDF = async (data) => {

  const doc = new jsPDF();

  const amount = Number(data.amount || data.amount_requested);
  const amountWords = numberToWords(Math.floor(amount));
  const fingerprint = generateFingerprint(data);

  // ================= HEADER =================
  doc.setFillColor(0, 90, 60);
  doc.rect(0, 0, 210, 40, "F");

  doc.addImage(logo, "PNG", 10, 7, 24, 24);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("UMOVA CORE BANKING SYSTEM", 40, 16);

  doc.setFontSize(9);
  doc.setTextColor(210, 240, 225);
  doc.text("Loan Contract Agreement (Legally Binding)", 40, 23);

  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text(`CONTRACT ID: ${data.loan_type || "LOAN"}-${Date.now()}`, 130, 16);

  // ================= TITLE =================
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("LOAN AGREEMENT CONTRACT", 60, 50);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(
    "This agreement is entered between UMOVA Financial System and the borrower below.",
    20,
    57
  );

  // ================= BORROWER INFO =================
  doc.setFontSize(10);

  doc.text(`Member No: ${data.member_no}`, 15, 70);
  doc.text(`Name: ${data.applicant?.name || data.name || "-"}`, 15, 76);

  doc.text(`Loan Type: ${data.loan_type}`, 120, 70);
  doc.text(`Interest Rate: ${data.interest_rate}%`, 120, 76);

  doc.text(`Repayment Months: ${data.months || data.repayment_period}`, 15, 82);
  doc.text(`Purpose: ${data.purpose || "-"}`, 120, 82);

  // ================= AMOUNT BLOCK =================
  doc.setFillColor(235, 248, 240);
  doc.roundedRect(15, 90, 180, 28, 3, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0, 90, 60);
  doc.text("APPROVED LOAN AMOUNT", 20, 100);

  doc.setFontSize(18);
  doc.text(formatMoney(amount), 20, 112);

  // ================= AMOUNT IN WORDS =================
  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(70, 80, 80);
  doc.text(`Amount in words: ${amountWords} Shillings Only`, 15, 125);

  // ================= LOAN TERMS =================
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  doc.text("Loan Terms:", 15, 135);
  doc.text("1. Borrower agrees to repay loan as per schedule.", 15, 142);
  doc.text("2. Interest is charged monthly as per product rules.", 15, 148);
  doc.text("3. Default may attract penalties and legal action.", 15, 154);
  doc.text("4. Early repayment is allowed unless otherwise stated.", 15, 160);

  // ================= FINGERPRINT =================
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Contract Fingerprint: ${fingerprint}`, 15, 168);

  // ================= QR CODE =================
  const qrPayload = {
    contract_id: fingerprint,
    member: data.member_no,
    amount,
    type: data.loan_type,
    interest: data.interest_rate
  };

  const qr = await QRCode.toDataURL(JSON.stringify(qrPayload));
  doc.addImage(qr, "PNG", 155, 60, 40, 40);

  // ================= SIGNATURE BLOCK =================
  doc.setTextColor(0, 0, 0);
  doc.text("__________________________", 20, 185);
  doc.text("Borrower Signature", 25, 192);

  doc.text("__________________________", 120, 185);
  doc.text("Authorized Officer", 130, 192);

  // ================= FOOTER =================
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);

  doc.text("✔ This is a system-generated loan contract", 15, 205);
  doc.text("✔ Verification required via QR or system lookup", 15, 210);

  // ================= SAVE =================
  doc.save(`LOAN_CONTRACT_${data.member_no}.pdf`);
};