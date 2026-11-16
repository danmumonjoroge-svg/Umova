// elimu/app/settings/ElimuSettingsHub.jsx -- THE single Settings module: a hub of sections, each supplied by its module (registry settingsSections).
// /settings lists what this person may open; /settings/:section shows one. Existing setup pages keep their own deep links too.
import React, { Suspense } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { registeredKeys, settingsSections } from '../../registry.js';
import { useElimuSession } from '../auth/ElimuAuthContext.jsx';
import { SETTINGS_SECTIONS, findSection, visibleSettings } from '../navigation/settingsRegistry.js';
import { iconFor } from '../shell/icons.js';
import { PageContainer, EmptyState, LoadingState } from '../shell/states.jsx';

const supplied = () => new Map(settingsSections().map((s) => [s.key, s]));

function Hub({ base }) {
  const { permissions } = useElimuSession();
  const map = supplied();
  const list = visibleSettings({ can: permissions.can, modules: registeredKeys(), supplied: new Set(map.keys()) });
  if (!permissions.loaded) return <PageContainer title="Settings"><LoadingState /></PageContainer>;
  return (
    <PageContainer title="Settings" subtitle="School set-up in one place.">
      {list.length === 0
        ? <EmptyState title="Nothing to set up" hint="You do not have access to any settings. Ask the school owner to give you an Elimu role." />
        : <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.map((s) => { const Icon = iconFor(s.icon); return (
            <li key={s.key}><Link to={`${base}/settings/${s.key}`} className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-[#E3DBB8] bg-white p-4 active:bg-[#F6F1D8]">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E4F0E8] text-[#1F6B45]"><Icon size={20} /></span>
              <span className="min-w-0 flex-1"><span className="block font-bold text-[#173D2A]">{s.label}</span><span className="block text-xs text-[#5A6B5E]">{s.description}</span></span><ChevronRight size={16} className="shrink-0 text-[#9AA69C]" />
            </Link></li>); })}</ul>}
    </PageContainer>
  );
}

function Section({ base }) {
  const { section } = useParams(); const { permissions } = useElimuSession();
  const meta = findSection(section); const mod = supplied().get(section);
  const back = <Link to={`${base}/settings`} className="mb-3 inline-flex h-10 items-center gap-1 text-sm font-semibold text-[#1F6B45]"><ChevronLeft size={16} />Settings</Link>;
  if (!meta || !mod || !registeredKeys().has(meta.module)) return <>{back}<EmptyState title="That settings section does not exist" /></>;
  if (!permissions.loaded) return <>{back}<LoadingState /></>;
  if (!permissions.can(mod.action || meta.action)) return <>{back}<EmptyState title="You do not have access to this section" hint="Ask the school owner to give you an Elimu role." /></>;
  return <>{back}<Suspense fallback={<LoadingState />}>{typeof mod.element === 'function' ? mod.element({ base }) : mod.element}</Suspense></>;
}

export default function ElimuSettingsHub({ base = '/school' }) {
  return <Routes><Route index element={<Hub base={base} />} /><Route path=":section/*" element={<Section base={base} />} /></Routes>;
}
export { SETTINGS_SECTIONS };
