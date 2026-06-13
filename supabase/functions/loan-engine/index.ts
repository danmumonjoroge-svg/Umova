import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ================= LOAN ENGINE =================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { action, payload } = await req.json();

    // ================= 1. APPLY LOAN =================
    if (action === "apply") {
      const { data } = await supabase.from("loans").insert([
        {
          member_no: payload.member_no,
          principal: payload.amount,
          interest_rate: payload.rate,
          term_months: payload.term,
          status: "pending",
        },
      ]).select().single();

      return new Response(JSON.stringify({ success: true, loan: data }), {
        headers: cors,
      });
    }

    // ================= 2. APPROVE LOAN (MAKER-CHECKER) =================
    if (action === "approve") {
      const loanId = payload.loan_id;

      const { data: loan } = await supabase
        .from("loans")
        .update({ status: "approved", approved_by: payload.user })
        .eq("id", loanId)
        .select()
        .single();

      // generate schedule automatically
      const monthlyRate = loan.interest_rate / 100 / 12;
      const installment =
        (loan.principal * monthlyRate) /
        (1 - Math.pow(1 + monthlyRate, -loan.term_months));

      const schedule = [];

      for (let i = 1; i <= loan.term_months; i++) {
        schedule.push({
          loan_id: loan.id,
          due_date: new Date(Date.now() + i * 30 * 86400000),
          principal_due: installment * 0.7,
          interest_due: installment * 0.3,
          total_due: installment,
        });
      }

      await supabase.from("loan_schedule").insert(schedule);

      return new Response(
        JSON.stringify({ success: true, message: "Loan approved + schedule generated" }),
        { headers: cors }
      );
    }

    // ================= 3. DISBURSE LOAN =================
    if (action === "disburse") {
      const loanId = payload.loan_id;

      const { data: loan } = await supabase
        .from("loans")
        .update({
          status: "disbursed",
          disbursed_at: new Date(),
        })
        .eq("id", loanId)
        .select()
        .single();

      // ledger posting
      await supabase.from("loan_ledger").insert([
        {
          loan_id: loan.id,
          account: "Loan Asset",
          debit: loan.principal,
        },
        {
          loan_id: loan.id,
          account: "Cash",
          credit: loan.principal,
        },
      ]);

      return new Response(
        JSON.stringify({ success: true, message: "Loan disbursed" }),
        { headers: cors }
      );
    }

    // ================= 4. REPAYMENT =================
    if (action === "repay") {
      const { loan_id, amount, member_no } = payload;

      const { data: loan } = await supabase
        .from("loans")
        .select("*")
        .eq("id", loan_id)
        .single();

      await supabase.from("loan_repayments").insert([
        {
          loan_id,
          member_no,
          amount,
        },
      ]);

      await supabase.from("loan_ledger").insert([
        {
          loan_id,
          account: "Cash",
          debit: amount,
        },
        {
          loan_id,
          account: "Loan Asset",
          credit: amount,
        },
      ]);

      return new Response(
        JSON.stringify({ success: true, message: "Repayment recorded" }),
        { headers: cors }
      );
    }

    return new Response("Invalid action", { status: 400, headers: cors });

  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: cors }
    );
  }
});