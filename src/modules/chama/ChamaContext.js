import React, { createContext, useContext, useState } from "react";

const ChamaContext = createContext();

export function ChamaProvider({ children }) {
  const [chama, setChama] = useState(() => {
    return JSON.parse(localStorage.getItem("chama")) || null;
  });

  const [member, setMember] = useState(() => {
    return JSON.parse(localStorage.getItem("chama_member")) || null;
  });

  // ✅ LOGIN MUST EXIST HERE
  const login = ({ chamaData, memberData }) => {
    setChama(chamaData);
    setMember(memberData);

    localStorage.setItem("chama", JSON.stringify(chamaData));
    localStorage.setItem("chama_member", JSON.stringify(memberData));
  };

  const logout = () => {
    setChama(null);
    setMember(null);

    localStorage.removeItem("chama");
    localStorage.removeItem("chama_member");
  };

  return (
    <ChamaContext.Provider value={{ chama, member, login, logout }}>
      {children}
    </ChamaContext.Provider>
  );
}

export function useChama() {
  return useContext(ChamaContext);
}