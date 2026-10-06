import React from 'react';

/** Native disclosure keeps panel help available to keyboard and touch users. */
export function PanelInfo({ label, children }: { label: string; children: React.ReactNode }) {
  return <details className="relative shrink-0 text-[#999] normal-case tracking-normal">
    <summary aria-label={label} title={label} className="list-none cursor-pointer border border-[#383838] w-6 h-6 text-center leading-6 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-white">ⓘ</summary>
    <div className="absolute right-0 top-full mt-2 z-50 w-[min(18rem,75vw)] p-3 bg-[#121212] border border-[#4a4a4a] shadow-xl text-[11px] leading-relaxed font-sans">{children}</div>
  </details>;
}
