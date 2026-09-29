import React from "react";
import { Link, useOutletContext } from "react-router-dom";
import { generateStatementPDF } from "../utils/generateStatementPDF";
import { Card, PageHeader } from "./ui";

// Uses the existing statement generator and existing statement screens unchanged.
export default function StatementsWorkspace() {
  const { profile, memberNo, rows, ledgerLoading, ledgerError } = useOutletContext();
  const ready = !ledgerLoading && !ledgerError;
  return (
    <>
      <PageHeader title="My Statements" description="View or download your account statements." />
      <div className="uma-grid c2">
        <Card title="Member Statement" note="Savings, shares and loans together, with running balances.">
          <div className="uma-actions">
            <Link className="uma-btn" to="/member/statement">View</Link>
            <button className="uma-btn uma-btn--ghost" disabled={!ready}
              onClick={() => generateStatementPDF({ ...profile, member_no: memberNo }, rows || [])}>Download PDF</button>
          </div>
        </Card>
        <Card title="Savings Statement" note="Every deposit and withdrawal on your savings.">
          <div className="uma-actions">
            <Link className="uma-btn" to="/member/savings">View</Link>
          </div>
          <div className="uma-note">CSV download is on the savings screen.</div>
        </Card>
        <Card title="Loan Statement" note="Loan disbursements, interest and repayments.">
          <div className="uma-actions">
            <Link className="uma-btn" to="/member/loans/manage?action=statement">View</Link>
          </div>
        </Card>
        <Card title="Shares Statement" note="Your share capital movements.">
          <div className="uma-actions">
            <Link className="uma-btn" to="/member/shares">View</Link>
          </div>
          <div className="uma-note">CSV download is on the shares screen.</div>
        </Card>
      </div>
    </>
  );
}
