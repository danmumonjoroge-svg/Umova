export const runPARClassification = async (loans) => {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/par-classification-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
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