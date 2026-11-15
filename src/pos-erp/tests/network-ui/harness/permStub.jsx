// Stand-in for navigation/PermissionsContext: same can / canAny contract, driven by the test.
export const usePermissions = () => {
  const set = new Set((globalThis.__who?.perms || '').split(',').filter(Boolean));
  return { loaded: true, isOwner: false, can: (p) => !p || set.has(p), canAny: (l) => !l || !l.length || l.some((p) => set.has(p)) };
};
export const RequirePermission = ({ children }) => children;
