import { supabase } from "../supabaseClient";

export const pushToOutbox = async (payload) => {
  try {
    if (!payload?.phone || !payload?.message) {
      throw new Error("Phone and message are required");
    }

    const cleanPayload = {
      member_no: payload.member_no || null,
      phone: payload.phone,
      message: payload.message,
      type: payload.type || "manual",
      attachment_url: payload.attachment_url || null,
      status: payload.status || "pending",
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("whatsapp_outbox")
      .insert([cleanPayload])
      .select();

    if (error) {
      console.error("OUTBOX INSERT ERROR:", error);
      throw error;
    }

    return data;

  } catch (err) {
    console.error("pushToOutbox failed:", err);
    throw err;
  }
};