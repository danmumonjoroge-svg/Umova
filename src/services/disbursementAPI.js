export const disburseLoan = async (payload) => {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/loan-disbursement-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Disbursement failed");
  }

  return data;
};