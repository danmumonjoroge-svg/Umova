// Finance as a drill-down:  Finance > Fees > ...   Route:  finance/*   (the rest of the path picks the node)
import React from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Wallet, HandCoins, Receipt, Landmark, Boxes, BarChart3, BookOpen, Sprout, ChevronRight, FolderOpen } from 'lucide-react';
import { FitPage, EmptyBlock } from '../../shared/components/kit';
import { useElimuAccess } from '../../hooks/useElimu.js';
import { FINANCE_TREE, findNode, visibleChildren } from './financeTree';
import { MenuCards } from '../../ui/cards/MenuCards.jsx';
import { countPages } from '../../navigation/menuKit.js';

const ICONS = { Wallet, HandCoins, Receipt, Landmark, Boxes, BarChart3, BookOpen, Sprout };

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
        <MenuCards kids={kids} depth={segs.length} accent="#0B7A5A" open={(k) => { if (!k.soon) nav(k.children ? `${here}/${[...segs, k.key].join('/')}` : `${basePath}/${k.to}`); }}
          describe={(k) => ({ Icon: ICONS[k.icon], pages: countPages(k), peek: k.children ? visibleChildren(k, can).slice(0, 4).map((c) => c.label) : [] })} />)}
    </FitPage>
  );
}
