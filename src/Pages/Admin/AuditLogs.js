import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function AuditLogs() {

  const [logs, setLogs] = useState([]);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {

    const { data } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    setLogs(data || []);
  };

  return (
    <div style={{ padding: 20 }}>

      <h2>Audit Logs</h2>

      <table border="1" width="100%">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Action</th>
            <th>Table</th>
            <th>Time</th>
          </tr>
        </thead>

        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{log.user_name}</td>
              <td>{log.role}</td>
              <td>{log.action}</td>
              <td>{log.table_name}</td>
              <td>{new Date(log.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>

      </table>

    </div>
  );
}