import React, { createContext, useContext, useState, useMemo } from "react";

const ChamaContext = createContext();

export function ChamaProvider({ children }) {
  const [chama, setChama] = useState(() => JSON.parse(localStorage.getItem("chama")));
  const [member, setMember] = useState(() => JSON.parse(localStorage.getItem("chama_member")));
  const [loading, setLoading] = useState(false);

  // 1. Unified Authentication
  const login = ({ chamaData, memberData }) => {
    setChama(chamaData);
    setMember(memberData);
    localStorage.setItem("chama", JSON.stringify(chamaData));
    localStorage.setItem("chama_member", JSON.stringify(memberData));
  };

  const logout = () => {
    setChama(null);
    setMember(null);
    localStorage.clear();
  };

  // 2. Advanced Role Authorization Helper
  const hasRole = (roles) => {
    if (!member) return false;
    // Admin/Chairman overrides everything
    if (member.role === 'chairman') return true; 
    return Array.isArray(roles) ? roles.includes(member.role) : member.role === roles;
  };

  // 3. API Wrapper: Automatically injects auth headers and error handling
  const api = useMemo(() => ({
    request: async (endpoint, options = {}) => {
      const token = localStorage.getItem("auth_token"); // Assuming you store a JWT
      const headers = {
        'Content-Type': 'application/json',
        'x-chama-no': chama?.chama_no,
        'x-member-no': member?.member_no,
        ...(token && { 'Authorization': `Bearer ${token}` })
      };

      const response = await fetch(`${process.env.REACT_APP_API_URL}${endpoint}`, {
        ...options,
        headers: { ...headers, ...options.headers }
      });

      if (!response.ok) throw new Error('API Request Failed');
      return response.json();
    }
  }), [chama, member]);

  // 4. Global State Helper
  const refreshMemberData = async () => {
    if (!member) return;
    const updated = await api.request(`/members/${member.id}`);
    setMember(updated);
    localStorage.setItem("chama_member", JSON.stringify(updated));
  };

  return (
    <ChamaContext.Provider value={{ 
      chama, 
      member, 
      login, 
      logout, 
      hasRole, 
      api, 
      refreshMemberData,
      loading 
    }}>
      {children}
    </ChamaContext.Provider>
  );
}

export function useChama() {
  const context = useContext(ChamaContext);
  if (!context) throw new Error("useChama must be used within ChamaProvider");
  return context;
}