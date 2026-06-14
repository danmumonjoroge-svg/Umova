import React, { useState } from "react";
import "./ChamaDashboard.css";

export default function ChamaDashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  const [showMembers, setShowMembers] = useState(false);
  const [showContributions, setShowContributions] = useState(false);
  const [showLoans, setShowLoans] = useState(false);
  const [showFines, setShowFines] = useState(false);

  // Dummy data (replace with Supabase later)
  const members = [
    { id: 1, name: "John Kamau", role: "Chairman", phone: "0712xxxxxx" },
    { id: 2, name: "Mary Wanjiku", role: "Treasurer", phone: "0722xxxxxx" },
    { id: 3, name: "Peter Mwangi", role: "Member", phone: "0733xxxxxx" },
  ];

  const contributions = [
    { id: 1, member: "John Kamau", amount: 5000, date: "2026-06-10" },
    { id: 2, member: "Mary Wanjiku", amount: 3000, date: "2026-06-11" },
  ];

  const loans = [
    { id: 1, member: "Peter Mwangi", amount: 20000, status: "Pending" },
  ];

  const fines = [
    { id: 1, member: "John Kamau", amount: 500, reason: "Late meeting" },
  ];

  return (
    <div className="dashboard-shell">

      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-nav">

          <button className={`nav-item ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}>
            📊 Overview
          </button>

          <button className="nav-item" onClick={() => setShowMembers(true)}>
            👥 Members
          </button>

          <button className="nav-item" onClick={() => setShowContributions(true)}>
            💰 Contributions
          </button>

          <button className="nav-item" onClick={() => setShowLoans(true)}>
            🏦 Loans
          </button>

          <button className="nav-item" onClick={() => setShowFines(true)}>
            ⚠️ Fines
          </button>

          <button className="nav-item">
            ❤️ Welfare
          </button>

          <button className="nav-item">
            📦 Fund
          </button>

          <button className="nav-item">
            👔 Officials
          </button>

          <button className="nav-item">
            📩 Send
          </button>

        </div>
      </aside>

      {/* MAIN AREA */}
      <main className="main-area">

        {/* OVERVIEW CARDS */}
        {activeTab === "overview" && (
          <div className="grid-cards">

            <div className="card card-emerald">
              <h4>Total Members</h4>
              <p>{members.length}</p>
            </div>

            <div className="card card-blue">
              <h4>Total Contributions</h4>
              <p>KES 8,000</p>
            </div>

            <div className="card card-amber">
              <h4>Active Loans</h4>
              <p>{loans.length}</p>
            </div>

            <div className="card card-rose">
              <h4>Pending Fines</h4>
              <p>{fines.length}</p>
            </div>

          </div>
        )}

      </main>

      {/* ================= MODALS ================= */}

      {/* MEMBERS MODAL */}
      {showMembers && (
        <div className="modal-overlay" onClick={() => setShowMembers(false)}>
          <div className="modal-content large" onClick={(e) => e.stopPropagation()}>

            <div className="modal-header">
              <h3>Members</h3>
              <button className="close-btn" onClick={() => setShowMembers(false)}>✕</button>
            </div>

            <div className="modal-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{m.role}</td>
                      <td>{m.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

      {/* CONTRIBUTIONS MODAL */}
      {showContributions && (
        <div className="modal-overlay" onClick={() => setShowContributions(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>

            <div className="modal-header">
              <h3>Contributions</h3>
              <button className="close-btn" onClick={() => setShowContributions(false)}>✕</button>
            </div>

            <div className="modal-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Amount</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {contributions.map(c => (
                    <tr key={c.id}>
                      <td>{c.member}</td>
                      <td>KES {c.amount}</td>
                      <td>{c.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

      {/* LOANS MODAL */}
      {showLoans && (
        <div className="modal-overlay" onClick={() => setShowLoans(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>

            <div className="modal-header">
              <h3>Loans</h3>
              <button className="close-btn" onClick={() => setShowLoans(false)}>✕</button>
            </div>

            <div className="modal-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map(l => (
                    <tr key={l.id}>
                      <td>{l.member}</td>
                      <td>KES {l.amount}</td>
                      <td>{l.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

      {/* FINES MODAL */}
      {showFines && (
        <div className="modal-overlay" onClick={() => setShowFines(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>

            <div className="modal-header">
              <h3>Fines</h3>
              <button className="close-btn" onClick={() => setShowFines(false)}>✕</button>
            </div>

            <div className="modal-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Amount</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {fines.map(f => (
                    <tr key={f.id}>
                      <td>{f.member}</td>
                      <td>KES {f.amount}</td>
                      <td>{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}