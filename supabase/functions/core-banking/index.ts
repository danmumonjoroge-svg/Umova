import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAILY_RATE = 12 / 100 / 365;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, fromDate, toDate, member_no } = await req.json();

    // ================= LOCK CHECK =================
    const { data: lock } = await supabase
      .from("posting_locks")
      .select("*")
      .eq("type", action)
      .eq("from_date", fromDate)
      .eq("to_date", toDate)
      .single();

    if (action === "post" && lock) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Period already locked (prevents double posting)",
        }),
        { headers: corsHeaders }
      );
    }

    // ================= FETCH LOANS =================
    let query = supabase.from("loans").select("*").eq("status", "ACTIVE");

    if (member_no) {
      query = query.eq("member_no", member_no);
    }

    const { data: loans, error } = await query;
    if (error) throw error;

    let total = 0;
    const results: any[] = [];

    for (const loan of loans || []) {
      const interest = Number(loan.balance) * DAILY_RATE;
      total += interest;

      results.push({
        loan_id: loan.id,
        member_no: loan.member_no,
        amount: interest,
      });
    }

    // ================= PREVIEW =================
    if (action === "preview") {
      return new Response(
        JSON.stringify({
          success: true,
          total: Number(total.toFixed(2)),
          data: results,
        }),
        { headers: corsHeaders }
      );
    }

    // ================= POST (FULL CORE BANKING) =================

    const reference = `INT-${Date.now()}`;

    // 1. CREATE TRANSACTION HEADER
    const { data: txn } = await supabase
      .from("transactions")
      .insert([
        {
          type: "interest",
          reference,
          amount: total,
          status: "posted",
        },
      ])
      .select()
      .single();

    // 2. DOUBLE ENTRY + LOAN UPDATE
    for (const r of results) {
      await supabase.from("general_ledger").insert([
        {
          transaction_id: txn.id,
          account: "Interest Expense",
          debit: r.amount,
          credit: 0,
          member_no: r.member_no,
          description: "Interest Dr",
        },
        {
          transaction_id: txn.id,
          account: "Interest Income",
          debit: 0,
          credit: r.amount,
          member_no: r.member_no,
          description: "Interest Cr",
        },
      ]);

      await supabase.rpc("increase_loan_balance", {
        loanid: r.loan_id,
        amount: r.amount,
      });
    }

    // 3. LOCK PERIOD
    await supabase.from("posting_locks").insert([
      {
        type: "interest",
        from_date: fromDate,
        to_date: toDate,
        locked: true,
      },
    ]);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Core banking posting completed",
        reference,
        total: Number(total.toFixed(2)),
      }),
      { headers: corsHeaders }
    );

  } catch (err: any) {
    console.error("CORE BANKING ERROR:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err.message,
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});