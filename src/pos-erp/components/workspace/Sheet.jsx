// src/pos-erp/components/workspace/Sheet.jsx
// Bottom sheet on a phone, centred dialog on larger screens. Shared by Folios and Rooms & Stays.
import React from 'react';
import { X } from 'lucide-react';

export const fieldClass = 'w-full border border-[#DDE3DD] rounded-xl px-3 min-h-[48px] text-sm bg-white min-w-0';

export default function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 pb-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-[#26352D]">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="w-10 h-10 flex items-center justify-center text-[#68756D]"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
