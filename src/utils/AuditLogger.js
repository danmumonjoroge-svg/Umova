import { supabase } from "../supabaseClient";

/**
 * AUDIT LOGGER
 * Call this after ANY important action
 */

export const logAudit = async ({
  action,
  table_name = null,
  record_id = null,
  old_data = null,
  new_data = null,
  metadata = {}
}) => {

  try {

    const user = JSON.parse(localStorage.getItem("admin_user")) ||
                 JSON.parse(localStorage.getItem("member"));

    if (!user) return;

    await supabase.from("audit_logs").insert([{
      user_id: user.id,
      user_name: user.full_name || user.name || "Unknown",
      role: user.role || "member",

      action,
      table_name,
      record_id,

      old_data,
      new_data,
      metadata
    }]);

  } catch (err) {
    console.error("Audit log failed:", err);
  }
};