import { supabase } from "../supabaseClient";

export const pushToOutbox = async (payload) => {
  const { data, error } = await supabase
    .from("whatsapp_outbox")
    .insert([
      {
        member_no: payload.member_no,
        phone: payload.phone,
        message: payload.message,
        type: payload.type,
        attachment: payload.attachment || null,
        status: "pending"
        // Let your PostgreSQL database manage the default created_at timestamp automatically 
      }
    ]);

  if (error) {
    console.error("Outbox Insertion Error:", error);
    throw error;
  }
  return data;
};