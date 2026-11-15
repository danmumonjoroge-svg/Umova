// Elimu bottom sheet: the same props as the POS Sheet ({ title, onClose, children }) but built for phones:
// it never grows past the visible screen (dvh follows the browser bar and the on-screen keyboard), the body scrolls, and the
// close button + title stay pinned so a long form can always be reached and saved.
import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function AppSheet({ title, onClose, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl flex flex-col shadow-2xl" style={{ maxHeight: '92dvh' }} onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[#DDD6B6] sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between px-4 pt-2 pb-1 shrink-0">
          <h3 className="font-bold text-[#23382B] text-base">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center text-[#6F7461]"><X size={20} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]" style={{ WebkitOverflowScrolling: 'touch' }}>{children}</div>
      </div>
    </div>
  );
}
