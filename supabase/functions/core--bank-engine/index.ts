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
    const { action, data, user } = await req.json();

    // ================= 1. CREATE TRANSACTION =================
    if (action === "create") {
      const { data: tx } = await supabase
        .from("transactions")
        .insert([
          {
            type: data.type,
            from_account: data.from,
            to_account: data.to,
            amount: data.amount,
            reference: `TX-${Date.now()}`,
          },
        ])
        .select()
        .single();

      await supabase.from("approvals").insert([
        {
          transaction_id: tx.id,
          maker: user,
        },
      ]);

      return new Response(JSON.stringify({ success: true, tx }), { headers: cors });
    }

    // ================= 2. APPROVE TRANSACTION =================
    if (action === "approve") {
      const txId = data.transaction_id;

      const { data: tx } = await supabase
        .from("transactions")
        .update({ status: "approved" })
        .eq("id", txId)
        .select()
        .single();

      await supabase
        .from("approvals")
        .update({
          status: "approved",
          checker: user,
          approved_at: new Date(),
        })
        .eq("transaction_id", txId);

      // ================= LEDGER POSTING =================
      await supabase.from("ledger").insert([
        {
          transaction_id: tx.id,
          account: tx.from_account,
          credit: tx.amount,
        },
        {
          transaction_id: tx.id,
          account: tx.to_account,
          debit: tx.amount,
        },
      ]);

      // ================= WALLET UPDATE =================
      await supabase.rpc("update_accounts", {
        from_acc: tx.from_account,
        to_acc: tx.to_account,
        amt: tx.amount,
      });

      return new Response(
        JSON.stringify({ success: true, message: "Posted to ledger" }),
        { headers: cors }
      );
    }

    // ================= 3. BANKING OPERATIONS =================
    if (action === "transfer") {
      return new Response(
        JSON.stringify({ message: "Use create transaction instead" }),
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