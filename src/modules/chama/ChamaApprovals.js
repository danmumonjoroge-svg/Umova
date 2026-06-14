import React, { useState, useEffect } from 'react';

const ChamaApprovals = ({ user }) => {
    const [tasks, setTasks] = useState([]);

    useEffect(() => {
        // Fetch all pending requests from the centralized table
        api.get('/approvals/pending').then(data => setTasks(data));
    }, []);

    const processAction = async (taskId, decision) => {
        await api.post(`/approvals/${taskId}/process`, { decision });
        setTasks(tasks.filter(t => t.id !== taskId)); // Remove from list instantly
    };

    return (
        <div className="approvals-dashboard">
            <h2>Pending Approvals</h2>
            <div className="task-list">
                {tasks.map(task => (
                    <div key={task.id} className={`task-card ${task.category.toLowerCase()}`}>
                        <div className="task-info">
                            <h4>{task.category.replace('_', ' ')}</h4>
                            <p>From: {task.requested_by}</p>
                            <pre>{JSON.stringify(task.details, null, 2)}</pre>
                        </div>
                        
                        <div className="task-actions">
                            <button className="approve" onClick={() => processAction(task.id, 'approve')}>Approve</button>
                            <button className="reject" onClick={() => processAction(task.id, 'reject')}>Reject</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};