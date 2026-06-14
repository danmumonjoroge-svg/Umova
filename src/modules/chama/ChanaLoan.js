import React, { useState } from 'react';

const ChamaLoans = ({ user }) => {
    const [view, setView] = useState('summary'); // summary, apply, manage

    return (
        <div className="loans-module">
            <div className="loans-header">
                <h2>Loan Management</h2>
                {user.role === 'member' && (
                    <button onClick={() => setView('apply')}>Apply for Loan</button>
                )}
            </div>

            {view === 'summary' && (
                <div className="loan-dashboard">
                    {/* Active Loans Table */}
                    {/* Loan Calculator Preview */}
                </div>
            )}

            {view === 'apply' && (
                <div className="loan-form">
                    <h3>Loan Calculator</h3>
                    {/* Simple formula: monthly = (P + (P * r * t)) / t */}
                    <input type="number" placeholder="Principal Amount" />
                    <input type="number" placeholder="Interest Rate %" />
                    <input type="number" placeholder="Duration (Months)" />
                    <button>Submit for Approval</button>
                </div>
            )}
        </div>
    );
};