export const evaluateRisk = async (member) => {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/credit-risk-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ member })
    }
  );

  return await res.json();
};