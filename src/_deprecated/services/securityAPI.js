import { supabase } from "../supabaseClient";
export const checkPermission = async (role, action) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/security-guard`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.REACT_APP_SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`
      },
      body: JSON.stringify({ role, action })
    }
  );

  const data = await res.json();

  return data.allowed;
};