// Finance as a drill-down:  Finance > Fees > ...   Route:  finance/*   (the rest of the path picks the node)
import React from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Wallet, HandCoins, Receipt, Landmark, Boxes, BarChart3, BookOpen, ChevronRight, FolderOpen, ArrowUpRight } from 'lucide-react';
import { FitPage, EmptyBlock } from '../../shared/components/kit';
import { useElimuAccess } from '../../hooks/useElimu.js';
import { FINANCE_TREE, findNode, visibleChildren } from './financeTree';

const ICONS = { Wallet, HandCoins, Receipt, Landmark, Boxes, BarChart3, BookOpen };

export default function FinanceHubPage({ basePath = '/elimu' }) {
  const params = useParams(); const nav = useNavigate(); const { can } = useElimuAccess();
  const segs = (params['*'] || '').split('/').filter(Boolean);
  const node = findNode(segs);
  const here = `${basePath}/finance`;
  if (!node) return <FitPage title="Finance"><EmptyBlock>That section does not exist. <Link className="underline" to={here}>Back to Finance</Link></EmptyBlock></FitPage>;
  const kids = visibleChildren(node, can);
  const crumbs = [{ label: 'Finance', to: here }, ...segs.map((s, i) => ({ label: findNode(segs.slice(0, i + 1))?.label || s, to: `${here}/${segs.slice(0, i + 1).join('/')}` }))];
  return (
    <FitPage title={node.label} subtitle={node.desc || 'Fees, receivables, payables, assets and reports'}>
      {segs.length > 0 && (
        <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1 text-xs text-[#6F7461] mb-3">
          {crumbs.map((c, i) => (<React.Fragment key={c.to}>{i > 0 && <ChevronRight size={12} />}{i === crumbs.length - 1 ? <span className="font-semibold text-[#23382B]">{c.label}</span> : <Link to={c.to} className="underline-offset-2 hover:underline">{c.label}</Link>}</React.Fragment>))}
        </nav>)}
      {kids.length === 0 ? <EmptyBlock>Nothing here is available to your role.</EmptyBlock> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {kids.map((k) => {
            const Icon = ICONS[k.icon] || FolderOpen; const open = () => { if (k.soon) return; nav(k.children ? `${here}/${[...segs, k.key].join('/')}` : `${basePath}/${k.to}`); };
            return (
              <button key={k.key} type="button" onClick={open} disabled={!!k.soon} aria-disabled={!!k.soon}
                className={`group flex min-h-[112px] w-full items-start gap-3 rounded-2xl border p-4 text-left shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E7D52] ${k.soon ? 'border-[#E3DBB8] bg-[#F5F1DC] text-[#8A8F7C]' : 'border-[#E1E8E1] bg-white hover:-translate-y-0.5 hover:border-[#A9CBB3] hover:shadow-md'}`}>
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${k.soon ? 'bg-[#ECE6C8] text-[#A5A88F]' : 'bg-[#E4F0E8] text-[#1F6B45]'}`}><Icon size={22} /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold text-[15px] text-inherit">{k.label}</span><span className="mt-1 block text-xs leading-5 text-[#6F7461]">{k.desc}</span></span>
                {k.soon ? <span className="rounded-full bg-[#ECE6C8] px-2 py-0.5 text-[10px] font-semibold text-[#8A8F7C]">SOON</span> : <ArrowUpRight size={18} className="shrink-0 text-[#A5A88F] transition group-hover:text-[#1F6B45]" />}
              </button>);
          })}
        </div>)}
    </FitPage>
  );
}
