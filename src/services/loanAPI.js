export const generateLoanSchedule = async (payload) => {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-loan-schedule`,
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
    throw new Error(data.error || "Schedule generation failed");
  }

  return data;
};