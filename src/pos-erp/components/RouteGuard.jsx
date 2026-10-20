// src/pos-erp/components/RouteGuard.jsx
//
// Page-level permission check for every /pos/* page (rules live in
// ROUTE_PERMISSIONS, utils/permissions.js). Replaces the bare <Outlet/> in POSLayout.
// Convenience layer only: the database enforces the same permissions on the data.

import React from 'react';
import { Outlet, useLocation, Navigate, Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { canAccessPath } from '../utils/permissions';

export function useAccess() {
  const { can, isOwner } = usePosErpAuth();
  return (path) => canAccessPath(path, can, isOwner);
}

export default function RouteGuard() {
  const { pathname } = useLocation();
  const access = useAccess();
  if (access(pathname)) return <Outlet />;
  // The till is the default landing page; people without sales access go Home instead of a dead end.
  if (pathname === '/pos' || pathname === '/pos/') return <Navigate to="/pos/dashboard" replace />;
  return (
    <div className="p-6 max-w-md mx-auto text-center">
      <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-3"><ShieldAlert size={24} /></div>
      <h1 className="font-bold text-[#26352D] text-lg">You do not have access to this page</h1>
      <p className="text-sm text-[#68756D] mt-1">Ask the business owner if you need it.</p>
      <Link to="/pos/dashboard" className="inline-block mt-4 text-sm font-semibold text-emerald-800 underline">Go to Home</Link>
    </div>
  );
}
