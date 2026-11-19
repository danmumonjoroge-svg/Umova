// elimu/ui/cards/Skeleton.jsx -- loading placeholders that have the same shapes as the real cards, so the page does not jump when data arrives.
import React from 'react';
import { V, SHAPE } from './tokens.js';
const Bone = ({ className = '', style }) => <div className={`animate-pulse ${className}`} style={{ background: V.soft, ...style }} />;
export function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-6 lg:grid-cols-12 gap-3 md:gap-4" aria-busy="true" aria-label="Loading the dashboard">
      <Bone className="col-span-6 lg:col-span-5 h-56" style={{ borderRadius: SHAPE.hero }} />
      <Bone className="col-span-6 md:col-span-3 lg:col-span-4 h-56" style={{ borderRadius: SHAPE.gauge }} />
      <div className="col-span-6 md:col-span-3 lg:col-span-3 flex flex-col gap-3"><Bone className="flex-1 min-h-[130px]" style={{ borderRadius: SHAPE.ticket }} /><Bone className="h-16" style={{ borderRadius: SHAPE.spine }} /></div>
      <Bone className="col-span-6 lg:col-span-7 h-60" style={{ borderRadius: SHAPE.ledger }} />
      <Bone className="col-span-6 lg:col-span-5 h-60" style={{ borderRadius: 8 }} />
    </div>);
}
export const ListSkeleton = ({ rows = 6 }) => (
  <div className="space-y-2.5" aria-busy="true">{Array.from({ length: rows }).map((_, i) => <Bone key={i} className="h-[62px]" style={{ borderRadius: i % 3 === 2 ? 10 : 18, width: i % 3 === 2 ? '88%' : '100%' }} />)}</div>);
