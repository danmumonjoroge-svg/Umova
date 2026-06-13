import React from "react";

const PublicMembershipInfo = () => {
  return (
    <div style={{ padding: 30 }}>

      <h1>👥 Membership</h1>

      <section style={box}>
        <h2>Who Can Join</h2>
        <p>Any eligible individual willing to save and participate.</p>
      </section>

      <section style={box}>
        <h2>Requirements</h2>
        <ul>
          <li>National ID</li>
          <li>Registration form</li>
          <li>Initial savings contribution</li>
        </ul>
      </section>

      <section style={box}>
        <h2>How to Join</h2>
        <ol>
          <li>Fill application form</li>
          <li>Submit documents</li>
          <li>Start saving</li>
        </ol>
      </section>

      <section style={box}>
        <h2>Benefits</h2>
        <ul>
          <li>Access to loans</li>
          <li>Dividends</li>
          <li>Financial support system</li>
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

export default PublicMembershipInfo;