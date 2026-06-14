import React, { useState, useEffect } from 'react';
import { useChama } from './ChamaContext';

const ChamaNotifications = () => {
    const { api } = useChama();
    const [inbox, setInbox] = useState([]);

    useEffect(() => {
        // Fetch all relevant updates for this member
        api.request('/user/inbox').then(setInbox);
    }, []);

    return (
        <div className="inbox-container">
            <h2>Activity Inbox</h2>
            <div className="inbox-list">
                {inbox.map(item => (
                    <div key={item.id} className={`inbox-item ${item.priority}`}>
                        <div className="item-meta">
                            <span className="category">{item.category}</span>
                            <span className="date">{new Date(item.created_at).toLocaleDateString()}</span>
                        </div>
                        <h4>{item.title}</h4>
                        <p>{item.message}</p>
                        
                        {/* Action Buttons for items requiring user attention */}
                        {item.requires_action && (
                            <button className="btn-action" onClick={() => handleTask(item)}>
                                {item.action_label || 'View Details'}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};