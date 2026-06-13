// src/components/Dashboard.js
import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export default function Dashboard({ user }) {
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    const fetchTransactions = async () => {
      const { data, error } = await supabase
        .from('transactions')  // your table name
        .select('*')
        .eq('member_id', user.id);  // assumes you have member_id column
      if (!error) setTransactions(data);
    };

    fetchTransactions();
  }, [user]);

  return (
    <div>
      <h2>Welcome, {user.email}</h2>
      <h3>Your Transactions:</h3>
      <ul>
        {transactions.map((tx) => (
          <li key={tx.id}>
            {tx.type} - {tx.amount} - {tx.date}
          </li>
        ))}
      </ul>
    </div>
  );
}