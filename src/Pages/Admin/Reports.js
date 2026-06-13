import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";

import {
  buildFinancialDashboard,
} from "../../utils/financialEngine";

import "./Reports.css";

const money = (v) =>
  Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function Reports() {
  const [ledger, setLedger] = useState([]);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data, error } = await supabase
      .from("general_ledger")
      .select("*"); 

    if (error) {
      console.error(error);
      return;
    }

    setLedger(data || []);
  };

  const report = useMemo(() => {
    return buildFinancialDashboard(ledger);
  }, [ledger]);

  return (
    <div className="dashboard">

      <h2 className="title">
        🏦 SACCO Financial Intelligence Dashboard
      </h2>

      <div className="grid">

        <Card title="Cashbook" value={money(Math.abs(report.cash))} />
        <Card title="Savings" value={money(report.savings)} />
        <Card title="Loans" value={money(report.loans)} />
        <Card title="Shares" value={money(report.shares)} />

        <Card title="Income" value={money(report.income)} />
        <Card title="Expenses" value={money(report.expenses)} />
        <Card title="Profit" value={money(report.profit)} />

        <Card title="Assets" value={money(report.assets)} />
        <Card title="Liabilities" value={money(report.liabilities)} />
        <Card title="Equity" value={money(report.equity)} />

        <Card
          title="PAR %"
          value={`${report.par.toFixed(2)}%`}
        />

        <Card
          title="Risk Score"
          value={report.risk.score.toFixed(2)}
        />

        <Card
          title="Risk Grade"
          value={report.risk.grade}
        />

        <Card
          title="Liquidity Ratio"
          value={report.ratios.liquidityRatio.toFixed(2)}
        />

        <Card
          title="Loan/Savings Ratio"
          value={report.ratios.loanToSavings.toFixed(2)}
        />

        <Card
          title="Savings Coverage"
          value={report.ratios.savingsCoverage.toFixed(2)}
        />

        <Card
          title="Cash Ratio"
          value={report.ratios.cashRatio.toFixed(2)}
        />

        <Card
          title="Equity Ratio"
          value={report.ratios.equityRatio.toFixed(2)}
        />

        <Card
          title="Profitability"
          value={`${(
            report.ratios.profitability * 100
          ).toFixed(2)}%`}
        />

        <Card
          title="Operating Margin"
          value={`${(
            report.ratios.operatingMargin * 100
          ).toFixed(2)}%`}
        />

        <Card
          title="12M Savings Forecast"
          value={money(report.forecast.savings12m)}
        />

        <Card
          title="12M Loan Forecast"
          value={money(report.forecast.loans12m)}
        />

        <Card
          title="12M Income Forecast"
          value={money(report.forecast.income12m)}
        />

        <Card
          title="Net Forecast"
          value={money(report.forecast.netForecast)}
        />

      </div>

      <div className="insights">

        <h3>📊 Financial Insights</h3>

        {report.insights.map((x, i) => (
          <div key={i} className="insight">
            {x}
          </div>
        ))}

      </div>

    </div>
  );
}

function Card({ title, value }) {
  return (
    <div className="card">

      <div className="card-title">
        {title}
      </div>

      <div className="card-value">
        {value}
      </div>

    </div>
  );
}