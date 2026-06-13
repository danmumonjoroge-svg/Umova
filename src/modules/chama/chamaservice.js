import { supabase } from "../../lib/supabaseClient";

export const ChamaService = {

  getProfiles: () =>
    supabase.from("chama_profiles").select("*"),

  getTransactions: () =>
    supabase.from("chama_transactions").select("*"),

  getLoans: () =>
    supabase.from("chama_loans").select("*"),

  getPendingContributions: () =>
    supabase.from("chama_contribution_requests").eq("status", "pending"),

  approveContribution: (id, adminId) =>
    supabase
      .from("chama_contribution_requests")
      .update({
        status: "approved",
        approved_by: adminId,
        approved_at: new Date()
      })
      .eq("id", id)
};