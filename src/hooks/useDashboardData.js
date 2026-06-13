import { useEffect, useState } from "react";
import supabase from "../supabaseClient";
import useMember from "./useMember";

export default function useDashboardData() {
  const { member, loading: memberLoading } = useMember();
  const [loading, setLoading] = useState(true);

  const [savings, setSavings] = useState([]);
  const [loans, setLoans] = useState([]);
  const [shares, setShares] = useState([]);
  const [statement, setStatement] = useState([]);
  const [totals, setTotals] = useState({ savings: 0, loans: 0, shares: 0 });

  useEffect(() => {
    const fetchData = async () => {
      if (!member?.member_no) {
        console.log("Member not loaded yet or null:", member);
        setLoading(false); // stop infinite loading
        return;
      }

      console.log("Fetching dashboard for member:", member.member_no);
      setLoading(true);

      const { data, error } = await supabase
        .from("general_ledger")
        .select("*")
        .eq("member_no", member.member_no)
        .order("date", { ascending: false });

      if (error) {
        console.error("Error fetching general_ledger:", error.message);
        setLoading(false);
        return;
      }

      const rows = data || [];

      // Filter by account/type
      const savingsData = rows.filter(
        (row) =>
          Number(row.id) === 1018 ||
          Number(row.debit_account_id) === 1018 ||
          Number(row.credit_account_id) === 1018
      );

      const loansData = rows.filter((row) => row.type === "loan");
      const sharesData = rows.filter((row) => row.type === "share");
      const statementData = [...rows];

      // Totals
      const totalSavings = savingsData.reduce((sum, row) => {
        if (Number(row.credit_account_id) === 1018) return sum + Number(row.amount || 0);
        if (Number(row.debit_account_id) === 1018) return sum - Number(row.amount || 0);
        return sum;
      }, 0);

      const totalLoans = loansData.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const totalShares = sharesData.reduce((sum, row) => sum + Number(row.amount || 0), 0);

      setSavings(savingsData);
      setLoans(loansData);
      setShares(sharesData);
      setStatement(statementData);
      setTotals({ savings: totalSavings, loans: totalLoans, shares: totalShares });

      setLoading(false);
    };

    fetchData();
  }, [member]);

  return { loading: memberLoading || loading, savings, loans, shares, statement, totals };
}