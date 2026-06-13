export const postJournal = async ({
  member_id,
  reference,
  description,
  lines
}) => {

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/journal-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        member_id,
        reference,
        description,
        lines
      })
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data || "Journal posting failed");
  }

  return data;
};