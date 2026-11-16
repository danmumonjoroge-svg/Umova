// elimu/app/shell/states.jsx -- the four building blocks every page uses for loading / error / empty / layout, so they look and behave alike.
import React from 'react';
import { Loader2, AlertTriangle, Inbox } from 'lucide-react';

export const LoadingState = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#5A6B5E]" role="status"><Loader2 size={16} className="animate-spin" />{label}</div>
);
export const ErrorState = ({ message = 'Something went wrong.', onRetry }) => (
  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
    <div className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{message}</span></div>
    {onRetry && <button type="button" onClick={onRetry} className="mt-3 h-10 rounded-xl border border-red-300 bg-white px-4 font-semibold text-red-800">Try again</button>}
  </div>
);
export const EmptyState = ({ title, hint, action }) => (
  <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#D9D2B4] bg-white/60 px-4 py-10 text-center">
    <Inbox size={26} className="mb-2 text-[#8A9A8D]" /><div className="font-semibold text-[#23382B]">{title}</div>
    {hint && <p className="mt-1 max-w-xs text-sm text-[#5A6B5E]">{hint}</p>}{action && <div className="mt-4">{action}</div>}
  </div>
);
export const PageContainer = ({ title, subtitle, actions, children }) => (
  <section className="pb-4">
    {(title || actions) && (
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">{title && <h1 className="text-xl font-extrabold tracking-tight text-[#173D2A]">{title}</h1>}{subtitle && <p className="mt-0.5 text-sm text-[#5A6B5E]">{subtitle}</p>}</div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    )}
    {children}
  </section>
);
