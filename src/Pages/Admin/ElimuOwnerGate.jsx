// FILE: src/Pages/Admin/ElimuOwnerGate.jsx — wraps every Elimu management page; shows a plain message to anyone who is not an Elimu owner.
import React, { useEffect, useState } from "react";
import { elimuAdmin } from "./elimuAdminApi";
import { P, Loading } from "./elimuOwnerUi";

export default function ElimuOwnerGate({ children }) {
  const [ok, setOk] = useState(null);
  useEffect(() => { elimuAdmin.isOwner().then(setOk); }, []);
  if (ok === null) return <Loading />;
  if (!ok) return (
    <div className="p-8 max-w-md mx-auto text-center">
      <h1 className="text-lg font-black" style={{ color: P.ink }}>This page is for the Elimu owner</h1>
      <p className="text-sm mt-2" style={{ color: P.muted }}>Your sign-in is not on the Elimu owners list. Ask the platform owner to add it, then reload this page.</p>
    </div>
  );
  return children;
}
