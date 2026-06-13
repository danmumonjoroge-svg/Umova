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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { action, member_no, amount, type, to_member } = await req.json();

    // ================= CREATE WALLET IF NOT EXISTS =================
    await supabase
      .from("wallets")
      .upsert({ member_no });

    // ================= DEPOSIT =================
    if (action === "deposit") {
      await supabase
        .from("wallets")
        .rpc("increment_savings", {
          m: member_no,
          amt: amount,
        });

      await supabase.from("ledger_entries").insert([
        {
          account_debit: "Cash",
          account_credit: "Savings",
          amount,
          member_no,
          reference: `DEP-${Date.now()}`,
        },
      ]);

      return new Response(
        JSON.stringify({ success: true, message: "Deposit successful" }),
        { headers: cors }
      );
    }

    // ================= WITHDRAW =================
    if (action === "withdraw") {
      const { data: wallet } = await supabase
        .from("wallets")
        .select("*")
        .eq("member_no", member_no)
        .single();

      if (wallet.savings_balance < amount) {
        return new Response(
          JSON.stringify({ success: false, error: "Insufficient funds" }),
          { headers: cors }
        );
      }

      await supabase
        .from("wallets")
        .rpc("decrement_savings", {
          m: member_no,
          amt: amount,
        });

      return new Response(
        JSON.stringify({ success: true, message: "Withdrawal successful" }),
        { headers: cors }
      );
    }

    // ================= TRANSFER =================
    if (action === "transfer") {
      // debit sender
      await supabase.rpc("decrement_savings", {
        m: member_no,
        amt: amount,
      });

      // credit receiver
      await supabase.rpc("increment_savings", {
        m: to_member,
        amt: amount,
      });

      await supabase.from("ledger_entries").insert([
        {
          account_debit: member_no,
          account_credit: to_member,
          amount,
          reference: `TRF-${Date.now()}`,
        },
      ]);

      return new Response(
        JSON.stringify({ success: true, message: "Transfer complete" }),
        { headers: cors }
      );
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: cors,
    });

  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: cors }
    );
  }
});