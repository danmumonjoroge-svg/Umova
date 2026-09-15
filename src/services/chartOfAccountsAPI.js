import { supabase } from "../supabaseClient";

// Chart of Accounts changes rarely relative to how often postings happen,
// so this caches the whole system-account map in memory for the session
// rather than querying on every single posting.
let cache = null;
let inFlight = null;

const loadMap = async () => {
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("id, system_account_key, name, is_active, allow_posting")
    .not("system_account_key", "is", null);

  if (error) throw error;

  const map = {};
  for (const row of data) {
    map[row.system_account_key] = row;
  }
  return map;
};

/**
 * Resolves a system-account key (e.g. "CASH", "LOAN_RECEIVABLE",
 * "MEMBER_SAVINGS") to its real chart_of_accounts.id. Throws if the key
 * isn't mapped, or if the mapped account is inactive/not postable — better
 * to fail loudly than silently post to the wrong or a dead account.
 */
export const getSystemAccount = async (key) => {
  if (!cache) {
    inFlight = inFlight || loadMap();
    cache = await inFlight;
  }

  const account = cache[key];
  if (!account) {
    throw new Error(
      `getSystemAccount: no chart_of_accounts row is mapped to system_account_key = "${key}". Check the Chart of Accounts.`
    );
  }
  if (!account.is_active || !account.allow_posting) {
    throw new Error(
      `getSystemAccount: account "${account.name}" (key "${key}") is inactive or not postable.`
    );
  }
  return account.id;
};

// Call after editing chart_of_accounts in the same session (e.g. from an
// admin screen) so stale ids aren't used for the rest of the session.
export const invalidateSystemAccountCache = () => {
  cache = null;
  inFlight = null;
};
