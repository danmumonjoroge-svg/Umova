import { postJournal } from "../services/journalAPI";

export const calculateInterest = async (member_no, principal) => {

  const interest = principal * 0.12 / 12;

  return await postJournal({
    member_no, // statements are keyed on member_no; member_id left it blank
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