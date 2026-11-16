// Stubs of the host modules platform.js imports (PermissionsContext, usePosErpAuth, CardKit, Sheet, brand, businessIdentity).
import React from 'react';
export const usePermissions = () => ({ can: () => true, canAny: () => true, isOwner: true, loaded: true });
export const RequirePermission = ({ children }) => children;
export const usePosErpAuth = () => ({ tenant: { id: 't1', business_name: 'Sunrise Academy' }, posStaffId: 'u1', staffName: 'Tester' });
export const getRegisteredBusinessName = () => 'Sunrise Academy';
export const BRAND = {};
export const POSAuthProvider = ({ children }) => children;
export const usePOSAuth = () => ({ authStage: 'authenticated', staff: { id: 'u1', name: 'Tester', role: 'owner' }, tenant: { id: 't1', business_code: 'DEMOSCH', business_name: 'Sunrise Academy', business_id: 'b1' }, isOwner: true, login: async () => ({ ok: true }), signup: async () => ({ ok: true }), logout() {} });
export const POSForcePasswordChange = () => <div>force</div>;
const Box = ({ children }) => <div>{children}</div>;
export const Pill = Box; export const FitPage = ({ title, children, toolbar, summary, action }) => <div><h1>{title}</h1>{action}{toolbar}{summary}{children}</div>;
export const AddButton = Box, SearchBox = () => null, FilterChips = () => null, MiniStats = () => null, CardGrid = Box, IconBtn = Box, DataCard = ({ title, children }) => <div>{title}{children}</div>,
  IconTile = Box, TextBtn = Box, LoadingBlock = () => <div>Loading</div>, EmptyBlock = Box, Notice = Box;
export const formCard = '', inputCls = '', saveBtnCls = '';
export default function Sheet({ title, children }) { return <section><h2>{title}</h2>{children}</section>; }
export const fieldClass = '';
