import React from 'react';
import { Link } from 'react-router-dom';
export default function NotFound({ basePath = '/elimu' }) {
  return (
    <div className="max-w-md mx-auto p-6 text-center">
      <h1 className="text-lg font-bold text-[#12261F]">We could not find that page</h1>
      <p className="text-sm text-slate-600 mt-2">The page may have moved, or the link may be old or mistyped. You can go back to the home page and find what you need from the menu.</p>
      <div className="flex flex-wrap justify-center gap-2 mt-4">
        <Link to={basePath} className="inline-flex items-center min-h-[44px] px-4 rounded-xl bg-[#1F6B45] text-white text-sm font-medium">Go to home</Link>
        <Link to={`${basePath}/help`} className="inline-flex items-center min-h-[44px] px-4 rounded-xl border border-[#DDD6B6] bg-white text-sm">Help</Link>
      </div>
    </div>
  );
}
