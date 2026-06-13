import { supabase } from "../supabaseClient";

export const postJournal = async (payload) => {
  const {
    date,
    type,
    amount,
    member_no,
    description,

    debit_account_id,
    credit_account_id,

    debit_account_type,
    credit_account_type,

    source_module,
    reference_no,

    // 🔥 FUTURE EXTENSION (NEW ACCOUNTS / CUSTOM MODULES)
    dynamic_accounts, // array of extra accounts
    meta              // flexible JSON storage
  } = payload;

  const clean = {
    date: date ? new Date(date).toISOString() : new Date().toISOString(),
    type,
    amount: Number(amount),
    member_no,
    description,

    debit_account_id: Number(debit_account_id),
    credit_account_id: Number(credit_account_id),

    debit_account_type: debit_account_type || "general",
    credit_account_type: credit_account_type || "general",

    source_module: source_module || "manual",
    reference_no: reference_no || null,

    dynamic_accounts: dynamic_accounts || [],
    meta: meta || {},
  };

  // ================= 1. JOURNAL ENTRY (HEADER) =================
  const { data: entry, error: entryError } = await supabase
    .from("journal_entries")
    .insert([
      {
        date: clean.date,
        type: clean.type,
        member_no: clean.member_no,
        description: clean.description,
        amount: clean.amount,
        source_module: clean.source_module,
        reference_no: clean.reference_no,
        meta: clean.meta,
      },
    ])
    .select()
    .single();

  if (entryError) {
    console.error("❌ JOURNAL ENTRY ERROR:", entryError);
    throw entryError;
  }

  const entryId = entry.id;

  // ================= 2. CORE DOUBLE ENTRY =================
  const baseLines = [
    {
      journal_entry_id: entryId,
      account_id: clean.debit_account_id,
      account_type: clean.debit_account_type,

      debit: clean.amount,
      credit: 0,

      member_no: clean.member_no,
      description: clean.description,
      date: clean.date,
      source_module: clean.source_module,
    },
    {
      journal_entry_id: entryId,
      account_id: clean.credit_account_id,
      account_type: clean.credit_account_type,

      debit: 0,
      credit: clean.amount,

      member_no: clean.member_no,
      description: clean.description,
      date: clean.date,
      source_module: clean.source_module,
    },
  ];

  // ================= 3. FUTURE EXTENSION LINES =================
  // Allows unlimited new accounting entries without touching core logic
  const extraLines = (clean.dynamic_accounts || []).map((acc) => ({
    journal_entry_id: entryId,
    account_id: acc.account_id,
    account_type: acc.account_type || "general",

    debit: Number(acc.debit || 0),
    credit: Number(acc.credit || 0),

    member_no: clean.member_no,
    description: acc.description || clean.description,
    date: clean.date,
    source_module: clean.source_module,
  }));

  const allLines = [...baseLines, ...extraLines];

  const { error: lineError } = await supabase
    .from("journal_lines")
    .insert(allLines);

  if (lineError) {
    console.error("❌ JOURNAL LINE ERROR:", lineError);
    throw lineError;
  }

  // ================= 4. GENERAL LEDGER =================
  const glRows = [
    {
      date: clean.date,
      type: clean.type,
      amount: clean.amount,
      member_no: clean.member_no,
      description: clean.description,

      debit_account_id: clean.debit_account_id,
      credit_account_id: clean.credit_account_id,

      debit_account_type: clean.debit_account_type,
      credit_account_type: clean.credit_account_type,

      source_module: clean.source_module,
      reference_no: clean.reference_no,

      meta: clean.meta,

      journal_entry_id: entryId,
    },
  ];

  const { data, error } = await supabase
    .from("general_ledger")
    .insert(glRows)
    .select();

  if (error) {
    console.error("❌ GL POST ERROR:", error);
    throw error;
  }

  return {
    journal_entry: entry,
    journal_lines: allLines,
    general_ledger: data,
  };
};