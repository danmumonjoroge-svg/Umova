import { supabase } from "../supabaseClient";
import { useState } from "react";

export default function useLoanSchedule() {

  const [loading, setLoading] = useState(false);
  const [schedule, setSchedule] = useState(null);
  const [error, setError] = useState(null);

  const generateSchedule = async (
    member_id,
    term_months = 12,
    annual_rate = 0.12
  ) => {

    if (!member_id) {
      alert("Member ID is required");
      return;
    }

    setLoading(true);
    setError(null);
    setSchedule(null);

    try {

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/generate-loan-schedule`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.REACT_APP_SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({
            member_id,
            term_months,
            annual_rate
          })
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "Failed to generate schedule");
      }

      setSchedule(data.schedule);

      return data;

    } catch (err) {
      setError(err.message || "Unexpected error");

      alert("Schedule Error: " + err.message);

    } finally {
      setLoading(false);
    }
  };

  return {
    generateSchedule,
    loading,
    schedule,
    error
  };
}