import { supabase } from "../supabaseClient";
import { useState } from "react";

export default function useRepayLoan() {

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const repayLoan = async (member_id, amount) => {

    // ================= VALIDATION =================
    if (!member_id) {
      alert("Member ID is required");
      return;
    }

    if (!amount || Number(amount) <= 0) {
      alert("Enter a valid repayment amount");
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);

    try {

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/loan-repayment-engine`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.REACT_APP_SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({
            member_id,
            amount: Number(amount)
          })
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "Repayment failed");
      }

      setResult(data);

      alert(
        `Repayment Successful\n\nInterest: ${data.interestPaid}\nPrincipal: ${data.principalPaid}`
      );

    } catch (err) {
      setError(err.message || "Unexpected error occurred");

      alert("Error: " + err.message);

    } finally {
      setLoading(false);
    }
  };

  return {
    repayLoan,
    loading,
    result,
    error
  };
}