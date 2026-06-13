export const calculateCreditScore = async (member) => {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/credit-score-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ member })
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Credit scoring failed");
  }

  return data;
};