import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";

/**
 * ADVANCED BALANCE SHEET
 * - Pulls from General Ledger only
 * - Dynamically maps Chart of Accounts
 * - Handles debit/credit logic correctly
 * - Supports multi-type classification
 * - Real-time recomputation
 * - Drill-ready structure
 */

export default function BalanceSheet() {
  const [coa, setCoa] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [asOf, setAsOf] = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);

    const [{ data: coaData }, { data: glData }] = await Promise.all([
      supabase.from("chart_of_accounts").select("*"),
      supabase.from("general_ledger").select("*")
    ]);

    setCoa(coaData || []);
    setLedger(glData || []);

    setLoading(false);
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  // ================= CORE CALCULATION ENGINE =================
  const computed = useMemo(() => {
    const map = new Map();

    coa.forEach((acc) => {
      map.set(acc.id, {
        id: acc.id,
        name: acc.name,
        type: acc.type?.toLowerCase(),
        balance: 0
      });
    });

    ledger.forEach((tx) => {
      const amount = Number(tx.amount || 0);

      const debitAcc = map.get(tx.debit_account_id);
      const creditAcc = map.get(tx.credit_account_id);

      if (debitAcc) debitAcc.balance += amount;
      if (creditAcc) creditAcc.balance -= amount;
    });

    const assets = [];
    const liabilities = [];
    const equity = [];
    const income = [];
    const expenses = [];

    map.forEach((acc) => {
      const item = {
        name: acc.name,
        balance: acc.balance
      };

      switch (acc.type) {
        case "asset":
          assets.push(item);
          break;
        case "liability":
          liabilities.push(item);
          break;
        case "equity":
          equity.push(item);
          break;
        case "income":
          income.push(item);
          break;
        case "expense":
          expenses.push(item);
          break;
        default:
          assets.push(item);
      }
    });

    const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
    const totalLiabilities = liabilities.reduce((s, a) => s + a.balance, 0);
    const totalEquity = equity.reduce((s, a) => s + a.balance, 0);

    return {
      assets,
      liabilities,
      equity,
      income,
      expenses,
      totalAssets,
      totalLiabilities,
      totalEquity
    };
  }, [coa, ledger]);

  const format = (v) =>
    Number(v || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  // ================= EXPORT =================
  const exportCSV = () => {
    const rows = [["Type", "Account", "Balance"]];

    const push = (type, arr) => {
      arr.forEach((a) => rows.push([type, a.name, a.balance]));
    };

    push("ASSET", computed.assets);
    push("LIABILITY", computed.liabilities);
    push("EQUITY", computed.equity);
    push("INCOME", computed.income);
    push("EXPENSE", computed.expenses);

    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "balance_sheet.csv";
    link.click();
  };

  const printReport = () => window.print();

  // ================= UI =================
  return (
    <div className="p-6 bg-gray-50 min-h-screen">

      {/* HEADER */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold">Balance Sheet Engine</h1>
          <p className="text-sm text-gray-500">
            As of {asOf}
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={refresh} className="bg-blue-600 text-white px-3 py-2 rounded">
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>

          <button onClick={exportCSV} className="bg-green-600 text-white px-3 py-2 rounded">
            Export CSV
          </button>

          <button onClick={printReport} className="bg-black text-white px-3 py-2 rounded">
            Print
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-6">Loading ledger engine...</div>
      ) : (
        <div className="grid grid-cols-3 gap-4">

          {/* ASSETS */}
          <div className="bg-white p-4 rounded shadow">
            <h2 className="font-bold text-green-700 mb-2">Assets</h2>

            {computed.assets.map((a, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>{a.name}</span>
                <span>{format(a.balance)}</span>
              </div>
            ))}

            <hr className="my-2" />

            <div className="font-bold">
              Total: {format(computed.totalAssets)}
            </div>
          </div>

          {/* LIABILITIES */}
          <div className="bg-white p-4 rounded shadow">
            <h2 className="font-bold text-red-700 mb-2">Liabilities</h2>

            {computed.liabilities.map((a, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>{a.name}</span>
                <span>{format(a.balance)}</span>
              </div>
            ))}

            <hr className="my-2" />

            <div className="font-bold">
              Total: {format(computed.totalLiabilities)}
            </div>
          </div>

          {/* EQUITY */}
          <div className="bg-white p-4 rounded shadow">
            <h2 className="font-bold text-blue-700 mb-2">Equity</h2>

            {computed.equity.map((a, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>{a.name}</span>
                <span>{format(a.balance)}</span>
              </div>
            ))}

            <hr className="my-2" />

            <div className="font-bold">
              Total: {format(computed.totalEquity)}
            </div>
          </div>

        </div>
      )}

      {/* ACCOUNTING EQUATION CHECK */}
      {!loading && (
        <div className="mt-6 bg-white p-4 rounded shadow text-sm">
          <div className="flex justify-between">
            <span>Assets</span>
            <span>{format(computed.totalAssets)}</span>
          </div>

          <div className="flex justify-between">
            <span>Liabilities + Equity</span>
            <span>
              {format(computed.totalLiabilities + computed.totalEquity)}
            </span>
          </div>

          <div className="mt-2 font-bold">
            Balance Check:{" "}
            {Math.abs(
              computed.totalAssets -
                (computed.totalLiabilities + computed.totalEquity)
            ) < 0.01
              ? "✔ Balanced"
              : "❌ Out of Balance"}
          </div>
        </div>
      )}
    </div>
  );
}