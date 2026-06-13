import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CSVLink } from 'react-csv';

function Transactions() {
  const { type } = useParams();
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    // TODO: Replace with actual Supabase fetch
    const dummyData = [
      { id: 1, date: '2026-03-01', amount: 1000, description: 'Deposit' },
      { id: 2, date: '2026-03-05', amount: -500, description: 'Loan Payment' }
    ];
    setTransactions(dummyData);
  }, [type]);

  const headers = [
    { label: 'Date', key: 'date' },
    { label: 'Amount', key: 'amount' },
    { label: 'Description', key: 'description' }
  ];

  return (
    <div style={{ padding: '20px' }}>
      <h2>{type.charAt(0).toUpperCase() + type.slice(1)} Transactions</h2>

      <table border="1" cellPadding="10">
        <thead>
          <tr>
            <th>Date</th>
            <th>Amount</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map(tx => (
            <tr key={tx.id}>
              <td>{tx.date}</td>
              <td>{tx.amount}</td>
              <td>{tx.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <br />
      <CSVLink data={transactions} headers={headers} filename={`${type}-statement.csv`}>
        Download Statement
      </CSVLink>
    </div>
  );
}

export default Transactions;