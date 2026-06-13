// src/Services/whatsappMessageGenerator.js

/**
 * CENTRAL WHATSAPP MESSAGE GENERATOR
 * Converts SACCO events into WhatsApp-ready messages
 */

export const WhatsAppMessageGenerator = {

  /* ================= LOAN APPROVED ================= */
  loanApproved(member, loan) {
    return {
      member_no: member.member_no,
      phone: member.phone,
      type: "loan_approved",
      message: `
Hello ${member.name},

Your loan has been successfully approved 🎉

Loan Details:
- Amount: KES ${loan.amount}
- Repayment Period: ${loan.period} months
- Interest Rate: ${loan.interest_rate}%

Kindly check your member statement for full breakdown.

Thank you for trusting Umova.
      `.trim()
    };
  },

  /* ================= PAYMENT RECEIVED ================= */
  paymentReceived(member, payment) {
    return {
      member_no: member.member_no,
      phone: member.phone,
      type: "payment_received",
      message: `
Hello ${member.name},

We have received your payment successfully ✅

Payment Details:
- Amount Paid: KES ${payment.amount}
- Mode: ${payment.mode || "Bank"}
- Receipt No: ${payment.receipt_no}

Thank you for your continued commitment.
      `.trim()
    };
  },

  /* ================= LOAN REPAYMENT REMINDER ================= */
  repaymentReminder(member, loan) {
    return {
      member_no: member.member_no,
      phone: member.phone,
      type: "repayment_reminder",
      message: `
Dear ${member.name},

This is a friendly reminder that your loan repayment is due ⚠️

Outstanding Balance: KES ${loan.balance}
Due Date: ${loan.due_date}

Kindly clear on time to avoid penalties.

Umova Management
      `.trim()
    };
  }
};