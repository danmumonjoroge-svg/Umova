import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";

const ChamaFunds = ({ chamaId, user }) => {
  const [form, setForm] = useState({
    type: "deposit",
    amount: "",
    from_source: "",
    to_destination: "",
    asset_name: "",
    asset_value: "",
    description: ""
  });

  const [data, setData] = useState([]);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data } = await supabase
      .from("chama_fund_movements")
      .select("*")
      .eq("chama_id", chamaId);

    setData(data || []);
  };

  const submit = async () => {
    await supabase.from("chama_fund_movements").insert([
      {
        ...form,
        chama_id: chamaId,
        created_by: user.id
      }
    ]);

    load();
  };

  return (
    <div>
      <h2>Funds Management</h2>

      <select
        onChange={(e) => setForm({ ...form, type: e.target.value })}
      >
        <option value="deposit">Deposit</option>
        <option value="withdrawal">Withdrawal</option>
        <option value="transfer">Transfer</option>
        <option value="investment">Investment</option>
        <option value="asset">Asset Purchase</option>
      </select>

      <input
        placeholder="Amount"
        onChange={(e) => setForm({ ...form, amount: e.target.value })}
      />

      <input
        placeholder="From (e.g KCB Bank)"
        onChange={(e) => setForm({ ...form, from_source: e.target.value })}
      />

      <input
        placeholder="To (e.g CIC Money Market)"
        onChange={(e) => setForm({ ...form, to_destination: e.target.value })}
      />

      <input
        placeholder="Asset name (e.g 3 sheep)"
        onChange={(e) => setForm({ ...form, asset_name: e.target.value })}
      />

      <input
        placeholder="Asset value"
        onChange={(e) => setForm({ ...form, asset_value: e.target.value })}
      />

      <textarea
        placeholder="Description"
        onChange={(e) => setForm({ ...form, description: e.target.value })}
      />

      <button onClick={submit}>Save Movement</button>

      <hr />

      {data.map((d) => (
        <div key={d.id}>
          <b>{d.type}</b> - {d.amount}
          <br />
          {d.from_source} → {d.to_destination}
          <br />
          {d.asset_name && `${d.asset_name} (${d.asset_value})`}
        </div>
      ))}
    </div>
  );
};

export default ChamaFunds;