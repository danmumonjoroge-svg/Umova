import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";

export default function ChartOfAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  // ================= FETCH =================
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: coa } = await supabase.from("chart_of_accounts").select("*");
    const { data: gl } = await supabase.from("general_ledger").select("*");

    setAccounts(coa || []);
    setLedger(gl || []);
  };

  // ================= ACCOUNT BALANCE ENGINE =================
  const getBalance = (accId) => {
    let debit = 0;
    let credit = 0;

    ledger.forEach((tx) => {
      const amt = Number(tx.amount || 0);

      if (tx.debit_account_id == accId) debit += amt;
      if (tx.credit_account_id == accId) credit += amt;
    });

    return {
      debit,
      credit,
      balance: debit - credit,
    };
  };

  // ================= GROUP ACCOUNTS (BANK STYLE) =================
  const grouped = useMemo(() => {
    const groups = {
      Assets: [],
      Liabilities: [],
      Equity: [],
      Income: [],
      Expenses: [],
      Other: [],
    };

    accounts.forEach((acc) => {
      const type = (acc.type || "").toLowerCase();

      if (type.includes("asset")) groups.Assets.push(acc);
      else if (type.includes("liab")) groups.Liabilities.push(acc);
      else if (type.includes("equity")) groups.Equity.push(acc);
      else if (type.includes("income")) groups.Income.push(acc);
      else if (type.includes("expense")) groups.Expenses.push(acc);
      else groups.Other.push(acc);
    });

    return groups;
  }, [accounts]);

  // ================= FILTER =================
  const filteredAccounts = (list) =>
    list.filter(
      (a) =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.code.toLowerCase().includes(search.toLowerCase())
    );

  // ================= FORMAT =================
  const format = (n) =>
    Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
    });

  // ================= CATEGORY TOTAL =================
  const getGroupTotal = (list) => {
    return list.reduce((sum, acc) => {
      const b = getBalance(acc.id).balance;
      return sum + b;
    }, 0);
  };

  // ================= UI =================
  return (
    <div className="min-h-screen bg-gray-100 p-6">

      {/* HEADER */}
      <div className="bg-white p-5 rounded-xl shadow mb-6">
        <h1 className="text-2xl font-bold text-gray-800">
          Chart of Accounts (Core Banking)
        </h1>
        <p className="text-sm text-gray-500">
          Structured General Ledger System
        </p>
      </div>

      {/* SEARCH */}
      <div className="mb-4">
        <input
          placeholder="Search account code or name..."
          className="w-full md:w-1/3 p-2 border rounded"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ================= GROUP RENDER ================= */}
      {Object.entries(grouped).map(([groupName, list]) => {
        const filtered = filteredAccounts(list);

        if (!filtered.length) return null;

        return (
          <div key={groupName} className="mb-8">

            {/* GROUP HEADER */}
            <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow mb-3">
              <h2 className="font-bold text-lg">{groupName}</h2>

              <span className="text-sm font-semibold text-gray-600">
                Total: {format(getGroupTotal(filtered))}
              </span>
            </div>

            {/* TABLE */}
            <div className="bg-white rounded-xl shadow overflow-x-auto">

              <table className="w-full text-sm">

                <thead className="bg-gray-200">
                  <tr>
                    <th className="p-3 text-left">Code</th>
                    <th className="p-3 text-left">Account Name</th>
                    <th className="p-3">Type</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Credit</th>
                    <th className="p-3 text-right">Balance</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((acc) => {
                    const bal = getBalance(acc.id);

                    return (
                      <tr
                        key={acc.id}
                        className="border-b hover:bg-gray-50"
                      >
                        <td className="p-3 font-mono">{acc.code}</td>

                        <td className="p-3 font-medium">
                          {acc.name}
                        </td>

                        <td className="p-3 text-gray-600">
                          {acc.type}
                        </td>

                        <td className="p-3 text-right">
                          {format(bal.debit)}
                        </td>

                        <td className="p-3 text-right">
                          {format(bal.credit)}
                        </td>

                        <td className="p-3 text-right font-bold">
                          {format(bal.balance)}
                        </td>

                        <td className="p-3 text-center">
                          <button
                            onClick={() =>
                              navigate(`/admin/account-ledger/${acc.id}`)
                            }
                            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded"
                          >
                            Ledger
                          </button>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>

              </table>

            </div>

          </div>
        );
      })}

    </div>
  );
}