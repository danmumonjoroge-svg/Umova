import { supabase } from "../supabaseClient";
import { isPeriodOpenForDate } from "./accountingPeriodsAPI";

/**
 * Posts a journal through the post_journal Postgres RPC (atomic) and then
 * READS IT BACK before resolving. A resolved promise therefore means the
 * journal header, its lines and its general_ledger rows really exist — callers
 * can show "posted" without guessing. Any failure throws.
 *
 * !! Deploy AFTER 01_post_journal_v2.sql has been run. !!
 *
 * lines: [{ account_id, debit, credit, member_no?, loan_id?, description? }]
 * member_no / loan_id on a line win; otherwise the header-level value is used.
 * Returns { journal_entry_id, reference, total_debit, total_credit,
 *           line_count, gl_row_count }.
 */
export const postJournal = async ({
  member_no,
  loan_id,
  reference,
  description,
  lines,
  date, // optional — e.g. a back-dated receipt. Defaults to today if omitted.
  source_module = "manual",
}) => {
  // UX-only check; the RPC re-checks the period itself.
  const { open, period } = await isPeriodOpenForDate(date);
  if (!open) {
    throw new Error(
      `Cannot post: accounting period "${period?.period_name}" is closed. Ask an admin/manager to reopen it if this entry is required.`
    );
  }

  const args = {
    p_reference: reference,
    p_description: description,
    p_member_no: member_no || null,
    p_entry_date: date ? new Date(date).toISOString().slice(0, 10) : null,
    p_lines: lines,
    p_source_module: source_module,
  };
  // Only sent when used, so this file also works against the pre-v2 function.
  if (loan_id) args.p_loan_id = loan_id;

  const { data, error } = await supabase.rpc("post_journal", args);
  if (error) throw new Error(error.message || "Journal posting failed");

  await verifyPosted(data);
  return data;
};

/**
 * Read-back: header exists, expected number of lines exist, ledger rows exist.
 * If this fails the journal may or may not be posted — we say so honestly
 * instead of claiming success.
 */
export async function verifyPosted(result) {
  const id = result?.journal_entry_id;
  const ref = result?.reference;
  if (!id || !ref) {
    throw new Error("Payment/journal NOT confirmed: the server returned no journal id. Check the journal history before retrying.");
  }

  const [lines, ledger] = await Promise.all([
    supabase.from("journal_lines").select("id", { count: "exact", head: true }).eq("journal_id", id),
    supabase.from("general_ledger").select("cod", { count: "exact", head: true }).eq("journal_no", ref),
  ]);

  if (lines.error || ledger.error) {
    throw new Error(`Journal ${ref} was sent but could not be verified (${(lines.error || ledger.error).message}). Check the journal history before retrying.`);
  }
  if (lines.count !== result.line_count || ledger.count !== result.gl_row_count) {
    throw new Error(
      `Journal ${ref} needs verification: expected ${result.line_count} lines / ${result.gl_row_count} ledger rows, found ${lines.count} / ${ledger.count}.`
    );
  }
}

/**
 * Atomic reversal (reverse_journal RPC): posts the offsetting journal, links
 * it, and flags the original — all in one database transaction.
 */
export const reverseJournal = async ({ journalId, reason, date }) => {
  const { data, error } = await supabase.rpc("reverse_journal", {
    p_journal_id: journalId,
    p_reason: reason || null,
    p_date: date || null,
  });
  if (error) throw new Error(error.message || "Reversal failed");
  await verifyPosted(data);
  return data;
};
