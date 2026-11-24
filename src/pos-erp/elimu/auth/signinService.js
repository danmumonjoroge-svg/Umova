// Writes the sign-in to the school's activity log (elimu_1021). Best effort and once per tab session.
import { rpc } from '../shared/services/elimuDb';

export const signinService = {
  async record() {
    try {
      if (sessionStorage.getItem('elimu-signin-logged')) return;
      sessionStorage.setItem('elimu-signin-logged', '1');
      const m = sessionStorage.getItem('elimu-signin-method') || 'PASSWORD';
      await rpc('elimu_record_signin', { p_method: m });
    } catch { /* never block the app */ }
  },
  /** Called on sign-out so the next sign-in in the same tab is logged too. */
  reset() { try { sessionStorage.removeItem('elimu-signin-logged'); sessionStorage.removeItem('elimu-signin-method'); } catch { /* ignore */ } },
};
