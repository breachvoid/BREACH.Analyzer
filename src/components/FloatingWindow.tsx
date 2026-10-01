/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Minimize2, Minimize, Maximize2, Move, Copy, Check, Link } from 'lucide-react';
import { ResetButton, DockButton } from './SharedButtons';
import { SafeStorage } from '../utils/storage';

interface FloatingWindowProps {
  title: string;
  subtitle?: string;
  onDock: () => void;
  onReset?: () => void;
  children: React.ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  id: string;
  overlayParam?: string;
}

export function FloatingWindow({
  title,
  subtitle,
  onDock,
  onReset,
  children,
  defaultWidth = 800,
  defaultHeight = 450,
  id,
  overlayParam,
}: FloatingWindowProps) {
  const [position, setPosition] = useState({ x: 50, y: 100 });
  const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight });
  const [isMaximized, setIsMaximized] = useState(false);
  const [copied, setCopied] = useState(false);

  const latestPositionRef = useRef(position);
  useEffect(() => {
    latestPositionRef.current = position;
  }, [position]);

  const handleCopyUrl = () => {
    if (typeof window === 'undefined') return;
    const resolvedParam = overlayParam || (id.includes('visualizer') ? 'spectrum' : 'loudness');
    const overlayUrl = `${window.location.origin}${window.location.pathname}?overlay=${resolvedParam}`;
    navigator.clipboard.writeText(overlayUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy overlay URL:', err);
    });
  };

  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; startW: number; startH: number } | null>(null);

  // Position windows uniquely so they do not overlap perfectly initially
  useEffect(() => {
    const saved = SafeStorage.get<{ x: number; y: number }>(`breach_floating_window_pos_${id}`, null, (val) => {
      return val !== null && typeof val === 'object' && typeof (val as any).x === 'number' && typeof (val as any).y === 'number';
    });
    if (saved) {
      setPosition(saved);
      return;
    }

    const isLoudness = id.includes('loudness');
    const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const height = typeof window !== 'undefined' ? window.innerHeight : 800;
    
    if (isLoudness) {
      setPosition({
        x: Math.max(20, Math.floor(width / 2) - Math.floor(defaultWidth / 2) + 40),
        y: Math.max(20, Math.floor(height / 2) - Math.floor(defaultHeight / 2) + 60),
      });
    } else {
      setPosition({
        x: Math.max(20, Math.floor(width / 2) - Math.floor(defaultWidth / 2) - 40),
        y: Math.max(20, Math.floor(height / 2) - Math.floor(defaultHeight / 2) - 40),
      });
    }
  }, [id, defaultWidth, defaultHeight]);

  const mouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const mouseUpRef = useRef<(() => void) | null>(null);

  const stableMouseMove = React.useCallback((e: MouseEvent) => {
    if (mouseMoveRef.current) mouseMoveRef.current(e);
  }, []);

  const stableMouseUp = React.useCallback(() => {
    if (mouseUpRef.current) mouseUpRef.current();
  }, []);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    // Only drag with left click and not on inner buttons
    if (e.button !== 0 || isMaximized) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('select') || target.closest('input')) return;

    e.preventDefault();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: position.x,
      startY: position.y,
    };

    document.addEventListener('mousemove', stableMouseMove);
    document.addEventListener('mouseup', stableMouseUp);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || isMaximized) return;
    e.preventDefault();
    e.stopPropagation();

    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startW: size.width,
      startH: size.height,
    };

    document.addEventListener('mousemove', stableMouseMove);
    document.addEventListener('mouseup', stableMouseUp);
  };

  const handleGlobalMouseMove = (e: MouseEvent) => {
    if (dragStartRef.current) {
      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;
      
      const newX = dragStartRef.current.startX + deltaX;
      // Allow dragging out slightly, but prevent total off-screen loss
      const newY = Math.max(0, dragStartRef.current.startY + deltaY);

      const nextPos = { x: newX, y: newY };
      latestPositionRef.current = nextPos;
      setPosition(nextPos);
    }

    if (resizeStartRef.current) {
      const deltaX = e.clientX - resizeStartRef.current.mouseX;
      const deltaY = e.clientY - resizeStartRef.current.mouseY;

      const newW = Math.max(400, resizeStartRef.current.startW + deltaX);
      const newH = Math.max(250, resizeStartRef.current.startH + deltaY);

      setSize({ width: newW, height: newH });
    }
  };

  const handleGlobalMouseUp = () => {
    if (dragStartRef.current) {
      SafeStorage.set(`breach_floating_window_pos_${id}`, latestPositionRef.current);
    }
    dragStartRef.current = null;
    resizeStartRef.current = null;
    document.removeEventListener('mousemove', stableMouseMove);
    document.removeEventListener('mouseup', stableMouseUp);
  };

  useEffect(() => {
    mouseMoveRef.current = handleGlobalMouseMove;
    mouseUpRef.current = handleGlobalMouseUp;
  });

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', stableMouseMove);
      document.removeEventListener('mouseup', stableMouseUp);
    };
  }, [stableMouseMove, stableMouseUp]);

  return (
    <div
      id={id}
      className="fixed bg-[#1a1a1a] border border-[#4a4a4a] flex flex-col overflow-hidden shadow-2xl select-none z-40 group"
      style={{
        left: isMaximized ? 0 : `${position.x}px`,
        top: isMaximized ? 0 : `${position.y}px`,
        width: isMaximized ? '100vw' : `${size.width}px`,
        height: isMaximized ? '100vh' : `${size.height}px`,
        transition: dragStartRef.current || resizeStartRef.current ? 'none' : 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Dynamic Title Bar / Window Handler */}
      <div
        className="h-10 bg-[#121212] border-b border-[#4a4a4a] flex items-center justify-between px-3.5 cursor-move shrink-0"
        onMouseDown={handleHeaderMouseDown}
        id={`${id}-titlebar`}
      >
        <div className="flex items-center gap-2 max-w-[50%] overflow-hidden">
          <Move className="w-3.5 h-3.5 text-[#b20000] shrink-0" />
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2 overflow-hidden text-ellipsis whitespace-nowrap">
            <span className="text-[12px] font-sans leading-none tracking-[1.4px] text-[#F2F2F2] font-semibold uppercase select-none shrink-0">
              {title}
            </span>
            {subtitle && (
              <span className="text-[10px] text-[#858585] font-sans tracking-wide uppercase leading-none select-none text-ellipsis overflow-hidden">
                • {subtitle}
              </span>
            )}
          </div>
        </div>

        {/* Windows Controls Deck */}
        <div className="flex items-center gap-1.5 shrink-0">
          <DockButton onClick={onDock} id={`${id}-ctl-dock`} />

          {onReset && (
            <ResetButton onClick={onReset} id={`${id}-ctl-reset`} title="Reset analytics data for this panel" />
          )}
        </div>
      </div>

      {/* Embedded Component Canvas viewport */}
      <div className="flex-grow min-h-0 bg-[#1a1a1a] relative" id={`${id}-body-wrapper`}>
        {children}
      </div>

      {/* Resize Grip handle (only on non-maximized mode) */}
      {!isMaximized && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 z-50 text-[#4a4a4a] hover:text-white"
          onMouseDown={handleResizeMouseDown}
          id={`${id}-ctl-resize`}
        >
          {/* Subtle diagonal lines */}
          <svg width="8" height="8" viewBox="0 0 8 8" className="fill-current">
            <line x1="6" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1" />
            <line x1="6" y1="3" x2="3" y2="6" stroke="currentColor" strokeWidth="1" />
          </svg>
        </div>
      )}
    </div>
  );
}
