// components/ContactActions.jsx
//
// One reusable row of Call / WhatsApp / SMS / Email buttons. Drop it on any record that has a person on it.
//   <ContactActions recipient={{kind:'CUSTOMER', id, name, phone, email}} purpose="PAYMENT_REMINDER" reference={{type:'SALE', id}} />
// Call dials straight away (works offline). The message buttons open the MessageComposer, pre-set to that channel, so the
// owner always sees and can edit the message before anything is sent.
import React, { useEffect, useState } from 'react';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { posSupabase } from '../services/posSupabaseClient';
import { loaders } from '../utils/comm';
import { Phone, MessageCircle, MessageSquare, Mail } from 'lucide-react';
import MessageComposer from './MessageComposer';

const BTN = 'w-10 h-10 min-w-[40px] rounded-full flex items-center justify-center border border-[#E3DBB8] bg-white text-[#1F6B45] disabled:opacity-35 disabled:cursor-not-allowed';

export default function ContactActions({ recipient, purpose, reference, inputs, size = 'md', className = '' }) {
  const [open, setOpen] = useState(null); // channel being composed
  const { tenant } = usePosErpAuth();
  const [looked, setLooked] = useState(null);
  // Alerts only know the id: fetch the person's number/email once so the right buttons switch on.
  const needsLookup = !!recipient?.id && recipient.phone === undefined && recipient.email === undefined;
  useEffect(() => {
    if (!needsLookup || !tenant?.id) return undefined;
    let live = true;
    loaders.loadRecipient(posSupabase, { tenantId: tenant.id, kind: recipient.kind || 'CUSTOMER', id: recipient.id }).then((r) => { if (live) setLooked(r || {}); }).catch(() => { if (live) setLooked({}); });
    return () => { live = false; };
  }, [needsLookup, tenant, recipient?.id, recipient?.kind]);
  if (!recipient?.id && !recipient?.inline) return null;
  const phone = recipient.phone ?? looked?.phone; const email = recipient.email ?? looked?.email;
  recipient = { ...recipient, name: recipient.name ?? looked?.name };
  // inline = what we already know on screen, so the composer still has a name/number if the lookup is slow or offline
  const rec = { kind: recipient.kind || 'CUSTOMER', id: recipient.id, name: recipient.name, inline: { id: recipient.id, name: recipient.name, phone, email } };
  const stop = (e) => e.stopPropagation();
  return (
    <div className={`flex items-center gap-1.5 ${className}`} onClick={stop}>
      {phone
        ? <a href={`tel:${String(phone).replace(/\s/g, '')}`} className={BTN} aria-label={`Call ${recipient.name || ''}`} title="Call"><Phone size={size === 'sm' ? 14 : 16} /></a>
        : <button className={BTN} disabled aria-label="No phone number" title="No phone number"><Phone size={16} /></button>}
      <button className={BTN} disabled={!phone} onClick={() => setOpen('WHATSAPP')} aria-label="WhatsApp" title={phone ? 'WhatsApp' : 'No phone number'}><MessageCircle size={size === 'sm' ? 14 : 16} /></button>
      <button className={BTN} disabled={!phone} onClick={() => setOpen('SMS')} aria-label="Text message" title={phone ? 'SMS' : 'No phone number'}><MessageSquare size={size === 'sm' ? 14 : 16} /></button>
      <button className={BTN} disabled={!email} onClick={() => setOpen('EMAIL')} aria-label="Email" title={email ? 'Email' : 'No email address'}><Mail size={size === 'sm' ? 14 : 16} /></button>
      {open && <MessageComposer recipient={rec} purpose={purpose} channel={open} reference={reference} inputs={inputs} onClose={() => setOpen(null)} />}
    </div>
  );
}
