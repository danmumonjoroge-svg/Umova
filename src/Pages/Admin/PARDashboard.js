import { useState } from "react";
import { supabase } from "../../supabaseClient";

const formatMoney = (value) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function PARDashboard() {
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState(null);

  const getRiskColor = (category) => {
    switch (category) {
      case "Current":
        return "bg-green-100 text-green-700";

      case "PAR30":
        return "bg-yellow-100 text-yellow-700";

      case "PAR60":
        return "bg-orange-100 text-orange-700";

      case "PAR90":
        return "bg-red-100 text-red-700";

      case "Loss":
        return "bg-red-700 text-white";

      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const getHealthColor = (health) => {
    switch (health) {
      case "Healthy":
        return "from-green-600 to-emerald-500";

      case "Warning":
        return "from-yellow-500 to-amber-500";

      case "Critical":
        return "from-orange-600 to-orange-500";

      default:
        return "from-red-700 to-red-500";
    }
  };

  const runPARAnalysis = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("vw_par_analysis")
        .select("*");

      if (error) throw error;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let totalPrincipal = 0;
      let totalInterest = 0;
      let totalPortfolio = 0;

      let currentAmount = 0;
      let par30Amount = 0;
      let par60Amount = 0;
      let par90Amount = 0;
      let lossAmount = 0;

      const analysed = (data || []).map((row) => {
        const principal = Number(row.principal_balance || 0);
        const interest = Number(row.interest_balance || 0);

        const outstanding = principal + interest;

        totalPrincipal += principal;
        totalInterest += interest;
        totalPortfolio += outstanding;

        const lastDate =
          row.last_principal_payment ||
          row.last_interest_payment;

        let daysOverdue = 999;

        if (lastDate) {
          const datePart = lastDate.toString().substring(0, 10);

          const [year, month, day] =
            datePart.split("-").map(Number);

          const paymentDate = new Date(
            year,
            month - 1,
            day
          );

          paymentDate.setHours(0, 0, 0, 0);

          daysOverdue = Math.floor(
            (today - paymentDate) /
              (1000 * 60 * 60 * 24)
          );

          if (daysOverdue < 0)
            daysOverdue = 0;
        }

        let category = "Current";

        if (daysOverdue > 180)
          category = "Loss";
        else if (daysOverdue > 90)
          category = "PAR90";
        else if (daysOverdue > 60)
          category = "PAR60";
        else if (daysOverdue > 30)
          category = "PAR30";

        switch (category) {
          case "Current":
            currentAmount += outstanding;
            break;

          case "PAR30":
            par30Amount += outstanding;
            break;

          case "PAR60":
            par60Amount += outstanding;
            break;

          case "PAR90":
            par90Amount += outstanding;
            break;

          case "Loss":
            lossAmount += outstanding;
            break;

          default:
            break;
        }

        return {
          ...row,
          outstanding,
          days_overdue: daysOverdue,
          category,
        };
      });

      analysed.sort(
        (a, b) => b.outstanding - a.outstanding
      );

      const par30Ratio =
        totalPortfolio > 0
          ? (
              ((par30Amount +
                par60Amount +
                par90Amount +
                lossAmount) /
                totalPortfolio) *
              100
            ).toFixed(2)
          : "0.00";

      const par60Ratio =
        totalPortfolio > 0
          ? (
              ((par60Amount +
                par90Amount +
                lossAmount) /
                totalPortfolio) *
              100
            ).toFixed(2)
          : "0.00";

      const par90Ratio =
        totalPortfolio > 0
          ? (
              ((par90Amount +
                lossAmount) /
                totalPortfolio) *
              100
            ).toFixed(2)
          : "0.00";

      let health = "Healthy";

      if (Number(par30Ratio) > 5)
        health = "Warning";

      if (Number(par30Ratio) > 10)
        health = "Critical";

      if (Number(par30Ratio) > 20)
        health = "High Risk";

      setResult({
        analysed,

        totalPrincipal,
        totalInterest,
        totalPortfolio,

        currentAmount,
        par30Amount,
        par60Amount,
        par90Amount,
        lossAmount,

        par30Ratio,
        par60Ratio,
        par90Ratio,

        health,
      });
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filtered =
    result?.analysed?.filter((row) => {
      const txt = search.toLowerCase();

      return (
        (row.member_no || "")
          .toLowerCase()
          .includes(txt) ||
        (row.member_name || "")
          .toLowerCase()
          .includes(txt)
      );
    }) || [];

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-7xl mx-auto">

        {/* HEADER */}
        <div className="bg-gradient-to-r from-green-700 to-emerald-600 text-white rounded-3xl p-6 shadow-lg mb-6">
          <h1 className="text-3xl font-bold">
            Portfolio At Risk (PAR)
          </h1>

          <p className="text-green-100 mt-2">
            Loan Portfolio Monitoring &
            Delinquency Analysis
          </p>
        </div>

        {/* ACTIONS */}
        <div className="bg-white rounded-2xl shadow p-5 mb-6">
          <button
            onClick={runPARAnalysis}
            disabled={loading}
            className="bg-green-700 hover:bg-green-800 text-white px-6 py-3 rounded-xl"
          >
            {loading
              ? "Analyzing Portfolio..."
              : "Run PAR Analysis"}
          </button>
        </div>

        {result && (
          <>
            {/* HEALTH */}
            <div
              className={`bg-gradient-to-r ${getHealthColor(
                result.health
              )} text-white rounded-3xl p-6 shadow-lg mb-6`}
            >
              <h2 className="text-2xl font-bold">
                Portfolio Health:
                {" "}
                {result.health}
              </h2>

              <div className="grid md:grid-cols-3 gap-4 mt-4">
                <div>
                  <p className="text-sm opacity-90">
                    PAR30
                  </p>
                  <p className="text-3xl font-bold">
                    {result.par30Ratio}%
                  </p>
                </div>

                <div>
                  <p className="text-sm opacity-90">
                    PAR60
                  </p>
                  <p className="text-3xl font-bold">
                    {result.par60Ratio}%
                  </p>
                </div>

                <div>
                  <p className="text-sm opacity-90">
                    PAR90
                  </p>
                  <p className="text-3xl font-bold">
                    {result.par90Ratio}%
                  </p>
                </div>
              </div>
            </div>

            {/* KPI CARDS */}
            <div className="grid lg:grid-cols-4 md:grid-cols-2 gap-4 mb-6">

              <div className="bg-white rounded-2xl shadow p-5">
                <p className="text-gray-500 text-sm">
                  Principal Portfolio
                </p>

                <h3 className="text-2xl font-bold mt-2">
                  {formatMoney(
                    result.totalPrincipal
                  )}
                </h3>
              </div>

              <div className="bg-white rounded-2xl shadow p-5">
                <p className="text-gray-500 text-sm">
                  Interest Outstanding
                </p>

                <h3 className="text-2xl font-bold mt-2">
                  {formatMoney(
                    result.totalInterest
                  )}
                </h3>
              </div>

              <div className="bg-white rounded-2xl shadow p-5">
                <p className="text-gray-500 text-sm">
                  Total Portfolio
                </p>

                <h3 className="text-2xl font-bold mt-2">
                  {formatMoney(
                    result.totalPortfolio
                  )}
                </h3>
              </div>

              <div className="bg-white rounded-2xl shadow p-5">
                <p className="text-gray-500 text-sm">
                  PAR30 Ratio
                </p>

                <h3 className="text-2xl font-bold text-red-600 mt-2">
                  {result.par30Ratio}%
                </h3>
              </div>

            </div>

            {/* BUCKETS */}
            <div className="grid lg:grid-cols-5 gap-4 mb-6">

              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p>Current</p>
                <h3 className="font-bold text-xl mt-1">
                  {formatMoney(
                    result.currentAmount
                  )}
                </h3>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <p>PAR30</p>
                <h3 className="font-bold text-xl mt-1">
                  {formatMoney(
                    result.par30Amount
                  )}
                </h3>
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <p>PAR60</p>
                <h3 className="font-bold text-xl mt-1">
                  {formatMoney(
                    result.par60Amount
                  )}
                </h3>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p>PAR90</p>
                <h3 className="font-bold text-xl mt-1">
                  {formatMoney(
                    result.par90Amount
                  )}
                </h3>
              </div>

              <div className="bg-red-900 text-white rounded-xl p-4">
                <p>Loss</p>
                <h3 className="font-bold text-xl mt-1">
                  {formatMoney(
                    result.lossAmount
                  )}
                </h3>
              </div>

            </div>

            {/* SEARCH */}
            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <input
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value)
                }
                placeholder="Search member..."
                className="w-full border rounded-xl p-3"
              />
            </div>

            {/* TABLE */}
            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <div className="p-5 border-b">
                <h2 className="font-bold text-lg">
                  Full PAR Analysis
                </h2>
              </div>

              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="p-3 text-left">
                        Member No
                      </th>

                      <th className="p-3 text-left">
                        Member Name
                      </th>

                      <th className="p-3 text-right">
                        Principal
                      </th>

                      <th className="p-3 text-right">
                        Interest
                      </th>

                      <th className="p-3 text-right">
                        Outstanding
                      </th>

                      <th className="p-3 text-center">
                        Days
                      </th>

                      <th className="p-3 text-center">
                        Category
                      </th>

                      <th className="p-3 text-center">
                        Last Payment
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filtered.map((row) => (
                      <tr
                        key={row.member_no}
                        className="border-t hover:bg-slate-50"
                      >
                        <td className="p-3">
                          {row.member_no}
                        </td>

                        <td className="p-3">
                          {row.member_name}
                        </td>

                        <td className="p-3 text-right">
                          {formatMoney(
                            row.principal_balance
                          )}
                        </td>

                        <td className="p-3 text-right">
                          {formatMoney(
                            row.interest_balance
                          )}
                        </td>

                        <td className="p-3 text-right font-bold">
                          {formatMoney(
                            row.outstanding
                          )}
                        </td>

                        <td className="p-3 text-center">
                          {row.days_overdue}
                        </td>

                        <td className="p-3 text-center">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold ${getRiskColor(
                              row.category
                            )}`}
                          >
                            {row.category}
                          </span>
                        </td>

                        <td className="p-3 text-center">
                          {row.last_principal_payment
                            ? row.last_principal_payment.substring(
                                0,
                                10
                              )
                            : "-"}
                        </td>
                      </tr>
                    ))}

                    {filtered.length === 0 && (
                      <tr>
                        <td
                          colSpan="8"
                          className="text-center p-6 text-gray-500"
                        >
                          No records found
                        </td>
                      </tr>
                    )}
                  </tbody>

                </table>
              </div>
            </div>

          </>
        )}
      </div>
    </div>
  );
}