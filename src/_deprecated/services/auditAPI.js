import { supabase } from "../supabaseClient";
export const logAudit = async (payload) => {
  const { data: { session } } = await supabase.auth.getSession();
  await fetch(
    `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/audit-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.REACT_APP_SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`
      },
      body: JSON.stringify(payload)
    }
  );
};