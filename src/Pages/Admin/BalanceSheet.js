import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function BalanceSheet() {
  const [assets, setAssets] = useState([]);
  const [liabilities, setLiabilities] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: coa } = await supabase
      .from("chart_of_accounts")
      .select("*");

    const { data: gl } = await supabase
      .from("general_ledger")
      .select("*");

    let assetList = [];
    let liabilityList = [];

    coa.forEach((acc) => {
      let balance = 0;

      gl.forEach((tx) => {
        const amount = Number(tx.amount || 0);

        if (tx.debit_account_id == acc.id) {
          balance += amount;
        }

        if (tx.credit_account_id == acc.id) {
          balance -= amount;
        }
      });

      const item = {
        name: acc.name,
        balance,
      };

      if (acc.type.toLowerCase() === "asset") {
        assetList.push(item);
      } else if (acc.type.toLowerCase() === "liability") {
        liabilityList.push(item);
      }
    });

    setAssets(assetList);
    setLiabilities(liabilityList);
  };

  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0);

  return (
    <div className="p-6">

      <h1 className="text-2xl font-bold mb-4">
        Balance Sheet
      </h1>

      <div className="grid grid-cols-2 gap-6">

        {/* ASSETS */}
        <div className="bg-white p-4 shadow">

          <h2 className="text-xl font-bold mb-2">
            Assets
          </h2>

          {assets.map((a, i) => (
            <div key={i} className="flex justify-between">
              <span>{a.name}</span>
              <span>{a.balance.toFixed(2)}</span>
            </div>
          ))}

          <hr className="my-2" />

          <div className="font-bold">
            Total: {totalAssets.toFixed(2)}
          </div>

        </div>

        {/* LIABILITIES */}
        <div className="bg-white p-4 shadow">

          <h2 className="text-xl font-bold mb-2">
            Liabilities
          </h2>

          {liabilities.map((l, i) => (
            <div key={i} className="flex justify-between">
              <span>{l.name}</span>
              <span>{l.balance.toFixed(2)}</span>
            </div>
          ))}

          <hr className="my-2" />

          <div className="font-bold">
            Total: {totalLiabilities.toFixed(2)}
          </div>

        </div>

      </div>

    </div>
  );
}