import { supabase } from "../supabaseClient";
export const postScheduleToJournal = async (payload) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/post-loan-schedule-to-journal`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.REACT_APP_SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`
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