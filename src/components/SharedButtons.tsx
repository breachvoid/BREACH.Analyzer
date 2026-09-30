/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RefreshCw, ExternalLink, Minus, Plus } from 'lucide-react';

export interface StandardIconButtonProps {
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  title?: string;
  id?: string;
  className?: string;
}

export function MinimizeButton({ title = "Minimize panel", onClick, id, className, isMinimized = false }: StandardIconButtonProps & { isMinimized?: boolean }) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={`p-1.5 bg-[#181818] border border-[#4a4a4a] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] text-[#B8B8B8] transition-colors duration-150 flex items-center justify-center cursor-pointer flex-shrink-0 ${className || ''}`}
      title={title}
    >
      {isMinimized ? (
        <Plus className="w-3.5 h-3.5" />
      ) : (
        <Minus className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

export function ResetButton({ title = "Reset analytics data", onClick, id, className }: StandardIconButtonProps) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={`p-1.5 bg-[#181818] border border-[#4a4a4a] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] text-[#B8B8B8] transition-colors duration-150 flex items-center justify-center cursor-pointer ${className || ''}`}
      title={title}
    >
      <RefreshCw className="w-3.5 h-3.5" />
    </button>
  );
}

export function PopOutButton({ title = "Pop out panel to floating window", onClick, id, className }: StandardIconButtonProps) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={`p-1.5 bg-[#181818] border border-[#4a4a4a] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] text-[#B8B8B8] transition-colors duration-150 flex items-center justify-center cursor-pointer flex-shrink-0 ${className || ''}`}
      title={title}
    >
      <ExternalLink className="w-3.5 h-3.5" />
    </button>
  );
}

export interface DockButtonProps {
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  id?: string;
  className?: string;
  label?: string;
}

export function DockButton({ label = "Dock Panel", onClick, id, className }: DockButtonProps) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={`p-1.5 bg-[#181818] border border-[#4a4a4a] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] text-[#B8B8B8] transition-colors duration-150 flex items-center justify-center cursor-pointer text-[11px] font-sans font-medium uppercase tracking-[0.8px] px-2.5 flex-shrink-0 ${className || ''}`}
      title="Dock back to default panel layout"
    >
      {label}
    </button>
  );
}
