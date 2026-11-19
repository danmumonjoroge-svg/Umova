// elimu/theme/ThemeSwitcher.jsx -- the colour button for the top bar. Opens a panel with ready-made colour mixes and "Our colours".
import React, { useEffect, useState } from 'react';
import { Palette, Check, X } from 'lucide-react';
import { THEMES, MIXES, customTheme, isHex } from './themes.js';
import { useElimuTheme } from './useElimuTheme.jsx';

const Swatch = ({ vars, size = 36 }) => (
  <span aria-hidden="true" className="relative inline-block rounded-full overflow-hidden border border-black/10 shrink-0" style={{ width: size, height: size, background: `linear-gradient(135deg, ${vars.primary}, ${vars.primary2 || vars.primary})` }}>
    <span className="absolute inset-y-0 right-0" style={{ width: '30%', background: vars.accent }} />
    <span className="absolute inset-x-0 bottom-0" style={{ height: '30%', background: vars.dark, clipPath: 'polygon(0 100%,100% 100%,100% 0)' }} />
  </span>
);

export default function ThemeSwitcher({ tone = 'light', className = '' }) {
  const { theme, saved, choose } = useElimuTheme();
  const [open, setOpen] = useState(false);
  const [p, setP] = useState(saved.primary || theme.vars.primary); const [a, setA] = useState(saved.accent || theme.vars.accent); const [b2, setB2] = useState(saved.second || '');
  useEffect(() => { if (open) { setP(saved.primary || theme.vars.primary); setA(saved.accent || theme.vars.accent); setB2(saved.second || ''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) return undefined; const k = (e) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open]);
  const btn = tone === 'dark' ? 'text-white hover:bg-white/10 active:bg-white/10' : 'text-[#23382B] hover:bg-black/5 active:bg-black/5';
  const preview = customTheme(p, a, b2).vars;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Change colours" title="Change colours" className={`h-10 w-10 flex items-center justify-center rounded-full ${btn} ${className}`}><Palette size={19} /></button>
      {open && (
        <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Choose colours">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 sm:inset-x-auto sm:bottom-auto sm:top-16 sm:right-4 sm:w-[22rem] max-h-[85dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white text-[#23382B] shadow-2xl border border-black/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between mb-3"><div><div className="font-bold">School colours</div><div className="text-xs opacity-70">Pick a look for your school. It is remembered on this device.</div></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-black/5"><X size={18} /></button></div>
            {[['Colour mixes', MIXES], ['One colour', THEMES]].map(([title, list]) => (
              <div key={title} className="mb-3"><div className="text-[11px] font-bold uppercase tracking-wide opacity-60 mb-1.5">{title}</div>
                <div className="grid grid-cols-3 gap-2">
                  {list.map((t) => { const on = saved.id === t.id || (!saved.id && t.id === 'forest'); return (
                    <button key={t.id} type="button" onClick={() => choose({ id: t.id })} aria-pressed={on} className={`relative flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-[11.5px] leading-tight text-center font-semibold ${on ? 'border-2' : 'border-black/10 hover:bg-black/5'}`} style={on ? { borderColor: t.vars.primary } : undefined}>
                      <Swatch vars={t.vars} />{t.name}{on && <span className="absolute top-1 right-1 h-4 w-4 rounded-full flex items-center justify-center text-white" style={{ background: t.vars.primary }}><Check size={11} strokeWidth={3} /></span>}
                    </button>); })}
                </div></div>))}
            <div className="mt-4 rounded-xl border border-black/10 p-3">
              <div className="flex items-center gap-2 mb-2"><Swatch vars={preview} size={28} /><div className="text-sm font-bold">Our colours</div>{saved.id === 'custom' && <span className="text-[11px] font-semibold text-[#1F6B45]">in use</span>}</div>
              <div className="grid grid-cols-3 gap-2 text-xs font-medium">
                <label className="flex flex-col gap-1">Main<input type="color" value={isHex(p) ? p : '#1F6B45'} onChange={(e) => setP(e.target.value)} className="h-9 w-full rounded-lg border border-black/10 bg-white p-0.5" /></label>
                <label className="flex flex-col gap-1">Accent<input type="color" value={isHex(a) ? a : '#C9A227'} onChange={(e) => setA(e.target.value)} className="h-9 w-full rounded-lg border border-black/10 bg-white p-0.5" /></label>
                <label className="flex flex-col gap-1">Blend into<input type="color" value={isHex(b2) ? b2 : p} onChange={(e) => setB2(e.target.value)} className="h-9 w-full rounded-lg border border-black/10 bg-white p-0.5" /></label>
              </div>
              <p className="text-[11px] opacity-60 mt-1.5">"Blend into" makes buttons and the top bar fade from the main colour into this one, like gold into green.</p>
              <button type="button" onClick={() => choose({ id: 'custom', primary: p, accent: a, second: isHex(b2) && b2.toLowerCase() !== p.toLowerCase() ? b2 : '' })} className="mt-3 w-full min-h-[44px] rounded-xl text-sm font-semibold" style={{ background: preview.primary, color: preview.onPrimary }}>Use these colours</button>
            </div>
            <button type="button" onClick={() => choose({ id: 'forest' })} className="mt-3 w-full text-xs font-semibold underline opacity-70">Back to the original green</button>
          </div>
        </div>)}
    </>
  );
}
