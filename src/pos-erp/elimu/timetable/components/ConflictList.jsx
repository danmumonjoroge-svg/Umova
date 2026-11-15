// elimu/timetable/components/ConflictList.jsx -- the clashes found, in plain words, and what the person is allowed to do about them.
import React from 'react';
import { Notice } from '../../shared/components/kit';

export default function ConflictList({ conflicts }) {
  if (!conflicts?.length) return null;
  return (
    <div className="mb-2 space-y-1">
      {conflicts.map((c, i) => <Notice key={`${c.code}${i}`} tone={c.severity === 'BLOCK' ? 'bad' : 'gold'}>{c.message}{c.severity === 'BLOCK' && !c.overridable ? ' This cannot be overridden.' : ''}</Notice>)}
    </div>
  );
}
