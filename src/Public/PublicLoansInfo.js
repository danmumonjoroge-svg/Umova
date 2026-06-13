import React from "react";

const PublicLoansInfo = () => {
  return (
    <div style={{ padding: 30 }}>

      <h1>🏦 Loan Products</h1>

      <section style={box}>
        <h2>Loan Types</h2>
        <ul>
          <li>Business Loan</li>
          <li>Emergency Loan</li>
          <li>School Fees Loan</li>
          <li>Development Loan</li>
          <li>Asset Financing</li>
        </ul>
      </section>

      <section style={box}>
        <h2>Eligibility Requirements</h2>
        <ul>
          <li>Must be a registered SACCO member</li>
          <li>Regular savings contribution</li>
          <li>Good repayment history</li>
          <li>Guarantors or collateral required</li>
        </ul>
      </section>

      <section style={box}>
        <h2>Loan Principles</h2>
        <ul>
          <li>Loan size depends on savings</li>
          <li>Income stability is considered</li>
          <li>Repayment capacity is reviewed</li>
        </ul>
      </section>

      <section style={footer}>
        <p>Loan approval is subject to SACCO policy.</p>
      </section>

    </div>
  );
};

const box = {
  background: "#24dc13",
  padding: 20,
  marginBottom: 15,
  borderRadius: 8,
};

const footer = {
  background: "#111827",
  color: "white",
  padding: 15,
  marginTop: 20,
  borderRadius: 8,
};

export default PublicLoansInfo;