import React from 'react';
import { useElimuAccess } from '../hooks/useElimu.js';

/** Renders children only if the signed-in person holds the Elimu action (the database still re-checks every write). */
export default function RequireElimuAction({ action, children }) {
  const { can, loaded } = useElimuAccess();
  if (!loaded) return <div className="p-4 text-sm text-slate-500">Loading...</div>;
  if (!can(action)) return <div className="p-4 text-sm text-slate-600">You do not have access to this page. Ask the school owner to give you an Elimu role.</div>;
  return children;
}
