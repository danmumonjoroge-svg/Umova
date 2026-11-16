import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FitPage, SearchBox, DataCard, CardGrid, LoadingBlock, EmptyBlock, Notice } from '../services/platform.js';
import { guardianService } from '../services/ElimuGuardianService.js';
import { communicationService } from '../communication/ElimuCommunicationService.js';
import { useAsync, useDebounced } from '../hooks/useAsync.js';
import { useElimuAccess, useElimuSetup } from '../hooks/useElimu.js';
import { Pager } from '../components/ui.jsx';
import GuardianFormSheet from '../components/GuardianFormSheet.jsx';
import ConsentEditor from '../components/ConsentEditor.jsx';
import ElimuContactActions from '../components/ElimuContactActions.jsx';
import { CommunicationHistory } from '../components/ElimuCommunicationPanel.jsx';
import { displayPhone } from '../utils/phone.js';
import { relationshipLabel, shortName } from '../utils/format.js';

export function GuardiansPage({ basePath = '/elimu' }) {
  const { can } = useElimuAccess(); const [search, setSearch] = useState(''); const q = useDebounced(search); const [page, setPage] = useState(0); const [adding, setAdding] = useState(false);
  const list = useAsync(() => guardianService.list({ search: q, page }), [q, page]);
  return (
    <FitPage title="Guardians" subtitle={list.data ? `${list.data.total} family contacts on record` : 'Family contacts'}
      action={can('guardians.manage') && <button type="button" className="px-3 min-h-[40px] rounded-xl bg-[#1F6B45] text-white text-sm font-semibold shadow-sm" onClick={() => setAdding(true)}>＋ Add guardian</button>}
      summary={<div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-[#E3DBB8] bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">Directory records</div><div className="text-lg font-bold text-[#1F6B45]">{list.data?.total ?? '—'}</div></div><div className="rounded-xl border border-[#E3DBB8] bg-[#FBF8EA] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">On this page</div><div className="text-lg font-bold text-[#5C4A12]">{list.data?.rows.length ?? '—'}</div></div></div>}
      toolbar={<SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Search guardian name" />}>
      {list.error && <Notice tone="bad">{list.error}</Notice>}
      {list.loading && !list.data ? <LoadingBlock /> : list.data?.rows.length === 0 ? <EmptyBlock>No guardians found.</EmptyBlock> :
        <CardGrid>{list.data?.rows.map((g) => {
          const phone = g.elimu_guardian_contacts?.find((c) => c.kind === 'PHONE');
          const kids = (g.elimu_student_guardians || []).filter((l) => !l.ended_on).length;
          return <DataCard key={g.id} title={`${g.first_name} ${g.last_name}`} subtitle={`${kids} linked student${kids === 1 ? '' : 's'}`}><div className="mt-2 pt-2 border-t border-[#F0EACF] flex items-center justify-between gap-2"><span className="text-xs text-slate-500 truncate">{phone ? displayPhone(phone.value) : 'No phone on record'}</span><Link to={`${basePath}/guardians/${g.id}`} className="text-sm font-semibold text-[#1F6B45] underline underline-offset-2">View profile →</Link></div></DataCard>;
        })}</CardGrid>}
      {list.data && <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />}
      {adding && <GuardianFormSheet onClose={() => setAdding(false)} onSaved={() => list.reload()} />}
    </FitPage>
  );
}

export function GuardianProfilePage({ basePath = '/elimu' }) {
  const { id } = useParams(); const { can } = useElimuAccess(); const { settings } = useElimuSetup();
  const g = useAsync(() => guardianService.get(id), [id]); const ov = useAsync(() => communicationService.loadOverrides().catch(() => []), []);
  if (g.loading && !g.data) return <LoadingBlock />; if (g.error && !g.data) return <Notice tone="bad">{g.error}</Notice>;
  const x = g.data;
  return (
    <FitPage title={`${x.first_name} ${x.last_name}`} subtitle={`Prefers ${String(x.preferred_channel || 'SMS').toLowerCase()}`}>
      <div className="mb-3"><ElimuContactActions guardian={x} settings={settings} overrides={ov.data || []} onDone={() => g.reload()} /></div>
      <section className="bg-white border border-[#E3DBB8] rounded-xl p-3 mb-3"><h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Contacts</h3>
        {x.contacts.length === 0 ? <p className="text-sm text-slate-500">No phone or email yet.</p> : x.contacts.map((c) => <div key={c.id} className="flex justify-between text-sm py-1"><span>{c.kind === 'PHONE' ? displayPhone(c.value) : c.value}{c.is_primary ? ' · primary' : ''}{c.is_whatsapp ? ' · WhatsApp' : ''}</span></div>)}</section>
      <section className="bg-white border border-[#E3DBB8] rounded-xl p-3 mb-3"><h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Students</h3>
        {x.students.length === 0 ? <p className="text-sm text-slate-500">Not linked to any student.</p> : x.students.map((l) => <Link key={l.id} to={`${basePath}/students/${l.student_id}`} className="flex justify-between text-sm py-1.5 underline-offset-2 hover:underline"><span>{shortName(l.elimu_students)}</span><span className="text-slate-500">{relationshipLabel(l.relationship)}</span></Link>)}</section>
      <section className="bg-white border border-[#E3DBB8] rounded-xl p-3 mb-3"><h3 className="text-xs font-semibold uppercase text-slate-500 mb-1">How they agreed to be contacted</h3><ConsentEditor guardian={x} canEdit={can('guardians.manage')} onChanged={() => g.reload()} /></section>
      <section className="bg-white border border-[#E3DBB8] rounded-xl p-3"><h3 className="text-xs font-semibold uppercase text-slate-500 mb-1">History</h3><CommunicationHistory guardianId={x.id} /></section>
    </FitPage>
  );
}
