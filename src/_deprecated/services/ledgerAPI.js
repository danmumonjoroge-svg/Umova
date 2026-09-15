import { supabase } from "../supabaseClient";
export const postLedgerEvent = async (event_type, payload) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ledger-automation-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.REACT_APP_SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`
      },
      body: JSON.stringify({
        event_type,
        payload
      })
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Ledger posting failed");
  }

  return data;
};