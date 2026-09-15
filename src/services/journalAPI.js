import { supabase } from "../supabaseClient";
import { isPeriodOpenForDate } from "./accountingPeriodsAPI";

/**
 * Posts a journal via the post_journal Postgres RPC function (see
 * migrations/2026xxxxxx_fix_journal_engine_schema.sql), NOT an edge
 * function. None of the deployed edge functions reviewed matched this
 * schema, or were even deployed under the name this used to call
 * ("journal-engine") — a plain RPC avoids depending on a separate,
 * unverified deployment altogether, and gets a real atomic transaction
 * as a bonus.
 *
 * lines: [{ account_id, debit, credit, member_no?, description? }]
 * member_no is the business identifier (e.g. "M12345"), NOT a uuid —
 * journal_entries/journal_lines.member_id (uuid) is intentionally left
 * unpopulated here; resolving a real member uuid can be added later if
 * something specifically needs it.
 */
export const postJournal = async ({
  member_no,
  reference,
  description,
  lines,
  date, // optional — e.g. a back-dated receipt. Defaults to today if omitted.
  source_module = "manual",
}) => {

  // Fast client-side check for UX only — the RPC re-checks this itself
  // (see post_journal's period lookup) since this call could otherwise be
  // bypassed by anyone hitting the RPC directly.
  const { open, period } = await isPeriodOpenForDate(date);
  if (!open) {
    throw new Error(
      `Cannot post: accounting period "${period?.period_name}" is closed. Ask an admin/manager to reopen it if this entry is required.`
    );
  }

  const { data, error } = await supabase.rpc("post_journal", {
    p_reference: reference,
    p_description: description,
    p_member_no: member_no || null,
    p_entry_date: date ? new Date(date).toISOString().slice(0, 10) : null,
    p_lines: lines,
    p_source_module: source_module,
  });

  if (error) {
    throw new Error(error.message || "Journal posting failed");
  }

  return data; // { journal_entry_id, reference, total_debit, total_credit }
};
