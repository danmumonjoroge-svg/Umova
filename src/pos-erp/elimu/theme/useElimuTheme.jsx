// elimu/theme/useElimuTheme.jsx -- applies the chosen theme to <html> while Elimu is open, and removes it when Elimu closes (so the
// rest of Umova is never recoloured). Works the same in the browser (ERP) and in the Android app (same web code).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ELIMU_THEME_CSS } from './elimuThemeCss.js';
import { VAR_NAMES, loadSaved, resolve, save } from './themes.js';

const STYLE_ID = 'elimu-theme-css';
const Ctx = createContext(null);

function apply(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  let st = document.getElementById(STYLE_ID);
  if (!st) { st = document.createElement('style'); st.id = STYLE_ID; st.textContent = ELIMU_THEME_CSS; document.head.appendChild(st); }
  Object.entries(VAR_NAMES).forEach(([k, name]) => root.style.setProperty(name, theme.vars[k]));
  root.setAttribute('data-elimu-theme', theme.id);
  // the phone's status bar / browser chrome follows the dark colour
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.appendChild(meta); }
  if (!meta.dataset.elimuPrev) meta.dataset.elimuPrev = meta.getAttribute('content') || '-';
  meta.setAttribute('content', theme.vars.dark);
}
function remove() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.values(VAR_NAMES).forEach((n) => root.style.removeProperty(n));
  root.removeAttribute('data-elimu-theme');
  const st = document.getElementById(STYLE_ID); if (st) st.remove();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.dataset.elimuPrev) { if (meta.dataset.elimuPrev === '-') meta.remove(); else meta.setAttribute('content', meta.dataset.elimuPrev); delete meta.dataset.elimuPrev; }
}

/** Wrap the Elimu screens once. `tenantId` (optional) keeps one choice per school on a shared computer. */
function Inner({ tenantId, children }) {
  const [saved, setSaved] = useState(() => loadSaved(tenantId) || { id: 'forest' });
  const theme = useMemo(() => resolve(saved), [saved]);
  useEffect(() => { apply(theme); }, [theme]);
  useEffect(() => () => remove(), []);
  useEffect(() => { const s = loadSaved(tenantId); if (s) setSaved(s); }, [tenantId]);
  const choose = useCallback((value) => { setSaved(value); save(tenantId, value); }, [tenantId]);
  const value = useMemo(() => ({ theme, saved, choose }), [theme, saved, choose]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
/** Safe to nest: if a provider is already above, this one just passes through. */
export function ElimuThemeProvider({ tenantId, children }) {
  const parent = useContext(Ctx);
  return parent ? <>{children}</> : <Inner tenantId={tenantId}>{children}</Inner>;
}
export function useElimuTheme() { return useContext(Ctx) || { theme: resolve({ id: 'forest' }), saved: { id: 'forest' }, choose: () => {}, detached: true }; }

/** True inside the standalone Elimu app (/school), which already has its own top bar with the switcher. */
export const ElimuShellContext = createContext(false);
