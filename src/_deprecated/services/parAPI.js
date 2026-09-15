import { supabase } from "../supabaseClient";
export const runPARClassification = async (loans) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/par-classification-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.REACT_APP_SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`
      },
      body: JSON.stringify({ loans })
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "PAR calculation failed");
  }

  return data;
};