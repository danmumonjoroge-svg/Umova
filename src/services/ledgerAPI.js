export const postLedgerEvent = async (event_type, payload) => {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ledger-automation-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
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