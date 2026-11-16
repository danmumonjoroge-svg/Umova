// elimu/app/auth/ElimuAuthContext.jsx -- provides the ElimuSession. Everything inside the Elimu app reads it with useElimuSession();
// only the sign-in screens use useElimuAuth().signIn. The Elimu permission fetch (elimu_my_access) starts only once someone is signed in.
import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { ElimuAccessProvider, useElimuAccess } from '../../hooks/useElimu.js';
import { hostAdapter } from './hostAdapter.js';
import { buildSession } from './session.js';
import { validateLoginForm } from './identifiers.js';
import { AUTH_ERROR, ElimuAuthError } from './authAdapter.js';

const Ctx = createContext(null);

function Authed({ identity, actions, children }) {
  const access = useElimuAccess();           // nearest ElimuAccessProvider (below), else its own fetch
  const session = useMemo(() => buildSession({ identity, access }), [identity.stage, identity.school, identity.user, identity.offline, access]);
  return <Ctx.Provider value={{ session, ...actions }}>{children}</Ctx.Provider>;
}

/** props: adapter (default: shared Umova identity), accessOverride (tests/hosts: skips the permissions fetch) */
export function ElimuAuthProvider({ adapter = hostAdapter, accessOverride, children }) {
  const identity = adapter.useIdentity();
  const { signIn: rawSignIn, signOut: rawSignOut } = identity;
  const signIn = useCallback(async (form) => {
    const v = validateLoginForm(form);
    if (!v.ok) throw new ElimuAuthError(AUTH_ERROR.INVALID_CREDENTIALS, Object.values(v.errors)[0]);
    await rawSignIn(v.value);
  }, [rawSignIn]);
  const signOut = useCallback(() => rawSignOut(), [rawSignOut]);
  const actions = useMemo(() => ({ signIn, signOut }), [signIn, signOut]);

  if (identity.stage === 'authenticated') {
    return <ElimuAccessProvider value={accessOverride}><Authed identity={identity} actions={actions}>{children}</Authed></ElimuAccessProvider>;
  }
  const session = buildSession({ identity });
  return <Ctx.Provider value={{ session, ...actions }}>{children}</Ctx.Provider>;
}

export function useElimuAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useElimuAuth must be used inside <ElimuAuthProvider>');
  return c;
}
/** The current ElimuSession, plus signOut. */
export function useElimuSession() {
  const { session, signOut } = useElimuAuth();
  return useMemo(() => ({ ...session, signOut }), [session, signOut]);
}
