import { useState, useEffect } from "react";

export function useMemberSession() {
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      const data = localStorage.getItem("member");

      if (data) {
        setMember(JSON.parse(data));
      } else {
        setMember(null);
      }

      setLoading(false);
    };

    load();

    window.addEventListener("storage", load);

    return () => window.removeEventListener("storage", load);
  }, []);

  return { member, loading };
}