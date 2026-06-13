import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../supabaseClient";

export default function AccountLedger() {
  const { id } = useParams();

  const [account, setAccount] = useState(null);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    fetchAccount();
    fetchLedger();
  }, [id]);

  // GET ACCOUNT INFO (Chart of Accounts)
  const fetchAccount = async () => {
    const { data } = await supabase
      .from("chart_of_accounts")
      .select("*")
      .eq("id", id)
      .single();

    setAccount(data);
  };

  // GET LEDGER TRANSACTIONS
  const fetchLedger = async () => {
    const { data } = await supabase
      .from("general_ledger")
      .select("*")
      .or(`debit_account_id.eq.${id},credit_account_id.eq.${id}`)
      .order("date", { ascending: false });

    setTransactions(data || []);
  };

  // CALCULATE TOTALS
  const totalDebit = transactions.reduce((sum, tx) => {
    return tx.debit_account_id == id
      ? sum + Number(tx.amount || 0)
      : sum;
  }, 0);

  const totalCredit = transactions.reduce((sum, tx) => {
    return tx.credit_account_id == id
      ? sum + Number(tx.amount || 0)
      : sum;
  }, 0);

  const balance = totalDebit - totalCredit;

  return (
    <div className="p-6">

      {/* HEADER */}
      <h1 className="text-2xl font-bold mb-2">
        Account Ledger
      </h1>

      {account && (
        <div className="mb-4 bg-gray-100 p-3 rounded">
          <p><b>Account:</b> {account.name}</p>
          <p><b>Type:</b> {account.type}</p>
          <p><b>Code:</b> {account.code}</p>
        </div>
      )}

      {/* SUMMARY */}
      <div className="grid grid-cols-3 gap-4 mb-4">

        <div className="bg-green-100 p-3">
          <p>Total Debit</p>
          <h2 className="text-xl font-bold">
            {totalDebit.toFixed(2)}
          </h2>
        </div>

        <div className="bg-red-100 p-3">
          <p>Total Credit</p>
          <h2 className="text-xl font-bold">
            {totalCredit.toFixed(2)}
          </h2>
        </div>

        <div className="bg-blue-100 p-3">
          <p>Balance</p>
          <h2 className="text-xl font-bold">
            {balance.toFixed(2)}
          </h2>
        </div>

      </div>

      {/* TRANSACTIONS TABLE */}
      <table className="w-full border">

        <thead className="bg-gray-200">
          <tr>
            <th className="border p-2">Date</th>
            <th className="border p-2">Type</th>
            <th className="border p-2">Debit</th>
            <th className="border p-2">Credit</th>
            <th className="border p-2">Amount</th>
          </tr>
        </thead>

        <tbody>
          {transactions.length === 0 ? (
            <tr>
              <td colSpan="5" className="text-center p-4">
                No transactions found
              </td>
            </tr>
          ) : (
            transactions.map((tx) => (
              <tr key={tx.id} className="text-center">

                <td className="border p-2">
                  {tx.date}
                </td>

                <td className="border p-2">
                  {tx.type}
                </td>

                <td className="border p-2">
                  {tx.debit_account_id == id
                    ? Number(tx.amount).toFixed(2)
                    : "-"}
                </td>

                <td className="border p-2">
                  {tx.credit_account_id == id
                    ? Number(tx.amount).toFixed(2)
                    : "-"}
                </td>

                <td className="border p-2 font-bold">
                  {Number(tx.amount).toFixed(2)}
                </td>

              </tr>
            ))
          )}
        </tbody>

      </table>

    </div>
  );
}