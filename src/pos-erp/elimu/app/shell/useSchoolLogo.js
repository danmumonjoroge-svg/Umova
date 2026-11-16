// elimu/app/shell/useSchoolLogo.js -- the school's logo from the shared business profile (lb_businesses.logo_url, set by the owner under Settings).
// Best effort and silent: no logo / no access / offline => null and the header shows the school's initials. Cached per business for the page's life.
import { useEffect, useState } from 'react';
import { supabase } from '../../services/platform.js';
import { safeLogoUrl } from './branding.js';

const cache = new Map();
export function useSchoolLogo(school) {
  const id = school?.businessId || null;
  const [logo, setLogo] = useState(id && cache.has(id) ? cache.get(id) : null);
  useEffect(() => {
    if (!id) { setLogo(null); return undefined; }
    if (cache.has(id)) { setLogo(cache.get(id)); return undefined; }
    let alive = true;
    Promise.resolve(supabase.from('lb_businesses').select('logo_url').eq('id', id).maybeSingle())
      .then(({ data }) => { const u = safeLogoUrl(data?.logo_url); cache.set(id, u); if (alive) setLogo(u); })
      .catch(() => { if (alive) setLogo(null); });
    return () => { alive = false; };
  }, [id]);
  return logo;
}
