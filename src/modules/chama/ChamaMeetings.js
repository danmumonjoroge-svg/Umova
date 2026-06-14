import React, { useState, useEffect } from 'react';
import { useChama } from './ChamaContext';

const ChamaMeetings = () => {
    const { api, hasRole } = useChama();
    const [meetings, setMeetings] = useState([]);
    const [activeMeeting, setActiveMeeting] = useState(null);

    useEffect(() => {
        api.request('/meetings').then(setMeetings);
    }, []);

    // Function to toggle attendance during a meeting
    const toggleAttendance = async (meetingId, memberId) => {
        await api.request(`/meetings/${meetingId}/attendance`, {
            method: 'PATCH',
            body: JSON.stringify({ memberId })
        });
        // Logic to update local state...
    };

    return (
        <div className="meetings-dashboard">
            <h2>Chama Meetings & Minutes</h2>

            {/* Upcoming Meetings View */}
            <div className="meeting-list">
                {meetings.map(m => (
                    <div key={m.id} className="meeting-card">
                        <h3>{m.title}</h3>
                        <p>{new Date(m.meeting_date).toLocaleDateString()}</p>
                        
                        {/* Only Secretary/Chairman can Edit Minutes/Start Meetings */}
                        {hasRole(['secretary', 'chairman']) && (
                            <button onClick={() => setActiveMeeting(m)}>Manage Meeting</button>
                        )}
                    </div>
                ))}
            </div>

            {/* Advanced Meeting Management Panel */}
            {activeMeeting && (
                <div className="meeting-modal">
                    <h3>Minutes for: {activeMeeting.title}</h3>
                    <textarea 
                        defaultValue={activeMeeting.minutes}
                        placeholder="Type official minutes here..."
                        onChange={(e) => { /* Auto-save logic */ }}
                    />
                    
                    <h4>Attendance</h4>
                    <div className="attendance-grid">
                        {/* List of members with checkboxes */}
                    </div>
                    
                    <button onClick={() => setActiveMeeting(null)}>Close & Save</button>
                </div>
            )}
        </div>
    );
};