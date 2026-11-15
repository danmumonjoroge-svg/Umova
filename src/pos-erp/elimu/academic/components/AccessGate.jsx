// elimu/academic/components/AccessGate.jsx — wraps an academic page: loading / no access / foundation-missing messages. UI nicety only; the database is the gate.
import React from 'react';
import { LoadingBlock } from '../../../components/CardKit';
import { useAcademicAccess } from '../hooks/useAcademicAccess';
import Note from './Note';

export default function AccessGate({ need, children }) {
  const a = useAcademicAccess();
  if (a.loading) return <LoadingBlock text="Checking your access…" />;
  if (a.error) return <Note tone="bad">{a.error.message}</Note>;
  if (!a.hasAnyRole) return <Note tone="warn">You have not been given an academic role yet. Ask the school owner to give you one (Academic set-up → Roles).</Note>;
  if (need && !a.can(need)) return <Note tone="warn">You do not have permission to use this page.</Note>;
  return typeof children === 'function' ? children(a) : children;
}
