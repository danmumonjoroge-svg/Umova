// elimu/storage/pages/FileStoragePage.jsx -- how much file space the school uses and the upload rules (school management).
import React, { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { FitPage, LoadingBlock, Notice, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { rpc } from '../../shared/services/elimuDb';
import { fileSize } from '../../shared/services/fileStorage.js';
import { friendlyError } from '../../utils/validation.js';

const KIND = { MATERIAL: 'Study materials', ASSIGNMENT: 'Assignments', SUBMISSION: 'Student work', LIBRARY: 'Library' };
export default function FileStoragePage() {
  const [tick, setTick] = useState(0); const s = useAsync(() => rpc('elimu_storage_get'), [tick]);
  const [mb, setMb] = useState(10); const [quota, setQuota] = useState(2048); const [ext, setExt] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (s.data) { setMb(s.data.max_file_mb); setQuota(s.data.quota_mb); setExt((s.data.allowed_ext || []).join(', ')); } }, [s.data]);
  const used = Number(s.data?.used_bytes || 0); const pct = s.data ? Math.min(100, Math.round((used / (s.data.quota_mb * 1048576)) * 100)) : 0;
  const save = async () => { setBusy(true); setErr(''); setMsg(''); try { await rpc('elimu_storage_set', { p_max_file_mb: Number(mb), p_quota_mb: Number(quota), p_allowed_ext: ext.split(/[ ,;]+/).filter(Boolean) }); setMsg('Saved.'); setTick((x) => x + 1); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <FitPage title="File storage" icon={HardDrive} subtitle="Space used by study materials and uploads">
      {s.loading ? <LoadingBlock /> : s.error ? <Notice tone="bad">{friendlyError(s.error)}</Notice> : (
        <div className="space-y-3">
          {msg && <Notice tone="good">{msg}</Notice>}{err && <Notice tone="bad">{err}</Notice>}
          <div className="rounded-2xl border border-[#E3DBB8] bg-white p-3">
            <div className="text-sm font-semibold">{fileSize(used)} of {fileSize(s.data.quota_mb * 1048576)} used ({pct}%)</div>
            <div className="h-2 rounded-full bg-[#EFE9CF] mt-2 overflow-hidden"><div className="h-2 bg-[#1F6B45]" style={{ width: `${pct}%` }} /></div>
            <ul className="text-xs text-[#6F7461] mt-2">{Object.entries(s.data.by_kind || {}).map(([k, v]) => <li key={k}>{KIND[k] || k}: {fileSize(v)}</li>)}</ul>
          </div>
          <div className="rounded-2xl border border-[#E3DBB8] bg-white p-3 space-y-2">
            <label className="text-xs block">Largest file (MB, 1 to 50)<input type="number" className={fieldClass} value={mb} onChange={(e) => setMb(e.target.value)} /></label>
            <label className="text-xs block">School storage limit (MB)<input type="number" className={fieldClass} value={quota} onChange={(e) => setQuota(e.target.value)} /></label>
            <label className="text-xs block">Allowed file types<input className={fieldClass} value={ext} onChange={(e) => setExt(e.target.value)} /></label>
            <button type="button" disabled={busy} onClick={save} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50">Save</button>
            <p className="text-xs text-[#6F7461]">Removing a file frees its space. Programs and web pages can never be allowed.</p>
          </div>
        </div>)}
    </FitPage>
  );
}
