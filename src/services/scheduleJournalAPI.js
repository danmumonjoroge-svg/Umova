export const postScheduleToJournal = async (payload) => {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/post-loan-schedule-to-journal`,
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
    throw new Error(data.error || "Failed to post schedule");
  }

  return data;
};