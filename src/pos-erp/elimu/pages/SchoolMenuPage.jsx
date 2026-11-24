// The grouped school menu:  Menu > Academics > Exams & results > Results & reports > Report cards.   Route: menu/*  (the rest of the path is the position)
import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FitPage } from '../shared/components/kit';
import { useElimuAccess } from '../hooks/useElimu.js';
import MenuTree from '../components/MenuTree.jsx';
import { SCHOOL_TREE } from '../navigation/schoolTree.js';
import { findNode } from '../navigation/menuKit.js';

export default function SchoolMenuPage({ basePath = '/elimu' }) {
  const params = useParams(); const nav = useNavigate(); const { can, isOwner } = useElimuAccess();
  const segs = (params['*'] || '').split('/').filter(Boolean); const here = `${basePath}/menu`;
  const node = findNode(SCHOOL_TREE, segs);
  return (
    <FitPage title={segs.length ? node?.label || 'Menu' : 'Menu'} subtitle={segs.length > 1 ? node?.desc : segs.length === 1 ? undefined : 'Everything in Elimu, grouped'}>
      <MenuTree tree={SCHOOL_TREE} segs={segs} can={can} owner={isOwner}
        onGo={(s) => nav(s.length ? `${here}/${s.join('/')}` : here)} onOpen={(page) => nav(`${basePath}/${page.to}`)} />
    </FitPage>);
}
