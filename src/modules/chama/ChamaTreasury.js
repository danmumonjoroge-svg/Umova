import React, { useState, useEffect } from 'react';

const ChamaTreasury = ({ user }) => {
    const [accounts, setAccounts] = useState([]);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        // Fetch accounts and calculate total
        fetchAccounts();
    }, []);

    const fetchAccounts = async () => {
        const data = await api.get('/treasury');
        setAccounts(data);
        const sum = data.reduce((acc, curr) => acc + parseFloat(curr.balance), 0);
        setTotal(sum);
    };

    return (
        <div className="treasury-container">
            <h2>Chama Treasury</h2>
            
            {/* Total Balance Summary Card */}
            <div className="total-balance-card">
                <p>Total Net Worth</p>
                <h1>KES {total.toLocaleString()}</h1>
            </div>

            {/* Detailed Account List */}
            <div className="account-list">
                {accounts.map(acc => (
                    <div key={acc.id} className="account-card">
                        <div>
                            <h3>{acc.account_name}</h3>
                            <small>{acc.account_type}</small>
                        </div>
                        <div className="balance">
                            KES {parseFloat(acc.balance).toLocaleString()}
                        </div>
                        {user.role === 'treasurer' && (
                            <button onClick={() => handleUpdate(acc.id)}>Update Balance</button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};