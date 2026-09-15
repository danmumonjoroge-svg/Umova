import { supabase } from "../supabaseClient";

/**
 * A date with NO matching accounting_periods row is treated as OPEN.
 * This is deliberate: periods are a brand-new feature, and treating
 * unconfigured dates as closed-by-default would silently block every
 * existing posting flow the moment this migration runs. Once an admin
 * starts defining/closing periods, this stops applying to those dates.
 */
export const isPeriodOpenForDate = async (dateStr) => {
  const date = dateStr ? new Date(dateStr).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("accounting_periods")
    .select("id, status, period_name")
    .lte("start_date", date)
    .gte("end_date", date)
    .maybeSingle();

  if (error) {
    // Fail open, not closed — a lookup error shouldn't itself block posting.
    // It's logged so a broken periods table doesn't fail silently forever.
    console.error("accountingPeriodsAPI.isPeriodOpenForDate:", error);
    return { open: true, period: null };
  }

  if (!data) return { open: true, period: null }; // no period configured for this date
  return { open: data.status === "open", period: data };
};

export const listPeriods = async () => {
  const { data, error } = await supabase
    .from("accounting_periods")
    .select("*")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data;
};

export const createPeriod = async ({ period_name, start_date, end_date }) => {
  const { data, error } = await supabase
    .from("accounting_periods")
    .insert([{ period_name, start_date, end_date, status: "open" }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const closePeriod = async (periodId, userId) => {
  const { data, error } = await supabase
    .from("accounting_periods")
    .update({ status: "closed", closed_by: userId, closed_at: new Date().toISOString() })
    .eq("id", periodId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

// Reopening requires a reason on the record — RLS restricts *who* can call
// this (admin/superadmin/manager only); this just makes sure a reason is
// always captured for the audit trail regardless of who's authorized.
export const reopenPeriod = async (periodId, userId, reason) => {
  if (!reason || !reason.trim()) {
    throw new Error("A reason is required to reopen a closed accounting period.");
  }
  const { data, error } = await supabase
    .from("accounting_periods")
    .update({
      status: "open",
      reopened_by: userId,
      reopened_at: new Date().toISOString(),
      reopen_reason: reason,
    })
    .eq("id", periodId)
    .select()
    .single();
  if (error) throw error;
  return data;
};
