import { useEffect, useState } from "react";

// Connectivity is detected, never chosen by the user. navigator.onLine only
// says "the device has a network interface", not "Supabase is reachable" —
// so this is a hint for UI wording; every real request still has to succeed
// on its own before anything is called confirmed.
export default function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}
