// src/pos-erp/components/BusinessBrandingCard.jsx
//
// Settings > Business identity. The logo (and the name/contact details on the Business Profile
// form below it) belong to THIS business only. Choose a picture, see it on a sample receipt, then
// save, replace or remove it. The picture is checked and re-encoded in the browser
// (utils/logoImage.js); the bucket and its per-business folder policies do the rest.
//
// Interim permission: only owner / manager can change identity here. That is a screen rule, not
// database security: database-level permissions are the next phase (see MY_BUSINESS_BRANDING_PLAN.md).

import React, { useEffect, useRef, useState } from 'react';
import { Upload, Loader2, Image as ImageIcon, Trash2 } from 'lucide-react';
import { settingsService } from '../services/settingsService';
import { processLogo, LOGO_RULES } from '../utils/logoImage';
import { singleFlight } from '../utils/singleFlight';

function ReceiptPreview({ name, phone, address, logoUrl, header }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 text-[11px] leading-snug text-slate-700 w-full max-w-[220px] mx-auto shadow-sm">
      <div className="text-center">
        {logoUrl && <img src={logoUrl} alt="" className="max-h-10 mx-auto mb-1 object-contain" />}
        <div className="font-bold text-[13px] break-words">{name || 'Your business name'}</div>
        {address && <div className="text-slate-500 break-words">{address}</div>}
        {phone && <div className="text-slate-500">{phone}</div>}
        {header && <div className="mt-1">{header}</div>}
      </div>
      <div className="border-t border-dashed border-slate-300 my-2" />
      <div className="flex justify-between"><span>Sample item x 2</span><span>1,000</span></div>
      <div className="flex justify-between font-bold mt-1"><span>TOTAL</span><span>1,000</span></div>
      <div className="border-t border-dashed border-slate-300 my-2" />
      <div className="text-center text-slate-400">Thank you for your business.</div>
    </div>
  );
}

export default function BusinessBrandingCard({ businessId, profile, receiptHeader, canEdit, onProfileChange }) {
  const inputRef = useRef(null);
  const [pending, setPending] = useState(null); // { blob, previewUrl, width, height, ext, contentType, fileName }
  const [mode, setMode] = useState('fit');
  const [sourceFile, setSourceFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // free the preview picture when it is replaced or the card goes away
  useEffect(() => () => { if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl); }, [pending]);

  const prepare = async (file, nextMode) => {
    setError(''); setMessage('');
    try {
      const out = await processLogo(file, { mode: nextMode });
      setPending({ ...out, fileName: file.name });
    } catch (err) { setPending(null); setError(err.message || 'We could not use that picture.'); }
  };
  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    setSourceFile(file);
    await prepare(file, mode);
  };
  const changeMode = async (m) => { setMode(m); if (sourceFile) await prepare(sourceFile, m); };

  const save = singleFlight('BusinessBrandingCard.save', async () => {
    if (!pending) return;
    setBusy(true); setError('');
    try {
      const url = await settingsService.uploadLogo(businessId, pending.blob, { ext: pending.ext, contentType: pending.contentType });
      const updated = await settingsService.setLogoUrl(businessId, url);
      onProfileChange(updated);
      setPending(null); setSourceFile(null);
      setMessage('Logo saved.');
    } catch (err) { setError(err.message || 'We could not save the logo.'); }
    finally { setBusy(false); }
  });
  const remove = singleFlight('BusinessBrandingCard.remove', async () => {
    if (!window.confirm('Remove your logo? Receipts and invoices will show just your business name.')) return;
    setBusy(true); setError('');
    try { onProfileChange(await settingsService.removeLogo(businessId)); setPending(null); setSourceFile(null); setMessage('Logo removed.'); }
    catch (err) { setError(err.message || 'We could not remove the logo.'); }
    finally { setBusy(false); }
  });

  const shown = pending?.previewUrl || profile?.logo_url || null;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        <div className="w-20 h-20 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
          {shown ? <img src={shown} alt="Business logo" className="w-full h-full object-contain" /> : <ImageIcon size={24} className="text-slate-300" />}
        </div>
        <div className="min-w-0">
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
                className="flex items-center gap-2 text-sm font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-3 min-h-[40px] rounded-lg disabled:opacity-60">
                <Upload size={14} /> {profile?.logo_url || pending ? 'Choose another' : 'Add a logo'}
              </button>
              {profile?.logo_url && !pending && (
                <button type="button" onClick={remove} disabled={busy} className="flex items-center gap-2 text-sm font-semibold text-red-600 border border-slate-200 bg-white px-3 min-h-[40px] rounded-lg disabled:opacity-60">
                  <Trash2 size={14} /> Remove
                </button>
              )}
              <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onPick} className="hidden" />
            </div>
          ) : (
            <p className="text-sm text-slate-500">Only the owner or a manager can change the business logo.</p>
          )}
          <p className="text-[11px] text-slate-400 mt-1">PNG, JPG or WebP, up to {LOGO_RULES.maxFileBytes / 1048576} MB, at least {LOGO_RULES.minSide} pixels. It appears on your receipts, invoices and statements, and in the menu. Without a logo, your business name is shown on its own.</p>
        </div>
      </div>

      {pending && canEdit && (
        <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-3 space-y-2">
          <div className="text-sm font-semibold text-slate-700">Preview <span className="text-slate-400 font-normal">({pending.width} x {pending.height})</span></div>
          <div className="grid grid-cols-2 gap-1 bg-white border border-slate-200 rounded-lg p-1 w-full max-w-xs">
            {[['fit', 'Whole picture'], ['square', 'Square crop']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => changeMode(k)} aria-pressed={mode === k} className={`min-h-[36px] rounded-md text-xs font-semibold ${mode === k ? 'bg-emerald-800 text-white' : 'text-slate-500'}`}>{l}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 min-h-[44px] rounded-xl disabled:opacity-60">
              {busy && <Loader2 size={14} className="animate-spin" />} {busy ? 'Saving…' : 'Use this logo'}
            </button>
            <button type="button" onClick={() => { setPending(null); setSourceFile(null); }} disabled={busy} className="text-sm font-semibold text-slate-600 border border-slate-200 bg-white px-4 min-h-[44px] rounded-xl">Cancel</button>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}
      {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl p-3">{message}</div>}

      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase mb-1">How it looks on a receipt</div>
        <ReceiptPreview name={profile?.name} phone={profile?.phone} address={profile?.address} logoUrl={shown} header={receiptHeader} />
      </div>
    </div>
  );
}
