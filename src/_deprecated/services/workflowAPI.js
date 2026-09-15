import { supabase } from "../supabaseClient";
// src/services/workflowAPI.js

export const createWorkflow = async (action, payload, user) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/workflow-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.REACT_APP_SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`
      },
      body: JSON.stringify({
        action,
        payload,
        user_id: user.id,
        role: user.role
      })
    }
  );

  return await res.json();
};

// ================= APPROVE =================
export const approveWorkflow = async (request_id, user) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/workflow-approve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.REACT_APP_SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`
      },
      body: JSON.stringify({
        request_id,
        user_id: user.id,
        role: user.role
      })
    }
  );

  return await res.json();
};