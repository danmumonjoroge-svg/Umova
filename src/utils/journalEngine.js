// DEPRECATED — do not add new callers.
//
// This used to insert directly into journal_entries/journal_lines/
// general_ledger from the browser. The canonical posting path is now the
// post_journal Postgres RPC (src/services/journalAPI.js), which runs as one
// real atomic transaction instead of the best-effort, non-atomic inserts
// this file used to do. (Not an edge function — none of the deployed edge
// functions matched this schema or were even deployed under a matching
// name, so a database RPC was used instead.)
//
// Kept as a thin compatibility wrapper so nothing importing the old
// { date, type, debit_account_id, credit_account_id, ... } shape breaks
// while callers are migrated one at a time. New code should call
// postJournal from "../services/journalAPI" directly with the
// { member_no, reference, description, lines: [{account_id, debit, credit}] }
// shape instead.
import { postJournal as postJournalViaRpc } from "../services/journalAPI";

export const postJournal = async (payload) => {
  const {
    member_no,
    reference,
    description,
    debit_account_id,
    credit_account_id,
    amount,
    dynamic_accounts,
  } = payload;

  if (!reference) {
    throw new Error("postJournal: 'reference' is required (e.g. RPY-2026-000123)");
  }

  const amt = Number(amount);
  const lines = [
    { account_id: Number(debit_account_id), debit: amt, credit: 0, description },
    { account_id: Number(credit_account_id), debit: 0, credit: amt, description },
    ...(dynamic_accounts || []).map((acc) => ({
      account_id: Number(acc.account_id),
      debit: Number(acc.debit || 0),
      credit: Number(acc.credit || 0),
      description: acc.description || description,
    })),
  ];

  return postJournalViaRpc({
    member_no,
    reference,
    description,
    lines,
  });
};
