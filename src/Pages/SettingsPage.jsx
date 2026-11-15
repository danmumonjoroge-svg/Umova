// src/pos-erp/pages/SettingsPage.jsx
//
// v2 LAYOUT: one long page of five stacked forms became a card home + one
// small card per topic (Business, Menu, Payments & tax, Invoices, Receipts,
// Security). The open card is kept in the URL (?s=payments) so the browser/
// phone Back button returns to the card list. ALL logic -- loading, saving,
// permissions, capabilities -- is unchanged; only the layout is new.
//
// Phase 8 — settings (brief §59). Staff/Security link out to their own
// pages rather than being duplicated here — Staff management (§60's
// staff CRUD) isn't built yet (see AUDIT.md), Security is the existing
// POS auth screens.

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Loader2, Save, ChevronRight, ArrowLeft, Building2, LayoutGrid, CreditCard,
  FileText, Receipt, ShieldCheck, FileCheck2,
} from 'lucide-react';
import { WorkspacePage } from '../components/workspace/WorkspaceKit';
import BusinessBrandingCard from '../components/BusinessBrandingCard';
import EtimsSetupCard from '../components/EtimsSetupCard';
import { useSettings } from '../hooks/useSettings';
import { settingsService } from '../services/settingsService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useCapabilities } from '../navigation/CapabilitiesContext';
import { usePermissions } from '../navigation/PermissionsContext';
import { CAPABILITIES, ALL_CAPABILITY_KEYS, withRequired } from '../navigation/navConfig';
import POSPasskeySettings from '../auth/POSPasskeySettings';
import { posSupabase } from '../services/posSupabaseClient';
import FingerprintToggle from '../../security/FingerprintToggle';
import { isNativeApp } from '../../security/nativeBiometric';

const ALL_PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK', 'CREDIT', 'VOUCHER', 'OTHER'];

export default function SettingsPage() {
  const { tenant, role } = usePosErpAuth();
  // Interim screen rule until database-level permissions exist: only the owner or a manager changes business identity.
  const { loaded: permsLoaded, can } = usePermissions();
  // Database permission when available; before the migration is deployed fall back to the role. UI only: the database enforces.
  const canEditIdentity = permsLoaded ? can('settings.manage') : ['owner', 'manager', 'admin'].includes(String(role || '').toLowerCase());
  const { profile, posSettings, loading, error, updateProfile, savePosSettings } = useSettings();

  const [profileForm, setProfileForm] = useState(null);
  const [settingsForm, setSettingsForm] = useState(null);
  const [receiptHeader, setReceiptHeader] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveError, setSaveError] = useState('');
  const { enabled: enabledCaps, refresh: refreshCaps } = useCapabilities();
  const [capsDraft, setCapsDraft] = useState(null); // null = untouched, follows saved value
  const [savingCaps, setSavingCaps] = useState(false);

  useEffect(() => { if (profile) setProfileForm(profile); }, [profile]);
  useEffect(() => {
    if (posSettings) {
      setSettingsForm(posSettings.settings);
      setReceiptHeader(posSettings.receipt_header || '');
      setReceiptFooter(posSettings.receipt_footer || '');
    }
  }, [posSettings]);

  const [params, setParams] = useSearchParams();
  const section = params.get('s');
  const openSection = (k) => setParams(k ? { s: k } : {});

  const flash = (msg) => { setSaveMsg(msg); setTimeout(() => setSaveMsg(''), 2500); };

  const submitProfile = async (e) => {
    e.preventDefault();
    setSaveError('');
    setSavingProfile(true);
    try {
      await updateProfile(profileForm);
      flash('Business profile saved.');
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const submitSettings = async (e) => {
    e.preventDefault();
    setSaveError('');
    setSavingSettings(true);
    try {
      await savePosSettings({ settings: settingsForm, receipt_header: receiptHeader, receipt_footer: receiptFooter });
      flash('Settings saved.');
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  // "What does your business do?" -- stored in the existing lb_pos_settings
  // JSONB blob (settings.enabled_capabilities); navigation reads it via
  // CapabilitiesContext. Saved on its own so it can't be lost by, or
  // interfere with, the payments/receipt form below.
  const capsShown = capsDraft ?? enabledCaps;
  const toggleCap = (k) => {
    const cur = capsShown;
    if (cur.includes(k)) {
      // Switching off something another capability needs (Folios for Rooms) is ignored, not silently half-done.
      if (cur.some((x) => x !== k && (CAPABILITIES[x]?.requires || []).includes(k))) return;
      setCapsDraft(cur.filter((x) => x !== k));
    } else {
      setCapsDraft(withRequired([...cur, k]));
    }
  };
  const submitCaps = async () => {
    setSaveError('');
    if (capsShown.length === 0) { setSaveError('Pick at least one thing your business does.'); return; }
    setSavingCaps(true);
    try {
      await savePosSettings({
        settings: { ...settingsForm, enabled_capabilities: capsShown },
        receipt_header: receiptHeader, receipt_footer: receiptFooter,
      });
      setSettingsForm({ ...settingsForm, enabled_capabilities: capsShown });
      await refreshCaps();
      setCapsDraft(null);
      flash('Saved. Your menu has been updated.');
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSavingCaps(false);
    }
  };

  const toggleMethod = (m) => {
    const current = settingsForm.payment_methods_enabled || [];
    setSettingsForm({
      ...settingsForm,
      payment_methods_enabled: current.includes(m) ? current.filter(x => x !== m) : [...current, m],
    });
  };

  if (loading || !profileForm || !settingsForm) {
    return <div className="p-8 text-center text-slate-400"><Loader2 size={20} className="animate-spin inline mr-2" /> Loading settings…</div>;
  }

  const inputCls = 'w-full border border-[#DDE3DD] rounded-lg px-3 py-2.5 text-sm bg-white focus:border-[#237A52] focus:ring-2 focus:ring-[#237A52]/15 outline-none disabled:bg-[#F7F6F0]';
  const labelCls = 'block text-[11px] font-bold uppercase tracking-wide text-[#68756D] mb-1';
  const saveBtn = 'flex items-center justify-center gap-2 bg-[#237A52] hover:bg-[#1B5138] text-white text-sm font-semibold px-4 min-h-[44px] rounded-lg disabled:opacity-60 w-full sm:w-auto';

  const ip = settingsForm.invoice_payment || {};
  const invoiceSet = Object.values(ip).some((v) => String(v || '').trim());
  const methods = settingsForm.payment_methods_enabled || [];

  const SECTIONS = [
    { key: 'profile',  icon: Building2,   title: 'My business',        desc: 'Name, logo, phone, address, currency',
      summary: profileForm.name || 'Not set' },
    { key: 'menu',     icon: LayoutGrid,  title: 'What my business does', desc: 'Choose what shows in your menu',
      summary: `${capsShown.length} on` },
    { key: 'payments', icon: CreditCard,  title: 'Payments & tax',     desc: 'Payment methods and tax rate',
      summary: `${methods.length} method${methods.length === 1 ? '' : 's'} · Tax ${Number(settingsForm.tax_rate || 0)}%` },
    { key: 'invoices', icon: FileText,    title: 'How tenants pay',    desc: 'Paybill, till and bank on invoices',
      summary: invoiceSet ? 'Set up' : 'Not set up' },
    { key: 'receipts', icon: Receipt,     title: 'Receipts & messages', desc: 'Receipt header, footer, messages',
      summary: receiptHeader || receiptFooter ? 'Customised' : 'Default' },
    { key: 'etims',    icon: FileCheck2,  title: 'Tax invoices (KRA)', desc: 'Connect your business to KRA eTIMS',
      summary: 'Set up' },
    { key: 'security', icon: ShieldCheck, title: 'Security',           desc: isNativeApp() ? 'Fingerprint login' : 'Passkeys and sign-in',
      summary: isNativeApp() ? 'Fingerprint' : 'Passkeys' },
  ];
  const current = SECTIONS.find((s) => s.key === section);

  const banners = (
    <>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{error}</div>}
      {saveError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{saveError}</div>}
      {saveMsg && <div className="bg-[#E3F1E9] border border-[#b9dcc8] text-[#17583a] text-sm rounded-lg p-3 mb-3">{saveMsg}</div>}
    </>
  );

  // ───────── card home ─────────
  if (!current) {
    return (
      <WorkspacePage title="Settings" subtitle={tenant?.business_name ? `${tenant.business_name} · tap a card to change it.` : 'Tap a card to change it.'}>
        {banners}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key} type="button" onClick={() => openSection(s.key)}
                className="group text-left flex flex-col rounded-xl p-3 min-h-[112px] min-w-0 bg-white border border-[#DDE3DD] hover:border-[#237A52] active:scale-[0.98] transition"
              >
                <div className="flex items-start justify-between">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#237A52]/10 text-[#237A52]"><Icon size={17} /></div>
                  <ChevronRight size={15} className="text-[#B0BAB3] group-hover:text-[#237A52]" />
                </div>
                <div className="mt-2 text-[13.5px] font-semibold text-[#26352D] leading-tight">{s.title}</div>
                <div className="text-[12px] font-bold text-[#237A52] leading-tight mt-0.5 truncate">{s.summary}</div>
                <p className="text-[11px] text-[#68756D] leading-snug mt-1" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.desc}</p>
              </button>
            );
          })}
        </div>
      </WorkspacePage>
    );
  }

  // ───────── one section ─────────
  const Icon = current.icon;
  return (
    <div className="px-3.5 py-3.5 sm:p-6 lg:p-8 max-w-2xl mx-auto min-w-0">
      <button type="button" onClick={() => openSection(null)} className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-semibold text-[#237A52] mb-1">
        <ArrowLeft size={16} /> Settings
      </button>
      <div className="flex items-center gap-3 mb-3.5">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#237A52]/10 text-[#237A52]"><Icon size={19} /></div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-[#26352D] leading-tight">{current.title}</h1>
          <p className="text-xs text-[#68756D]">{current.desc}</p>
        </div>
      </div>
      {banners}

      {section === 'profile' && (
        <form onSubmit={submitProfile} className="bg-white border border-[#DDE3DD] rounded-xl p-4 space-y-3">
          <p className="text-xs text-[#68756D]">This is how your business appears on receipts, invoices, statements and in the menu.</p>
          <BusinessBrandingCard
            businessId={tenant?.business_id}
            profile={profileForm}
            receiptHeader={receiptHeader}
            canEdit={canEditIdentity}
            onProfileChange={(updated) => setProfileForm((f) => ({ ...f, ...updated }))}
          />
          <fieldset disabled={!canEditIdentity} className="space-y-3 min-w-0 border-0 p-0 m-0">
            <div><label className={labelCls}>Business name</label>
              <input value={profileForm.name || ''} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} className={inputCls} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={labelCls}>Phone</label>
                <input value={profileForm.phone || ''} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Email</label>
                <input value={profileForm.email || ''} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} className={inputCls} /></div>
            </div>
            <div><label className={labelCls}>Address</label>
              <input value={profileForm.address || ''} onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })} className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Currency</label>
                <input placeholder="KES" value={profileForm.currency || ''} onChange={(e) => setProfileForm({ ...profileForm, currency: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Time zone</label>
                <input value={profileForm.time_zone || ''} onChange={(e) => setProfileForm({ ...profileForm, time_zone: e.target.value })} className={inputCls} /></div>
            </div>
            <button type="submit" disabled={savingProfile} className={saveBtn}><Save size={15} /> {savingProfile ? 'Saving…' : 'Save'}</button>
          </fieldset>
        </form>
      )}

      {section === 'menu' && (
        <div className="bg-white border border-[#DDE3DD] rounded-xl p-4 space-y-3">
          <p className="text-xs text-[#68756D]">Choose everything that applies. This only changes what shows in your menu. Turning one off deletes nothing.</p>
          {!canEditIdentity && <p className="text-xs text-[#68756D]">Only the owner or a manager can change this.</p>}
          <fieldset disabled={!canEditIdentity} className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0 border-0 p-0 m-0">
            {ALL_CAPABILITY_KEYS.map((k) => (
              <label key={k} className={`flex items-start gap-2.5 rounded-lg border p-2.5 min-h-[52px] cursor-pointer ${capsShown.includes(k) ? 'border-[#237A52] bg-[#237A52]/5' : 'border-[#DDE3DD]'}`}>
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[#237A52]" checked={capsShown.includes(k)} onChange={() => toggleCap(k)} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[#26352D]">{CAPABILITIES[k].label}</span>
                  <span className="block text-[11px] text-[#68756D] leading-snug">{CAPABILITIES[k].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="button" onClick={submitCaps} disabled={!canEditIdentity || savingCaps || capsDraft === null} className={saveBtn}>
            <Save size={15} /> {savingCaps ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {section === 'payments' && (
        <form onSubmit={submitSettings} className="bg-white border border-[#DDE3DD] rounded-xl p-4 space-y-4">
          <div>
            <label className={labelCls}>Payment methods accepted</label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {ALL_PAYMENT_METHODS.map((m) => (
                <button
                  type="button" key={m} onClick={() => toggleMethod(m)}
                  className={`text-xs font-semibold px-3 min-h-[36px] rounded-full border ${methods.includes(m) ? 'bg-[#237A52] text-white border-[#237A52]' : 'bg-white text-[#68756D] border-[#DDE3DD]'}`}
                >
                  {m === 'MOBILE_MONEY' ? 'M-Pesa' : m.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className={labelCls}>Tax rate (%)</label>
              <input type="number" min="0" max="100" step="0.01" value={settingsForm.tax_rate} onChange={(e) => setSettingsForm({ ...settingsForm, tax_rate: parseFloat(e.target.value) || 0 })} className={inputCls} />
            </div>
            <label className="flex items-center gap-2 text-sm text-[#26352D] min-h-[44px]">
              <input type="checkbox" className="w-4 h-4 accent-[#237A52]" checked={settingsForm.tax_inclusive} onChange={(e) => setSettingsForm({ ...settingsForm, tax_inclusive: e.target.checked })} />
              Prices include tax
            </label>
          </div>
          <button type="submit" disabled={savingSettings} className={saveBtn}><Save size={15} /> {savingSettings ? 'Saving…' : 'Save'}</button>
        </form>
      )}

      {section === 'etims' && <EtimsSetupCard canEdit={canEditIdentity} />}

      {section === 'invoices' && (
        <form onSubmit={submitSettings} className="bg-white border border-[#DDE3DD] rounded-xl p-4 space-y-3">
          <p className="text-xs text-[#68756D]">Fill in only what you use. This appears in the “How to pay” box on every invoice PDF and in invoice messages.</p>
          {(() => {
            const set = (k) => (e) => setSettingsForm({ ...settingsForm, invoice_payment: { ...ip, [k]: e.target.value } });
            const f = (k, label, ph) => (
              <div className="min-w-0"><label className={labelCls}>{label}</label>
                <input placeholder={ph} value={ip[k] || ''} onChange={set(k)} className={inputCls} /></div>
            );
            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {f('paybill', 'M-Pesa Paybill', 'Paybill number')}
                  {f('paybill_account', 'Paybill account', 'Blank = invoice number')}
                </div>
                {f('till', 'M-Pesa Till (Buy Goods)', 'Till number')}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {f('bank_name', 'Bank', 'Bank name')}
                  {f('bank_branch', 'Branch', 'Branch')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {f('bank_account_name', 'Account name', 'Account name')}
                  {f('bank_account_number', 'Account number', 'Account number')}
                </div>
                <div><label className={labelCls}>Anything else</label>
                  <textarea placeholder="e.g. “Pay by the 5th. Send the M-Pesa code after paying.”" value={ip.other || ''} onChange={set('other')} rows={2} className={inputCls} /></div>
              </>
            );
          })()}
          <button type="submit" disabled={savingSettings} className={saveBtn}><Save size={15} /> {savingSettings ? 'Saving…' : 'Save'}</button>
        </form>
      )}

      {section === 'receipts' && (
        <form onSubmit={submitSettings} className="bg-white border border-[#DDE3DD] rounded-xl p-4 space-y-3">
          <div><label className={labelCls}>Receipt header</label>
            <input placeholder="e.g. your business tagline" value={receiptHeader} onChange={(e) => setReceiptHeader(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Receipt footer</label>
            <input placeholder="e.g. Thank you for shopping with us" value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)} className={inputCls} /></div>
          <label className="flex items-start gap-2 text-xs text-[#68756D] pt-1">
            <input type="checkbox" className="mt-0.5" checked={!!settingsForm.communication_enabled} disabled readOnly />
            Send customer messages automatically — not available yet (no SMS / email / WhatsApp provider is connected).
          </label>
          <button type="submit" disabled={savingSettings} className={saveBtn}><Save size={15} /> {savingSettings ? 'Saving…' : 'Save'}</button>
        </form>
      )}

      {section === 'security' && (
        isNativeApp() ? (
          <div className="bg-white border border-[#DDE3DD] rounded-xl p-4">
            <FingerprintToggle service="business" client={posSupabase} />
          </div>
        ) : (
          <POSPasskeySettings />
        )
      )}
    </div>
  );
}
