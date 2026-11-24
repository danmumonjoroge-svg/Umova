// FILE: src/Pages/Admin/ElimuNavBadge.jsx — put next to the "Elimu" item in the admin sidebar: a red number of new messages from schools and parents.
// Checks every minute while the admin area is open. Shows nothing for anyone who is not an Elimu owner or when there is nothing new.
import React, { useEffect, useState } from "react";
import { elimuAdmin } from "./elimuAdminApi";

export default function ElimuNavBadge() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true; const tick = () => elimuAdmin.unread().then((v) => live && setN(v));
    tick(); const id = setInterval(tick, 60000); return () => { live = false; clearInterval(id); };
  }, []);
  if (!n) return null;
  return <span aria-label={`${n} new Elimu messages`} className="ml-2 inline-flex min-w-[20px] h-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">{n > 99 ? "99+" : n}</span>;
}
