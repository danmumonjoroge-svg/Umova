import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import "./chamamembers.css";

import { Users, Search, RefreshCcw, Phone, Shield } from "lucide-react";

const ChamaMembers = ({ chamaId }) => {
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  /* ================= FETCH MEMBERS ================= */
  const fetchMembers = async () => {
    setLoading(true);

    let query = supabase.from("chama_members").select("*");

    // IMPORTANT: filter by chama_id (multi-chama support)
    if (chamaId) {
      query = query.eq("chama_id", chamaId);
    }

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });

    if (!error) setMembers(data || []);

    setLoading(false);
  };

  useEffect(() => {
    fetchMembers();
  }, [chamaId]);

  /* ================= FILTER ================= */
  const filtered = useMemo(() => {
    return members.filter((m) =>
      (m.name || "").toLowerCase().includes(search.toLowerCase())
    );
  }, [members, search]);

  /* ================= ROLE BADGE ================= */
  const getRoleColor = (role) => {
    switch (role) {
      case "chair":
        return "role-chair";
      case "treasurer":
        return "role-treasurer";
      case "secretary":
        return "role-secretary";
      default:
        return "role-member";
    }
  };

  return (
    <div className="members-container">

      {/* HEADER */}
      <div className="members-header">

        <div className="members-title">
          <Users size={18} />
          Chama Members
        </div>

        <div className="members-actions">

          <div className="members-search">
            <Search size={14} />
            <input
              placeholder="Search member..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <button className="refresh-btn" onClick={fetchMembers}>
            <RefreshCcw size={14} /> Refresh
          </button>

        </div>

      </div>

      {/* TABLE */}
      <div className="table-wrapper">

        {loading ? (
          <p className="p-4 text-slate-500">Loading members...</p>
        ) : (

          <table className="members-table">

            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>

              {filtered.map((m) => (
                <tr key={m.id}>

                  <td className="name-cell">
                    <Users size={14} /> {m.name}
                  </td>

                  <td>
                    <Phone size={14} /> {m.phone || "N/A"}
                  </td>

                  <td>
                    <span className={`role-badge ${getRoleColor(m.role)}`}>
                      <Shield size={12} /> {m.role || "member"}
                    </span>
                  </td>

                  <td>
                    <span
                      className={
                        m.status === "active"
                          ? "status-active"
                          : "status-inactive"
                      }
                    >
                      {m.status || "active"}
                    </span>
                  </td>

                </tr>
              ))}

            </tbody>

          </table>

        )}

      </div>

    </div>
  );
};

export default ChamaMembers;