import { supabase } from "../supabaseClient";
export const evaluateRisk = async (member) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/credit-risk-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.REACT_APP_SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`
      },
      body: JSON.stringify({ member })
    }
  );

  return await res.json();
};