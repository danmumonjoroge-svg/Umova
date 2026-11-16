// elimu/app/auth/hostAdapter.js -- the DEFAULT auth adapter: Elimu's session over the shared Umova identity (POSAuthProvider).
// This is the only auth file that imports the host. A failed host login is turned into an ElimuAuthError; nothing here shows UI.
import { usePOSAuth } from '../../services/platform.js';
import { ElimuAuthError, errorFromHostResult } from './authAdapter.js';

export const hostAdapter = {
  id: 'umova-host',
  useIdentity() {
    const a = usePOSAuth();
    return {
      stage: a.authStage,
      school: a.tenant || null,
      user: a.staff ? { id: a.staff.id, name: a.staff.name ?? a.staff.full_name ?? '', kind: 'staff', isOwner: !!a.isOwner } : null,
      statusDetail: a.statusDetail ?? null,
      logoutNotice: a.logoutNotice ?? null,
      offline: !!a.offlineSession,
      async signIn({ schoolCode, identifier, password }) {
        let r;
        try { r = await a.login(schoolCode, identifier, password); }
        catch (e) { throw new ElimuAuthError(/network|fetch|offline/i.test(String(e?.message)) ? 'OFFLINE' : 'UNKNOWN'); }
        if (!r?.ok) throw errorFromHostResult(r);
      },
      async signOut() { await a.logout(); },
    };
  },
};
