// src/pos-erp/pages/SettingsPage.jsx
//
// Phase 8 — settings (brief §59). Staff/Security link out to their own
// pages rather than being duplicated here — Staff management (§60's
// staff CRUD) isn't built yet (see AUDIT.md), Security is the existing
// POS auth screens.

import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Loader2, Save } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';

const ALL_PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK', 'CREDIT', 'VOUCHER', 'OTHER'];

export default function SettingsPage() {
  const { profile, posSettings, loading, error, updateProfile, savePosSettings } = useSettings();

  const [profileForm, setProfileForm] = useState(null);
  const [settingsForm, setSettingsForm] = useState(null);
  const [receiptHeader, setReceiptHeader] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => { if (profile) setProfileForm(profile); }, [profile]);
  useEffect(() => {
    if (posSettings) {
      setSettingsForm(posSettings.settings);
      setReceiptHeader(posSettings.receipt_header || '');
      setReceiptFooter(posSettings.receipt_footer || '');
    }
  }, [posSettings]);

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

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <SettingsIcon size={22} className="text-amber-600" /> Settings
        </h1>
        <p className="text-slate-500 text-sm">Business profile, payments, tax, and receipts.</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}
      {saveError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{saveError}</div>}
      {saveMsg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl p-3">{saveMsg}</div>}

      {/* Business Profile */}
      <form onSubmit={submitProfile} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
        <h2 className="font-bold text-slate-800">Business Profile</h2>
        <input placeholder="Business name" value={profileForm.name || ''} onChange={e => setProfileForm({ ...profileForm, name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none" />
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Phone" value={profileForm.phone || ''} onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          <input placeholder="Email" value={profileForm.email || ''} onChange={e => setProfileForm({ ...profileForm, email: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
        </div>
        <input placeholder="Address" value={profileForm.address || ''} onChange={e => setProfileForm({ ...profileForm, address: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Currency (e.g. KES)" value={profileForm.currency || ''} onChange={e => setProfileForm({ ...profileForm, currency: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
          <input placeholder="Time zone" value={profileForm.time_zone || ''} onChange={e => setProfileForm({ ...profileForm, time_zone: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2" />
        </div>
        <button type="submit" disabled={savingProfile} className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-60 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
          <Save size={15} /> {savingProfile ? 'Saving…' : 'Save Profile'}
        </button>
      </form>

      {/* POS Settings */}
      <form onSubmit={submitSettings} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <h2 className="font-bold text-slate-800">Payments &amp; Tax</h2>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase">Payment methods accepted</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {ALL_PAYMENT_METHODS.map(m => (
              <button
                type="button" key={m} onClick={() => toggleMethod(m)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                  (settingsForm.payment_methods_enabled || []).includes(m)
                    ? 'bg-emerald-800 text-white border-emerald-800' : 'bg-white text-slate-500 border-slate-200'
                }`}
              >
                {m.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase">Tax rate (%)</label>
            <input type="number" min="0" max="100" step="0.01" value={settingsForm.tax_rate} onChange={e => setSettingsForm({ ...settingsForm, tax_rate: parseFloat(e.target.value) || 0 })} className="w-full border border-slate-200 rounded-xl px-3 py-2 mt-1" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 mt-6">
            <input type="checkbox" checked={settingsForm.tax_inclusive} onChange={e => setSettingsForm({ ...settingsForm, tax_inclusive: e.target.checked })} />
            Prices are tax-inclusive
          </label>
        </div>

        <h2 className="font-bold text-slate-800 pt-2">Receipt</h2>
        <input placeholder="Receipt header (e.g. business tagline)" value={receiptHeader} onChange={e => setReceiptHeader(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
        <input placeholder="Receipt footer (e.g. 'Thank you for shopping with us')" value={receiptFooter} onChange={e => setReceiptFooter(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2" />

        <h2 className="font-bold text-slate-800 pt-2">Communication</h2>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={settingsForm.communication_enabled} onChange={e => setSettingsForm({ ...settingsForm, communication_enabled: e.target.checked })} disabled />
          Send customer messages automatically — disabled (no SMS/email/WhatsApp provider is connected yet)
        </label>

        <button type="submit" disabled={savingSettings} className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-60 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
          <Save size={15} /> {savingSettings ? 'Saving…' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
