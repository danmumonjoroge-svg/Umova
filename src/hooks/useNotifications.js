import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function useNotifications(user_id) {

  const [notifications, setNotifications] = useState([]);

  useEffect(() => {

    // load initial
    const load = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false });

      setNotifications(data || []);
    };

    load();

    // ================= REAL-TIME SUBSCRIPTION =================
    const channel = supabase
      .channel("notifications-channel")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications"
        },
        (payload) => {
          setNotifications((prev) => [payload.new, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };

  }, [user_id]);

  return { notifications };
}