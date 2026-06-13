export const logAudit = async (payload) => {
  await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/audit-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    }
  );
};