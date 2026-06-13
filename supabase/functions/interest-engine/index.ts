import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ================= CONFIG =================
const DAILY_RATE = 0.12 / 365;

// ================= CORS =================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ================= MAIN =================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, fromDate, toDate } = await req.json();

    if (!fromDate || !toDate) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "fromDate and toDate are required",
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // ================= LOAD LOANS (BANK RULE FILTER) =================
    const { data: loans, error } = await supabase
      .from("loans")
      .select("*")
      .eq("status", "ACTIVE")
      .gt("balance", 0)
      .lte("disbursement_date", toDate); // 🔥 CRITICAL FIX

    if (error) throw error;

    let totalInterest = 0;
    const results: any[] = [];

    for (const loan of loans || []) {
      
      // ================= REAL BANK LOGIC =================
      const effectiveStart =
        new Date(loan.disbursement_date) > new Date(fromDate)
          ? new Date(loan.disbursement_date)
          : new Date(fromDate);

      const effectiveEnd = new Date(toDate);

      const days = Math.max(
        1,
        Math.floor(
          (effectiveEnd.getTime() - effectiveStart.getTime()) /
            (1000 * 60 * 60 * 24)
        )
      );

      const interest =
        Number(loan.balance) * DAILY_RATE * days;

      totalInterest += interest;

      results.push({
        loan_id: loan.id,
        member_no: loan.member_no,
        disbursement_date: loan.disbursement_date,
        balance: Number(loan.balance),
        days,
        interest: Number(interest.toFixed(2)),
      });
    }

    // ================= PREVIEW =================
    if (action === "preview") {
      return new Response(
        JSON.stringify({
          success: true,
          fromDate,
          toDate,
          total_interest: Number(totalInterest.toFixed(2)),
          loans: results,
        }),
        { headers: corsHeaders }
      );
    }

    // ================= POST (LEDGER MODE) =================
    if (action === "post") {

      // prevent double posting
      const { data: existing } = await supabase
        .from("interest_postings")
        .select("*")
        .eq("from_date", fromDate)
        .eq("to_date", toDate)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({
            success: false,
            alreadyPosted: true,
            message: "Period already posted",
          }),
          { headers: corsHeaders }
        );
      }

      // lock period
      await supabase.from("interest_postings").insert([
        {
          from_date: fromDate,
          to_date: toDate,
          total_amount: totalInterest,
          status: "POSTED",
        },
      ]);

      // ledger entries
      for (const item of results) {

        await supabase.from("loan_interest_logs").insert([
          {
            loan_id: item.loan_id,
            member_no: item.member_no,
            amount: item.interest,
            from_date: fromDate,
            to_date: toDate,
            status: "posted",
          },
        ]);

        // GL DOUBLE ENTRY
        await supabase.from("general_ledger").insert([
          {
            date: new Date().toISOString(),
            account: "Interest Expense",
            debit: item.interest,
            credit: 0,
            member_no: item.member_no,
          },
          {
            date: new Date().toISOString(),
            account: "Interest Income",
            debit: 0,
            credit: item.interest,
            member_no: item.member_no,
          },
        ]);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Interest posted successfully",
          total: Number(totalInterest.toFixed(2)),
        }),
        { headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Invalid action",
      }),
      { status: 400, headers: corsHeaders }
    );

  } catch (err: any) {
    console.error("INTEREST ENGINE ERROR:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err.message,
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});