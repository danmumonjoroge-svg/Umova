// src/services/workflowAPI.js

export const createWorkflow = async (action, payload, user) => {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workflow-engine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
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
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workflow-approve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
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