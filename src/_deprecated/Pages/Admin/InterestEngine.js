import { postJournal } from "../services/journalAPI";

export const calculateInterest = async (member_id, principal) => {

  const interest = principal * 0.12 / 12;

  return await postJournal({
    member_id,
    reference: `INT-${Date.now()}`,
    description: "Monthly Loan Interest",

    lines: [
      {
        account_id: 1101, // Interest Receivable
        debit: interest,
        credit: 0
      },
      {
        account_id: 1020, // Interest Income
        debit: 0,
        credit: interest
      }
    ]
  });
};