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
import { PersonCard } from '../ui/cards/index.js';
import { relationshipLabel, shortName } from '../utils/format.js';

export function GuardiansPage({ basePath = '/elimu' }) {
  const { can } = useElimuAccess(); const [search, setSearch] = useState(''); const q = useDebounced(search); const [page, setPage] = useState(0); const [adding, setAdding] = useState(false);
  const list = useAsync(() => guardianService.list({ search: q, page }), [q, page]);
  return (
    <FitPage title="Guardians" subtitle={list.data ? `${list.data.total} on record` : ''} toolbar={<SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Guardian name" />}
      action={can('guardians.manage') && <button type="button" className="px-3 min-h-[40px] rounded-lg bg-[#1F6B45] text-white text-sm font-semibold" onClick={() => setAdding(true)}>Add</button>}>
      {list.error && <Notice tone="bad">{list.error}</Notice>}
      {list.loading && !list.data ? <LoadingBlock /> : list.data?.rows.length === 0 ? <EmptyBlock>No guardians found.</EmptyBlock> :
        <div className="space-y-3 pl-6 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:space-y-0 sm:gap-y-3">{list.data?.rows.map((g) => {
          const phone = g.elimu_guardian_contacts?.find((c) => c.kind === 'PHONE');
          const kids = (g.elimu_student_guardians || []).filter((l) => !l.ended_on).length;
          return <PersonCard key={g.id} name={`${g.first_name} ${g.last_name}`} to={`${basePath}/guardians/${g.id}`} meta={phone ? displayPhone(phone.value) : 'No phone yet'}
            status={{ label: `${kids} child${kids === 1 ? '' : 'ren'}`, tone: kids === 0 ? 'warn' : 'ok' }} />;
        })}</div>}
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
