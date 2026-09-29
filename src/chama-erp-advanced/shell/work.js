import { useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import useCachedQuery from "./useCachedQuery";

// Capabilities are just named hasRole() checks — the existing permission
// system, grouped so screens read naturally. Chairperson/admin pass every
// check because hasRole() itself says so.
export function useCapabilities() {
  const { member, hasRole } = useChama();
  return useMemo(() => ({
    reconcile: hasRole(["treasurer"]),
    disburse: hasRole(["treasurer"]),
    approveLoans: hasRole(["secretary", "treasurer", "chairperson"]),
    members: hasRole(["secretary", "chairperson"]),
    welfare: hasRole(["welfare_officer", "secretary", "treasurer", "chairperson"]),
    accounts: hasRole(["treasurer", "chairperson"]),
    post: hasRole(["secretary", "chairperson"]),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [member?.role]);
}

const count = (t) => supabase.from(t).select("id", { count: "exact", head: true });
const n = ({ count: c, error }) => { if (error) throw new Error(error.message); return c || 0; };

// Only the counts this role could act on are requested.
export async function loadWork(chamaId, can) {
  const work = {};
  const jobs = [];
  if (can.reconcile) jobs.push(count("chama_contribution_requests").eq("chama_id", chamaId).in("status", ["PENDING", "VERIFIED"]).then((r) => { work.contribsToCheck = n(r); }));
  if (can.disburse) jobs.push(count("chama_loans").eq("chama_id", chamaId).eq("disbursed", false).then((r) => { work.toDisburse = n(r); }));
  if (can.approveLoans) jobs.push(count("chama_loan_applications").eq("chama_id", chamaId).in("status", ["Pending", "Awaiting Approval"]).then((r) => { work.loanApps = n(r); }));
  if (can.members) jobs.push(count("chama_members").eq("chama_id", chamaId).eq("status", "pending").then((r) => { work.pendingMembers = n(r); }));
  if (can.welfare) jobs.push(count("welfare_cases").eq("chama_id", chamaId).eq("status", "open").then((r) => { work.openCases = n(r); }));
  await Promise.all(jobs);
  return work;
}

// The member's own live figures — used by every workspace landing so the
// cards show real numbers, not just labels.
export async function loadMine(chamaId, memberId) {
  const [me, loans] = await Promise.all([
    supabase.from("chama_members").select("id,name,role,status,savings_balance,shares_balance,welfare_balance").eq("id", memberId).single(),
    supabase.from("chama_loans").select("id,amount,balance,status,disbursed").eq("chama_id", chamaId).eq("member_id", memberId),
  ]);
  if (me.error || loans.error) throw new Error((me.error || loans.error).message);
  const owed = (loans.data || []).filter((l) => l.disbursed && l.status === "active").reduce((s, l) => s + Number(l.balance ?? l.amount ?? 0), 0);
  return { me: me.data, owed };
}

export function useMine() {
  const { chama, member } = useChama();
  return useCachedQuery(chama?.id && member?.id ? `mine:${chama.id}:${member.id}` : null, () => loadMine(chama.id, member.id), !!(chama?.id && member?.id));
}

export function useWork() {
  const { chama } = useChama();
  const can = useCapabilities();
  const any = Object.values(can).some(Boolean);
  const q = useCachedQuery(chama?.id && any ? `work:${chama.id}:${Object.values(can).map(Number).join("")}` : null, () => loadWork(chama.id, can), !!(chama?.id && any));
  return { ...q, work: q.data || {} };
}
