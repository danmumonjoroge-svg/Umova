import React from "react";

const PublicSavingsInfo = () => {
  return (
    <div style={{ padding: 30 }}>

      <h1>💰 Savings Products</h1>

      <section style={box}>
        <h2>About Savings</h2>
        <p>
          Savings form the foundation of SACCO financial growth.
        </p>
      </section>

      <section style={box}>
        <h2>Savings Rules</h2>
        <ul>
          <li>Minimum monthly contribution required</li>
          <li>Encouraged regular deposits</li>
          <li>Funds are used for lending pool</li>
        </ul>
      </section>

      <section style={box}>
        <h2>Benefits</h2>
        <ul>
          <li>Loan qualification basis</li>
          <li>Dividend earnings</li>
          <li>Financial discipline</li>
        </ul>
      </section>

    </div>
  );
};

const box = {
  background: "#f3f4f6",
  padding: 20,
  marginBottom: 15,
  borderRadius: 8,
};

export default PublicSavingsInfo;