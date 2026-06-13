import React, {
  useEffect,
  useMemo,
  useState
} from "react";

import { supabase } from "../../supabaseClient";

import {
  Scale,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Wallet,
  Landmark
} from "lucide-react";

export default function TrialBalance() {

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");

  const [fromDate, setFromDate] = useState(
    new Date(
      new Date().getFullYear(),
      0,
      1
    )
      .toISOString()
      .split("T")[0]
  );

  const [toDate, setToDate] = useState(
    new Date()
      .toISOString()
      .split("T")[0]
  );

  useEffect(() => {
    loadTrialBalance();
  }, []);

  const normalizeType = (type) => {

    const t = String(type || "")
      .toLowerCase()
      .replace(/[`"]/g, "")
      .trim();

    if (t.includes("asset")) return "asset";
    if (t.includes("expense")) return "expense";
    if (t.includes("income")) return "income";
    if (t.includes("liability")) return "liability";
    if (t.includes("equity")) return "equity";
    if (t.includes("capital")) return "capital";

    return "asset";
  };

  const loadTrialBalance = async () => {

    try {

      setLoading(true);

      const { data, error } =
        await supabase.rpc(
          "get_trial_balance",
          {
            p_from_date: fromDate,
            p_to_date: toDate
          }
        );

      if (error) throw error;

      const transformed =
        (data || []).map(row => {

          const type =
            normalizeType(row.type);

          const debitNature =
            type === "asset" ||
            type === "expense";

          const dr =
            Number(row.total_debits || 0);

          const cr =
            Number(row.total_credits || 0);

          let debit = 0;
          let credit = 0;

          if (debitNature) {

            const balance = dr - cr;

            if (balance >= 0) {
              debit = balance;
            } else {
              credit = Math.abs(balance);
            }

          } else {

            const balance = cr - dr;

            if (balance >= 0) {
              credit = balance;
            } else {
              debit = Math.abs(balance);
            }
          }

          return {
            ...row,
            debit,
            credit
          };
        });

      setRows(transformed);

    } catch (err) {

      console.error(err);

    } finally {

      setLoading(false);

    }
  };

  const filteredRows = useMemo(() => {

    return rows.filter(r =>

      String(r.id)
        .toLowerCase()
        .includes(search.toLowerCase())

      ||

      String(r.name)
        .toLowerCase()
        .includes(search.toLowerCase())
    );

  }, [rows, search]);

  const totals = useMemo(() => {

    return filteredRows.reduce(
      (acc, row) => {

        acc.debit += Number(row.debit || 0);
        acc.credit += Number(row.credit || 0);

        return acc;

      },
      {
        debit: 0,
        credit: 0
      }
    );

  }, [filteredRows]);

  const difference =
    Math.abs(
      totals.debit -
      totals.credit
    );

  const balanced =
    difference < 0.01;

  const money = value =>
    Number(value || 0)
      .toLocaleString(
        "en-KE",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      );

  return (

    <div className="p-6 bg-slate-950 min-h-screen text-white">

      {/* Header */}

      <div className="flex flex-wrap justify-between gap-4 mb-6">

        <div>

          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Scale />
            Trial Balance
          </h1>

          <p className="text-slate-400">
            SACCO Accounting System
          </p>

        </div>

        <button
          onClick={loadTrialBalance}
          className="
          px-4 py-2
          rounded-xl
          bg-indigo-600
          hover:bg-indigo-700
          flex items-center gap-2
          "
        >
          <RefreshCw size={16} />
          Refresh
        </button>

      </div>

      {/* Filters */}

      <div className="bg-slate-900 rounded-2xl p-4 mb-6 border border-slate-800">

        <div className="flex flex-wrap gap-4 items-end">

          <div>

            <label className="block text-xs text-slate-400 mb-1">
              From Date
            </label>

            <input
              type="date"
              value={fromDate}
              onChange={(e)=>
                setFromDate(
                  e.target.value
                )
              }
              className="
              bg-slate-800
              rounded-lg
              px-3 py-2
              "
            />

          </div>

          <div>

            <label className="block text-xs text-slate-400 mb-1">
              To Date
            </label>

            <input
              type="date"
              value={toDate}
              onChange={(e)=>
                setToDate(
                  e.target.value
                )
              }
              className="
              bg-slate-800
              rounded-lg
              px-3 py-2
              "
            />

          </div>

          <button
            onClick={loadTrialBalance}
            className="
            px-4 py-2
            bg-emerald-600
            rounded-lg
            hover:bg-emerald-700
            "
          >
            Generate
          </button>

          <div className="relative flex-1 min-w-[250px]">

            <Search
              size={18}
              className="
              absolute
              left-3
              top-3
              text-slate-400
              "
            />

            <input
              value={search}
              onChange={(e)=>
                setSearch(
                  e.target.value
                )
              }
              placeholder="Search account..."
              className="
              w-full
              bg-slate-800
              rounded-lg
              pl-10
              pr-4
              py-2
              "
            />

          </div>

        </div>

      </div>

      {/* Summary */}

      <div className="grid md:grid-cols-3 gap-4 mb-6">

        <div className="bg-slate-900 p-4 rounded-xl">
          <div className="text-slate-400 text-sm">
            Total Debits
          </div>

          <div className="text-2xl font-bold text-emerald-400">
            KES {money(totals.debit)}
          </div>
        </div>

        <div className="bg-slate-900 p-4 rounded-xl">
          <div className="text-slate-400 text-sm">
            Total Credits
          </div>

          <div className="text-2xl font-bold text-cyan-400">
            KES {money(totals.credit)}
          </div>
        </div>

        <div
          className={`p-4 rounded-xl ${
            balanced
              ? "bg-emerald-500/10 border border-emerald-500"
              : "bg-red-500/10 border border-red-500"
          }`}
        >
          <div className="text-sm">
            Status
          </div>

          <div className="font-bold mt-1">

            {balanced
              ? "✓ Balanced"
              : `Difference KES ${money(difference)}`}

          </div>
        </div>

      </div>

      {/* Table */}

      <div className="overflow-auto bg-slate-900 rounded-2xl border border-slate-800">

        <table className="w-full">

          <thead className="bg-slate-950 sticky top-0">

            <tr>

              <th className="p-4 text-left">
                Code
              </th>

              <th className="p-4 text-left">
                Account Name
              </th>

              <th className="p-4 text-left">
                Type
              </th>

              <th className="p-4 text-right">
                Debit
              </th>

              <th className="p-4 text-right">
                Credit
              </th>

            </tr>

          </thead>

          <tbody>

            {filteredRows.map(row => (

              <tr
                key={row.id}
                className="
                border-t
                border-slate-800
                hover:bg-slate-800/40
                "
              >

                <td className="p-3">
                  {row.id}
                </td>

                <td className="p-3">
                  {row.name}
                </td>

                <td className="p-3 capitalize">
                  {row.type}
                </td>

                <td className="p-3 text-right">
                  {row.debit > 0
                    ? money(row.debit)
                    : "-"}
                </td>

                <td className="p-3 text-right">
                  {row.credit > 0
                    ? money(row.credit)
                    : "-"}
                </td>

              </tr>

            ))}

          </tbody>

          <tfoot>

            <tr className="bg-slate-950 font-bold">

              <td colSpan="3" className="p-4">
                TOTAL
              </td>

              <td className="p-4 text-right text-emerald-400">
                {money(totals.debit)}
              </td>

              <td className="p-4 text-right text-cyan-400">
                {money(totals.credit)}
              </td>

            </tr>

          </tfoot>

        </table>

      </div>

    </div>
  );
}