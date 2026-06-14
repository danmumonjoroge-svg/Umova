import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-hot-toast';

const ChamaMembers = ({ authContext, api }) => {
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        fetchMembers();
    }, []);

    const fetchMembers = async () => {
        setLoading(true);
        try {
            // Ensure your backend endpoint fetches the aggregated financial data
            const { data } = await api.get('/members');
            setMembers(data);
        } catch (err) {
            toast.error("Failed to load members");
        } finally {
            setLoading(false);
        }
    };

    const handleMemberAction = async (memberId, action, payload = {}) => {
        if (!window.confirm(`Confirm action: ${action}?`)) return;

        try {
            await api.post(`/members/${memberId}/action`, { action, ...payload });
            toast.success("Audit log recorded & status updated.");
            fetchMembers(); 
        } catch (err) {
            toast.error("Operation unauthorized or failed.");
        }
    };

    // Memoized filter for performance with large datasets
    const filteredMembers = useMemo(() => {
        return members.filter(m => {
            const matchesView = view === 'all' || m.status === view;
            const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesView && matchesSearch;
        });
    }, [members, view, searchQuery]);

    if (loading) return <div className="loader">Loading member data...</div>;

    return (
        <div className="members-dashboard">
            <div className="toolbar">
                <input 
                    type="text" 
                    placeholder="Search members..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)} 
                />
                <select onChange={(e) => setView(e.target.value)} value={view}>
                    <option value="all">All Members</option>
                    <option value="pending">Pending Approval</option>
                    <option value="active">Active</option>
                </select>
            </div>

            <table className="members-table">
                <thead>
                    <tr>
                        <th>Member</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Savings</th>
                        <th>Loan Bal</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredMembers.length > 0 ? (
                        filteredMembers.map(m => (
                            <tr key={m.id} className={m.status}>
                                <td>{m.name}<br/><small>{m.phone}</small></td>
                                <td><span className={`badge ${m.role}`}>{m.role}</span></td>
                                <td><span className={`status-pill ${m.status}`}>{m.status}</span></td>
                                <td>KES {m.total_contributions?.toLocaleString() || 0}</td>
                                <td>KES {m.loan_balance?.toLocaleString() || 0}</td>
                                <td>
                                    {authContext?.user?.role === 'chairman' && (
                                        <div className="action-group">
                                            {m.status === 'pending' && (
                                                <button onClick={() => handleMemberAction(m.id, 'approve')}>Approve</button>
                                            )}
                                            <button onClick={() => handleMemberAction(m.id, 'suspend')}>Suspend</button>
                                            <select onChange={(e) => handleMemberAction(m.id, 'change_role', { role: e.target.value })}>
                                                <option>Change Role</option>
                                                <option value="chairman">Chairman</option>
                                                <option value="treasurer">Treasurer</option>
                                                <option value="member">Member</option>
                                            </select>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan="6" style={{ textAlign: 'center' }}>No members found matching your filters.</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

export default ChamaMembers;