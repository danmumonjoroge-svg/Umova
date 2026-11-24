// Help centre: searchable guidance plus contact buttons. Used by staff (route "help") and the parent app (works signed out too).
import React, { useState } from 'react';
import { SUPPORT, phoneLink, whatsappLink, emailLink } from './supportContacts.js';
import { PARENT_HELP, STAFF_HELP, search } from './helpContent.js';
import { humanMessage } from '../utils/humanError.js';

const btn = 'inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl text-sm font-medium border border-[#DDD6B6] bg-white text-[#12261F]';
export function ContactCard({ support = SUPPORT, onLog }) {
  const links = [['Call us', phoneLink(support), support.phone], ['WhatsApp', whatsappLink(support), support.whatsapp], ['Email', emailLink(support), support.email]].filter((l) => l[1]);
  return (
    <section className="rounded-2xl border border-[#E3DBB8] bg-white p-4" aria-label="Contact support">
      <h2 className="font-semibold text-[#12261F]">Still need help?</h2>
      <p className="text-sm text-slate-600 mt-1">{support.name} is happy to help.{support.hours ? ` We are available ${support.hours}.` : ''}</p>
      <div className="flex flex-wrap gap-2 mt-3">{links.map(([label, href]) => <a key={label} href={href} className={btn} onClick={() => { try { const p = onLog?.(label === 'Call us' ? 'call' : label.toLowerCase()); p?.catch?.(() => {}); } catch { /* logging must never block a call */ } }} target={label === 'WhatsApp' ? '_blank' : undefined} rel="noreferrer">{label}</a>)}</div>
      {support.phone && <p className="text-xs text-slate-500 mt-2">{support.phone}{support.email ? ` · ${support.email}` : ''}</p>}
    </section>
  );
}
export default function HelpCentre({ audience = 'staff', support = SUPPORT, onLog }) {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(''); const [msg, setMsg] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); setNote(''); try { await onLog('message', msg); setMsg(''); setNote('Thank you. Your message has been sent. We will get back to you.'); } catch (e) { setNote(humanMessage(e)); } finally { setBusy(false); } };
  const all = audience === 'parent' ? PARENT_HELP : STAFF_HELP;
  const list = search(all, q);
  return (
    <div className="max-w-2xl mx-auto p-3 space-y-4">
      <div><h1 className="text-xl font-bold text-[#12261F]">Help</h1><p className="text-sm text-slate-600">Quick answers, written in plain language.</p></div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for help, e.g. password" aria-label="Search help" className="w-full h-12 rounded-xl border border-[#DDD6B6] px-4 bg-white" />
      <div className="space-y-2">
        {list.length === 0 && <p className="text-sm text-slate-600">We could not find an answer for that. Please contact us below and we will help you.</p>}
        {list.map((a) => (
          <div key={a.id} className="rounded-xl border border-[#E3DBB8] bg-white">
            <button type="button" onClick={() => setOpen(open === a.id ? '' : a.id)} aria-expanded={open === a.id} className="w-full text-left px-4 min-h-[48px] font-medium text-sm text-[#12261F]">{a.title}</button>
            {open === a.id && <div className="px-4 pb-3 space-y-2 text-sm text-slate-700">{a.body.map((p, i) => <p key={i}>{p}</p>)}</div>}
          </div>))}
      </div>
      <ContactCard support={support} onLog={onLog && ((ch) => onLog(ch))} />
      {onLog && (
        <section className="rounded-2xl border border-[#E3DBB8] bg-white p-4"><h2 className="font-semibold text-[#12261F]">Send us a message</h2>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} maxLength={1000} aria-label="Your message" placeholder="Tell us what you need help with" className="w-full mt-2 rounded-xl border border-[#DDD6B6] p-3 bg-white" />
          <button type="button" disabled={busy || msg.trim().length < 3} onClick={send} className="mt-2 min-h-[44px] px-4 rounded-xl bg-[#1F6B45] text-white text-sm font-medium disabled:opacity-60">{busy ? 'Sending…' : 'Send message'}</button>
          {note && <p role="status" className="text-sm mt-2 text-slate-700">{note}</p>}</section>)}
    </div>
  );
}
