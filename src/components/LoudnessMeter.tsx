/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import { RefreshCw, CheckCircle, AlertOctagon, Info, ArrowDown, ArrowUp, ExternalLink, Cpu } from 'lucide-react';
import { LoudnessMetrics, LoudnessStandard } from '../types';
import { audioAnalyzer, useAudioMetrics } from '../audioEngine';
import { formatLUFS, formatDB } from '../utils';
import { ResetButton, PopOutButton } from './SharedButtons';
import { usePersistentState } from '../utils/storage';

interface TrendSample {
  momentary: number;
  shortTerm: number;
  integrated: number;
  target: number;
  timestamp: number;
}

interface LoudnessMeterProps {
  isPlaying: boolean;
  targetLoudness: number;
  setTargetLoudness: (t: number) => void;
  onPopOut?: () => void;
  isPoppedOut?: boolean;
  activeSourceType?: string;
  fileUrl?: string;
}

export function LoudnessMeter({ 
  isPlaying, 
  targetLoudness, 
  setTargetLoudness, 
  onPopOut, 
  isPoppedOut = false,
  activeSourceType,
  fileUrl
}: LoudnessMeterProps) {
  const metricsRef = useRef<LoudnessMetrics>(audioAnalyzer.getMetrics());
  const historyRef = useRef<TrendSample[]>([]);
  const trendCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [trendSize, setTrendSize] = useState({ width: 600, height: 140 });
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);

  const [autoReset, setAutoReset] = usePersistentState<boolean>(
    'breach_loudness_auto_reset',
    false,
    (val) => typeof val === 'boolean'
  );

  // Dynamic DOM refs to bypass high frequency state re-renders
  const maxPeakTextRef = useRef<HTMLSpanElement | null>(null);
  const clipIndicatorRef = useRef<HTMLDivElement | null>(null);
  const clipDotRef = useRef<HTMLDivElement | null>(null);

  const peakLeftTextRef = useRef<HTMLSpanElement | null>(null);
  const peakLeftBarRef = useRef<HTMLDivElement | null>(null);

  const peakRightTextRef = useRef<HTMLSpanElement | null>(null);
  const peakRightBarRef = useRef<HTMLDivElement | null>(null);

  const momentaryBarRef = useRef<HTMLDivElement | null>(null);
  const momentaryTextRef = useRef<HTMLSpanElement | null>(null);

  const shortTermBarRef = useRef<HTMLDivElement | null>(null);
  const shortTermTextRef = useRef<HTMLSpanElement | null>(null);

  const integratedBarRef = useRef<HTMLDivElement | null>(null);
  const integratedTextRef = useRef<HTMLSpanElement | null>(null);

  const complianceBadgeRef = useRef<HTMLDivElement | null>(null);
  const complianceStatusHeaderRef = useRef<HTMLHeadingElement | null>(null);
  const complianceStatusDescRef = useRef<HTMLParagraphElement | null>(null);
  const complianceOffsetRowRef = useRef<HTMLDivElement | null>(null);
  const complianceOffsetValRef = useRef<HTMLSpanElement | null>(null);

  const matchedIconRef = useRef<HTMLDivElement | null>(null);
  const hotIconRef = useRef<HTMLDivElement | null>(null);
  const warmIconRef = useRef<HTMLDivElement | null>(null);
  const coolIconRef = useRef<HTMLDivElement | null>(null);
  const coldIconRef = useRef<HTMLDivElement | null>(null);
  const idleIconRef = useRef<HTMLDivElement | null>(null);

  const lraTextRef = useRef<HTMLSpanElement | null>(null);
  const crestFactorTextRef = useRef<HTMLSpanElement | null>(null);
  const maxMomentaryTextRef = useRef<HTMLSpanElement | null>(null);
  const maxShortTermTextRef = useRef<HTMLSpanElement | null>(null);

  const lastClipTimeRef = useRef<number>(0);



  const handleReset = () => {
    audioAnalyzer.resetMetrics();
    historyRef.current = [];
    lastClipTimeRef.current = 0;
  };

  // Keep track of previous source to detect changes
  const prevSourceRef = useRef<string>('');

  useEffect(() => {
    const currentSource = `${activeSourceType || ''}:${fileUrl || ''}`;
    if (prevSourceRef.current && prevSourceRef.current !== currentSource) {
      if (autoReset) {
        console.log('Auto-resetting LoudnessMeter measurements on source change:', currentSource);
        handleReset();
      }
    }
    prevSourceRef.current = currentSource;
  }, [activeSourceType, fileUrl, autoReset]);

  // Subscribe to real-time metrics thread directly using custom hook (zero re-render callback)
  useAudioMetrics((newMetrics) => {
    metricsRef.current = newMetrics;
    if (newMetrics.peakLeft >= 0 || newMetrics.peakRight >= 0) {
      lastClipTimeRef.current = Date.now();
    }
  });

  // Listen to container sizes dynamically via ResizeObserver
  useEffect(() => {
    const canvas = trendCanvasRef.current;
    if (!canvas) return;
    const wrapper = canvas.parentElement;
    if (!wrapper) return;

    const observer = new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        if (!canvas) return;
        for (const entry of entries) {
          const width = Math.floor(entry.contentRect.width) || 600;
          const height = Math.floor(entry.contentRect.height) || 140;
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            setTrendSize({ width, height });
          }
        }
      });
    });

    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  // Accumulate historical records at a stable 100ms rate
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const current = metricsRef.current;
      
      // Keep plot empty until audio starts playing
      if (current.momentary <= -119 && historyRef.current.length === 0) {
        return;
      }

      const sample: TrendSample = {
        momentary: current.momentary,
        shortTerm: current.shortTerm,
        integrated: current.integrated,
        target: targetLoudness,
        timestamp: Date.now()
      };

      historyRef.current.push(sample);

      // Max 60 seconds (10 Hz * 60 seconds = 600 points)
      if (historyRef.current.length > 600) {
        historyRef.current.shift();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, targetLoudness]);

  // Master Canvas Drawing Loop
  const renderTrendChart = () => {
    const canvas = trendCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = trendSize;
    if (width <= 0 || height <= 0) return;

    // Background
    ctx.fillStyle = '#070707';
    ctx.fillRect(0, 0, width, height);

    const dbMin = -60;
    const dbMax = 0;
    const dbRange = dbMax - dbMin;

    const dbToY = (db: number) => {
      const clamped = Math.max(dbMin, Math.min(dbMax, db));
      return ((dbMax - clamped) / dbRange) * height;
    };

    // Y Axis Grid lines
    const lufsGrids = [0, -5, -10, -14, -18, -24, -36, -48, -60];
    ctx.font = '11px "Geist Pixel", monospace';

    lufsGrids.forEach((g) => {
      const y = dbToY(g);
      ctx.beginPath();
      ctx.strokeStyle = g === -14 ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)';
      ctx.setLineDash(g === -14 ? [4, 4] : [2, 4]);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = g === targetLoudness ? '#FF3333' : '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(`${g} LU`, 10, y < 10 ? 10 : y - 3);
    });

    // Time subdivisions (60s total duration)
    const timeSegments = [10, 20, 30, 40, 50, 60];
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.setLineDash([2, 5]);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '11px "Geist Pixel", monospace';

    const history = historyRef.current;
    const len = history.length;

    timeSegments.forEach((sec) => {
      const x = width - (sec * (width / 60));
      if (x >= 0) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.fillText(`-${sec}s`, x, height - 6);
      }
    });
    ctx.setLineDash([]);

    // Target reference line
    const targetY = dbToY(targetLoudness);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 51, 51, 0.65)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([6, 4]);
    ctx.moveTo(0, targetY);
    ctx.lineTo(width, targetY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw reference block on right
    ctx.fillStyle = 'rgba(178, 0, 0, 0.2)';
    ctx.fillRect(width - 68, targetY - 10, 64, 20);
    ctx.strokeStyle = '#B20000';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(width - 68, targetY - 10, 64, 20);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px "Geist Pixel", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${targetLoudness} LUFS`, width - 36, targetY + 3);

    if (len === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px "Geist Pixel", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Awaiting live audio signals to draw trend timeline...', width / 2, height / 2);
      return;
    }

    const stepX = width / 600;
    const getX = (index: number) => {
      return width - ((len - 1 - index) * stepX);
    };

    // Path for glow under short term curve
    ctx.beginPath();
    ctx.moveTo(getX(0), height);
    for (let i = 0; i < len; i++) {
      ctx.lineTo(getX(i), dbToY(history[i].shortTerm));
    }
    ctx.lineTo(getX(len - 1), height);
    ctx.closePath();

    const fillGlow = ctx.createLinearGradient(0, 0, 0, height);
    fillGlow.addColorStop(0, 'rgba(178, 0, 0, 0.20)');
    fillGlow.addColorStop(1, 'rgba(178, 0, 0, 0.0)');
    ctx.fillStyle = fillGlow;
    ctx.fill();

    // Draw Momentary line (crimson red, thin)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 68, 68, 0.55)';
    ctx.lineWidth = 1;
    for (let i = 0; i < len; i++) {
      const x = getX(i);
      const y = dbToY(history[i].momentary);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw Short-term line (brand red, thick)
    ctx.beginPath();
    ctx.strokeStyle = '#B20000';
    ctx.lineWidth = 2.0;
    for (let i = 0; i < len; i++) {
      const x = getX(i);
      const y = dbToY(history[i].shortTerm);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Interactive Hover Pointer card and tracking lines
    if (hoverX !== null && hoverX >= 0 && hoverX <= width) {
      let i = Math.round(len - 1 - ((width - hoverX) / stepX));
      i = Math.max(0, Math.min(len - 1, i));

      const sample = history[i];
      if (sample) {
        const hx = getX(i);
        const yShort = dbToY(sample.shortTerm);
        const yMomentary = dbToY(sample.momentary);

        // Tracker vertical line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 1;
        ctx.moveTo(hx, 0);
        ctx.lineTo(hx, height);
        ctx.stroke();

        // Marker for Momentary
        ctx.beginPath();
        ctx.arc(hx, yMomentary, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#800000';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();

        // Marker for Short-term
        ctx.beginPath();
        ctx.arc(hx, yShort, 4.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#B20000';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.25;
        ctx.fill();
        ctx.stroke();

        // Tooltip container properties
        const boxWidth = 140;
        const boxHeight = 64;
        const elapsedSec = ((len - 1 - i) * 0.1).toFixed(1);

        let boxX = hx + 12;
        if (boxX + boxWidth > width) {
          boxX = hx - boxWidth - 12;
        }

        const boxY = hoverY !== null ? Math.min(height - boxHeight - 8, Math.max(8, hoverY - boxHeight / 2)) : height / 2 - boxHeight / 2;

        ctx.fillStyle = 'rgba(16, 16, 16, 0.95)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 6);
        } else {
          ctx.rect(boxX, boxY, boxWidth, boxHeight);
        }
        ctx.fill();
        ctx.stroke();

        // Timer
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 11px "Geist Pixel", monospace';
        ctx.fillText(`-${elapsedSec}s ago`, boxX + 8, boxY + 16);

        // Values
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '11px "Geist Pixel", monospace';
        ctx.fillText('Short-term:', boxX + 8, boxY + 32);
        ctx.fillStyle = '#FF3333';
        ctx.font = 'bold 12px "Geist Pixel", monospace';
        ctx.fillText(formatLUFS(sample.shortTerm), boxX + 82, boxY + 32);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '11px "Geist Pixel", monospace';
        ctx.fillText('Momentary:', boxX + 8, boxY + 48);
        ctx.fillStyle = '#FF6666';
        ctx.font = 'bold 12px "Geist Pixel", monospace';
        ctx.fillText(formatLUFS(sample.momentary), boxX + 82, boxY + 48);
      }
    }
  };

  const updateLiveMeterDOM = () => {
    const m = metricsRef.current;
    
    // 1. Max Peak Text
    if (maxPeakTextRef.current) {
      maxPeakTextRef.current.textContent = `Peak dBFS Max: ${formatDB(m.maxPeak)}`;
      if (m.maxPeak >= 0) {
        maxPeakTextRef.current.className = "text-[12px] font-mono font-bold text-[#FF3333]";
      } else {
        maxPeakTextRef.current.className = "text-[12px] font-mono font-bold text-white";
      }
    }

    // 2. Clipping Indicator and Dot
    const isClippingNow = Date.now() - lastClipTimeRef.current < 300;
    if (clipIndicatorRef.current) {
      if (isClippingNow) {
        clipIndicatorRef.current.className = "flex items-center gap-1.5 text-[10.5px] font-mono font-bold px-3 py-0.5 rounded border tracking-wider transition-all duration-150 bg-[#B20000] text-white border-[#FF3333] shadow-[0_0_12px_rgba(178,0,0,0.5)] font-bold";
      } else {
        clipIndicatorRef.current.className = "flex items-center gap-1.5 text-[10.5px] font-mono font-bold px-3 py-0.5 rounded border tracking-wider transition-all duration-150 bg-[#101010] text-white border-white/20 font-normal shadow-none";
      }
    }
    if (clipDotRef.current) {
      if (isClippingNow) {
        clipDotRef.current.className = "w-1.5 h-1.5 rounded-full transition-all duration-150 shrink-0 bg-white shadow-[0_0_8px_#ffffff]";
      } else {
        clipDotRef.current.className = "w-1.5 h-1.5 rounded-full transition-all duration-150 shrink-0 bg-white/40";
      }
    }

    // 3. Left Channel Peak
    if (peakLeftTextRef.current) {
      peakLeftTextRef.current.textContent = formatDB(m.peakLeft);
      if (m.peakLeft >= 0) {
        peakLeftTextRef.current.className = "text-[#FF3333] font-bold tabular-nums w-20 text-right text-[12px]";
      } else {
        peakLeftTextRef.current.className = "text-white font-bold tabular-nums w-20 text-right text-[12px]";
      }
    }
    if (peakLeftBarRef.current) {
      peakLeftBarRef.current.style.width = `${peakToPercent(m.peakLeft)}%`;
    }

    // 4. Right Channel Peak
    if (peakRightTextRef.current) {
      peakRightTextRef.current.textContent = formatDB(m.peakRight);
      if (m.peakRight >= 0) {
        peakRightTextRef.current.className = "text-[#FF3333] font-bold tabular-nums w-20 text-right text-[12px]";
      } else {
        peakRightTextRef.current.className = "text-white font-bold tabular-nums w-20 text-right text-[12px]";
      }
    }
    if (peakRightBarRef.current) {
      peakRightBarRef.current.style.width = `${peakToPercent(m.peakRight)}%`;
    }

    // 5. Momentary
    if (momentaryBarRef.current) {
      momentaryBarRef.current.style.width = `${lufsToPercent(m.momentary)}%`;
    }
    if (momentaryTextRef.current) {
      momentaryTextRef.current.textContent = formatLUFS(m.momentary);
    }

    // 6. Short term
    if (shortTermBarRef.current) {
      shortTermBarRef.current.style.width = `${lufsToPercent(m.shortTerm)}%`;
    }
    if (shortTermTextRef.current) {
      shortTermTextRef.current.textContent = formatLUFS(m.shortTerm);
    }

    // 7. Integrated
    if (integratedBarRef.current) {
      integratedBarRef.current.style.width = `${lufsToPercent(m.integrated)}%`;
    }
    if (integratedTextRef.current) {
      integratedTextRef.current.textContent = formatLUFS(m.integrated);
    }

    // 8. Compliance Status card
    const dVal = m.integrated > -120 ? m.integrated - targetLoudness : 0;
    type ComplianceState = 'idle' | 'matched' | 'hot' | 'warm' | 'cool' | 'cold';
    let status: ComplianceState = 'idle';

    if (m.integrated <= -120) {
      status = 'idle';
    } else if (Math.abs(dVal) <= 1.0) {
      status = 'matched';
    } else if (dVal > 3.0) {
      status = 'hot';
    } else if (dVal > 1.0) {
      status = 'warm';
    } else if (dVal < -3.0) {
      status = 'cold';
    } else {
      status = 'cool';
    }

    // Manage SVGs
    if (matchedIconRef.current) matchedIconRef.current.style.display = status === 'matched' ? 'block' : 'none';
    if (hotIconRef.current) hotIconRef.current.style.display = status === 'hot' ? 'block' : 'none';
    if (warmIconRef.current) warmIconRef.current.style.display = status === 'warm' ? 'block' : 'none';
    if (coolIconRef.current) coolIconRef.current.style.display = status === 'cool' ? 'block' : 'none';
    if (coldIconRef.current) coldIconRef.current.style.display = status === 'cold' ? 'block' : 'none';
    if (idleIconRef.current) idleIconRef.current.style.display = status === 'idle' ? 'block' : 'none';

    // Compliance badge/border card with multi-color feedback (Green, Red, Yellow, Cyan, Blue, Idle)
    if (complianceBadgeRef.current) {
      if (status === 'matched') {
        complianceBadgeRef.current.className = "lg:col-span-4 p-3.5 border flex flex-col justify-between bg-[#121212] border-emerald-500 text-emerald-400 transition-colors duration-150";
      } else if (status === 'hot') {
        complianceBadgeRef.current.className = "lg:col-span-4 p-3.5 border flex flex-col justify-between bg-[#121212] border-[#b20000] text-[#ff4444] transition-colors duration-150";
      } else if (status === 'warm') {
        complianceBadgeRef.current.className = "lg:col-span-4 p-3.5 border flex flex-col justify-between bg-[#121212] border-amber-500 text-amber-400 transition-colors duration-150";
      } else if (status === 'cool') {
        complianceBadgeRef.current.className = "lg:col-span-4 p-3.5 border flex flex-col justify-between bg-[#121212] border-cyan-500 text-cyan-400 transition-colors duration-150";
      } else if (status === 'cold') {
        complianceBadgeRef.current.className = "lg:col-span-4 p-3.5 border flex flex-col justify-between bg-[#121212] border-blue-500 text-blue-400 transition-colors duration-150";
      } else {
        complianceBadgeRef.current.className = "lg:col-span-4 p-3.5 border flex flex-col justify-between bg-[#181818] border-[#4a4a4a] text-[#aaaaaa] transition-colors duration-150";
      }
    }

    // Header title
    if (complianceStatusHeaderRef.current) {
      if (status === 'matched') complianceStatusHeaderRef.current.textContent = 'Loudness Compliant';
      else if (status === 'hot') complianceStatusHeaderRef.current.textContent = 'Deviation: Too Loud';
      else if (status === 'warm') complianceStatusHeaderRef.current.textContent = 'Deviation: Above Target';
      else if (status === 'cool') complianceStatusHeaderRef.current.textContent = 'Deviation: Below Target';
      else if (status === 'cold') complianceStatusHeaderRef.current.textContent = 'Deviation: Deep Underflow';
      else complianceStatusHeaderRef.current.textContent = 'Waiting to integrate';
    }

    // Description text
    if (complianceStatusDescRef.current) {
      if (status === 'matched') complianceStatusDescRef.current.textContent = "This stream's Integrated Loudness perfectly fits the target limit (+/-1.0 LU).";
      else if (status === 'hot') complianceStatusDescRef.current.textContent = "Your loudness is heavily over-limit (>3.0 LU). Platforms will severely attenuate your stream and peaks risk clipping.";
      else if (status === 'warm') complianceStatusDescRef.current.textContent = "Your loudness is slightly above target (+1.0 to +3.0 LU). Platforms will apply moderate attenuation.";
      else if (status === 'cool') complianceStatusDescRef.current.textContent = "Your loudness is slightly below target (-1.0 to -3.0 LU). Safe from clipping, with moderate headroom available.";
      else if (status === 'cold') complianceStatusDescRef.current.textContent = "Your mix is far below the target platform ceiling (>3.0 LU). Consider increasing master gain or makeup compression.";
      else complianceStatusDescRef.current.textContent = "Play an audio track or start synth generator loops to capture loudness margins.";
    }

    // Offset row and value
    if (complianceOffsetRowRef.current) {
      complianceOffsetRowRef.current.style.display = status === 'idle' ? 'none' : 'flex';
    }
    if (complianceOffsetValRef.current) {
      complianceOffsetValRef.current.textContent = `${dVal >= 0 ? '+' : ''}${dVal.toFixed(1)} LU`;
      if (status === 'matched') {
        complianceOffsetValRef.current.className = "text-sm text-emerald-400 font-bold";
      } else if (status === 'hot') {
        complianceOffsetValRef.current.className = "text-sm text-red-400 font-extrabold";
      } else if (status === 'warm') {
        complianceOffsetValRef.current.className = "text-sm text-amber-400 font-bold";
      } else if (status === 'cool') {
        complianceOffsetValRef.current.className = "text-sm text-cyan-400 font-semibold";
      } else if (status === 'cold') {
        complianceOffsetValRef.current.className = "text-sm text-blue-400 font-semibold";
      } else {
        complianceOffsetValRef.current.className = "text-sm text-white/45";
      }
    }

    // Diagnostic numbers
    if (lraTextRef.current) {
      lraTextRef.current.textContent = m.integrated <= -120 ? '0.0' : m.lra.toFixed(1);
    }
    if (crestFactorTextRef.current) {
      crestFactorTextRef.current.textContent = m.integrated <= -120 ? '0.0' : m.crestFactor.toFixed(1);
    }
    if (maxMomentaryTextRef.current) {
      maxMomentaryTextRef.current.textContent = formatLUFS(m.maxMomentary, 1);
    }
    if (maxShortTermTextRef.current) {
      maxShortTermTextRef.current.textContent = formatLUFS(m.maxShortTerm, 1);
    }
  };

  useEffect(() => {
    let animId: number;
    const draw = () => {
      renderTrendChart();
      updateLiveMeterDOM();
      animId = requestAnimationFrame(draw);
    };
    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [trendSize, hoverX, hoverY, targetLoudness]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = trendCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setHoverX(e.clientX - rect.left);
    setHoverY(e.clientY - rect.top);
  };

  // Convert decibels/LUFS to absolute percentage for meter visualization (maps -60dB to 0dB)
  const lufsToPercent = (val: number): number => {
    if (val === undefined || val <= -60) return 0;
    if (val >= 0) return 100;
    // Linear interpolation from -60 to 0
    return ((val + 60) / 60) * 100;
  };

  // Convert raw peaks to percent (maps -60dB to +3dB)
  const peakToPercent = (val: number): number => {
    if (val === undefined || val <= -60) return 0;
    if (val >= 3) return 100;
    // Scale -60 to +3 on linear bar
    return ((val + 60) / 63) * 100;
  };

  // Evaluate margin delta
  const initialMetrics = metricsRef.current;
  const delta = initialMetrics.integrated > -120 ? initialMetrics.integrated - targetLoudness : 0;
  let complianceStatus: 'matched' | 'hot' | 'low' | 'idle' = 'idle';
  
  if (initialMetrics.integrated <= -120) {
    complianceStatus = 'idle';
  } else if (Math.abs(delta) <= 1.0) {
    complianceStatus = 'matched';
  } else if (delta > 1.0) {
    complianceStatus = 'hot';
  } else {
    complianceStatus = 'low';
  }

  return (
    <div 
      className={`bg-[#1a1a1a] flex flex-col items-stretch ${
        isPoppedOut ? 'border-0 p-0 h-full' : 'border border-[#4a4a4a] overflow-hidden h-full'
      }`} 
      id="audio-loudness-meter"
    >
      
      {/* 1. Header with Reset and Target Selector */}
      {!isPoppedOut && (
        <div className="flex flex-col md:flex-row md:items-center justify-between p-3 bg-[#121212] border-b border-[#4a4a4a] z-10 gap-3" id="lufs-meter-header">
          <div className="flex items-center gap-2.5 cursor-default" title="ITU-R BS.1770-4 / EBU R128 standards" id="lufs-meter-title-group">
            <div className="p-1.5 bg-[#181818] border border-[#4a4a4a] text-[#b20000] flex items-center justify-center">
              <Cpu className="w-4 h-4" />
            </div>
            <h2 className="text-xs font-bold tracking-[1.4px] text-white uppercase font-sans">
              Loudness & Peak Analyzer
            </h2>
          </div>

          {/* Right: Reset and Pop out in the upper right corner */}
          <div className="flex items-center gap-2">
            <ResetButton
              id="btn-reset-meter-stats"
              onClick={handleReset}
              title="Wipe historical metrics and restart integration"
            />

            {onPopOut && (
              <PopOutButton
                id="btn-popout-loudness"
                onClick={onPopOut}
                title="Pop out loudness analyzer to a floating component window"
              />
            )}
          </div>
        </div>
      )}

      {/* Content wrapper with conditional padding to match standard margins */}
      <div 
        className={`flex flex-col space-y-4 flex-grow ${isPoppedOut ? 'p-0' : 'p-4'}`} 
        id="lufs-meter-content" 
      >

        {/* 2. Visual Level Meters (LUFS & Peak side-by-side or stacked) */}
        <div 
          className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-[#181818] p-3.5" 
          id="meters-stage" 
        >
        
        {/* L/R True Peak meters (dbFS) - columns 1-4 */}
        <div className="md:col-span-4 flex flex-col justify-between space-y-3" id="peak-meters-block">
          <div className="flex flex-col items-center justify-center bg-[#121212] p-2 border border-[#4a4a4a] gap-1.5">
            <span ref={maxPeakTextRef} className="text-[11px] font-sans font-bold uppercase tracking-[1px] text-white" id="peak-dbfs-max-text">
              Peak dBFS Max: -120.0
            </span>
            <div 
              ref={clipIndicatorRef}
              className="flex items-center gap-1.5 text-[10px] font-sans font-bold px-2.5 py-0.5 border tracking-[1px] transition-colors bg-[#181818] text-[#cccccc] border-[#4a4a4a]"
              style={{ height: '22px' }}
            >
              <div ref={clipDotRef} className="w-1.5 h-1.5 transition-colors shrink-0 bg-[#aaaaaa]" />
              <span>CLIP</span>
            </div>
          </div>

          {/* Meter levels bars */}
          <div className="space-y-3.5 pt-1.5">
            {/* Left Channel */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px] font-sans text-[#cccccc] uppercase tracking-[1px] font-bold">
                <span>CH 1 (Left Peak)</span>
                <span ref={peakLeftTextRef} className="text-white font-sans font-bold tabular-nums w-20 text-right text-[11px]">
                  -120.0 dB
                </span>
              </div>
              <div className="h-2.5 bg-[#121212] border border-[#4a4a4a] relative overflow-hidden flex" id="bar-peak-left">
                {/* 0dB mark line */}
                <div className="absolute right-[5.5%] top-0 bottom-0 w-0.5 bg-[#b20000] z-10" title="0dB Clip line" />
                <div 
                  ref={peakLeftBarRef}
                  className="h-full bg-[#b20000] transition-[width] duration-75 ease-out"
                  style={{ width: '0%' }}
                />
              </div>
            </div>

            {/* Right Channel */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px] font-sans text-[#cccccc] uppercase tracking-[1px] font-bold">
                <span>CH 2 (Right Peak)</span>
                <span ref={peakRightTextRef} className="text-white font-sans font-bold tabular-nums w-20 text-right text-[11px]">
                  -120.0 dB
                </span>
              </div>
              <div className="h-2.5 bg-[#121212] border border-[#4a4a4a] relative overflow-hidden flex" id="bar-peak-right">
                {/* 0dB mark line */}
                <div className="absolute right-[5.5%] top-0 bottom-0 w-0.5 bg-[#b20000] z-10" />
                <div 
                  ref={peakRightBarRef}
                  className="h-full bg-[#b20000] transition-[width] duration-75 ease-out"
                  style={{ width: '0%' }}
                />
              </div>
            </div>
          </div>

          {/* Indicator clips mapped perfectly to match scale percentages */}
          <div className="relative w-full h-[18px] text-[10px] font-sans text-[#aaaaaa] mt-1 pt-1 font-bold">
            <span className="absolute left-0 select-none text-[#aaaaaa] font-bold">-60 dB</span>
            <span className="absolute select-none text-[#aaaaaa] font-bold" style={{ left: '47.62%', transform: 'translateX(-50%)' }}>-30</span>
            <span className="absolute select-none text-[#aaaaaa] font-bold" style={{ left: '76.19%', transform: 'translateX(-50%)' }}>-12</span>
            <span className="absolute select-none text-[#aaaaaa] font-bold" style={{ left: '85.71%', transform: 'translateX(-50%)' }}>-6</span>
            <span className="absolute text-[#b20000] font-bold select-none" style={{ left: '95.24%', transform: 'translateX(-50%)' }}>0</span>
            <span className="absolute right-0 select-none text-[#aaaaaa] font-bold">+3</span>
          </div>
        </div>

        {/* M / S / I LUFS loudness meters - columns 5-12 */}
        <div className="md:col-span-8 flex flex-col justify-between space-y-3" id="loudness-meters-block">
          
          {/* LUFS labels metrics */}
          <div className="flex justify-between items-center bg-[#121212] p-1.5 px-2.5 gap-2">
            <span className="text-[11px] font-sans font-bold text-white uppercase tracking-[1px]">K-Weighted LUFS Loudness</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-[#aaaaaa] uppercase font-sans font-bold block shrink-0 tracking-[1px]">Target:</span>
              <select
                id="meter-select-lufs"
                value={targetLoudness}
                onChange={(e) => setTargetLoudness(parseFloat(e.target.value))}
                className="h-[28px] bg-[#181818] text-[11px] text-white font-bold border border-[#4a4a4a] hover:border-white px-2 py-0.5 font-sans cursor-pointer transition-colors uppercase tracking-[0.5px]"
                style={{ width: '190px' }}
              >
                {![
                  LoudnessStandard.SPOTIFY,
                  LoudnessStandard.APPLE_MUSIC,
                  LoudnessStandard.GENRE_JUNGLE_DNB,
                  LoudnessStandard.GENRE_EDM,
                  LoudnessStandard.GENRE_TECHNO_HOUSE,
                  LoudnessStandard.GENRE_ROCK_METAL,
                  LoudnessStandard.GENERIC_MUSIC,
                  LoudnessStandard.GENRE_ACOUSTIC_INDIE,
                  LoudnessStandard.GENRE_JAZZ,
                  LoudnessStandard.GENRE_CLASSICAL,
                  LoudnessStandard.BROADCAST_EBU,
                  LoudnessStandard.BROADCAST_ATSC,
                  LoudnessStandard.CINEMATIC_TRAILER,
                  LoudnessStandard.PODCAST_AUDIOBOOK,
                  LoudnessStandard.FILM_MIX
                ].includes(targetLoudness as any) && (
                  <option value={targetLoudness} disabled className="bg-[#181818] text-[#b20000] font-sans">
                    Custom ({typeof targetLoudness === 'number' ? targetLoudness.toFixed(1) : ''} LUFS)
                  </option>
                )}
                <optgroup label="Streaming Standards" className="bg-[#181818] text-[#b20000] font-bold text-[10px]">
                  <option value={LoudnessStandard.SPOTIFY} className="bg-[#181818] text-white font-sans">Spotify (-14.0 LUFS)</option>
                  <option value={LoudnessStandard.YOUTUBE} className="bg-[#181818] text-white font-sans">YouTube (-14.0 LUFS)</option>
                  <option value={LoudnessStandard.APPLE_MUSIC} className="bg-[#181818] text-white font-sans">Apple Music (-16.0 LUFS)</option>
                  <option value={LoudnessStandard.TIDAL_DEEZER} className="bg-[#181818] text-white font-sans">Tidal / Deezer (-14.0 LUFS)</option>
                </optgroup>
                
                <optgroup label="Music Genres" className="bg-[#181818] text-[#b20000] font-bold text-[10px]">
                  <option value={LoudnessStandard.GENRE_JUNGLE_DNB} className="bg-[#181818] text-white font-sans">Jungle / DnB (-5.0 LUFS)</option>
                  <option value={LoudnessStandard.GENRE_EDM} className="bg-[#181818] text-white font-sans">EDM / Club (-6.0 LUFS)</option>
                  <option value={LoudnessStandard.GENRE_TECHNO_HOUSE} className="bg-[#181818] text-white font-sans">Techno / House (-8.0 LUFS)</option>
                  <option value={LoudnessStandard.GENRE_ROCK_METAL} className="bg-[#181818] text-white font-sans">Rock / Metal (-9.0 LUFS)</option>
                  <option value={LoudnessStandard.GENRE_HIPHOP_RAP} className="bg-[#181818] text-white font-sans">Hip-Hop / Rap (-9.0 LUFS)</option>
                  <option value={LoudnessStandard.GENERIC_MUSIC} className="bg-[#181818] text-white font-sans">Pop Music / Top 40 (-10.0 LUFS)</option>
                  <option value={LoudnessStandard.GENRE_ACOUSTIC_INDIE} className="bg-[#181818] text-white font-sans">Acoustic / Indie (-12.0 LUFS)</option>
                  <option value={LoudnessStandard.GENRE_JAZZ} className="bg-[#181818] text-white font-sans">Jazz / Fusion (-15.0 LUFS)</option>
                  <option value={LoudnessStandard.GENRE_CLASSICAL} className="bg-[#181818] text-white font-sans">Classical / Orchestral (-18.0 LUFS)</option>
                </optgroup>

                <optgroup label="Broadcast Standards" className="bg-[#181818] text-[#b20000] font-bold text-[10px]">
                  <option value={LoudnessStandard.BROADCAST_EBU} className="bg-[#181818] text-white font-sans">EBU R128 (-23.0 LUFS)</option>
                  <option value={LoudnessStandard.BROADCAST_ATSC} className="bg-[#181818] text-white font-sans">ATSC A/85 (-24.0 LUFS)</option>
                </optgroup>

                <optgroup label="Specialty & Mediums" className="bg-[#181818] text-[#b20000] font-bold text-[10px]">
                  <option value={LoudnessStandard.CINEMATIC_TRAILER} className="bg-[#181818] text-white font-sans">Cinematic Trailer (-13.0 LUFS)</option>
                  <option value={LoudnessStandard.PODCAST_AUDIOBOOK} className="bg-[#181818] text-white font-sans">Podcast / Audiobook (-16.0 LUFS)</option>
                  <option value={LoudnessStandard.FILM_MIX} className="bg-[#181818] text-white font-sans">Film Mix (-18.0 LUFS)</option>
                </optgroup>
              </select>
            </div>
          </div>

          {/* Faders */}
          <div className="space-y-2.5 pt-1 font-sans">
            
            {/* 1. Momentary Loudness */}
            <div className="flex items-center gap-3 w-full">
              <span className="w-24 shrink-0 text-[10px] font-sans font-bold text-[#cccccc] uppercase tracking-[1px] select-none" title="400ms energy level">Momentary</span>
              <div className="flex-1 min-w-0 h-2.5 bg-[#121212] border border-[#4a4a4a] relative overflow-hidden">
                {/* Target overlay line */}
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-white z-10" 
                  style={{ left: `${lufsToPercent(targetLoudness)}%` }}
                  title="Target loudness reference line"
                />
                <div 
                  ref={momentaryBarRef}
                  className="h-full bg-[#b20000] transition-[width] duration-75 ease-out"
                  style={{ width: '0%' }}
                />
              </div>
              <span ref={momentaryTextRef} className="w-24 shrink-0 text-[11px] font-sans font-bold tabular-nums text-right text-white">
                -120.0 LUFS
              </span>
            </div>

            {/* 2. Short-Term Loudness */}
            <div className="flex items-center gap-3 w-full">
              <span className="w-24 shrink-0 text-[10px] font-sans font-bold text-[#cccccc] uppercase tracking-[1px] select-none" title="3-second sliding window average">Short-term</span>
              <div className="flex-1 min-w-0 h-2.5 bg-[#121212] border border-[#4a4a4a] relative overflow-hidden">
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-white z-10" 
                  style={{ left: `${lufsToPercent(targetLoudness)}%` }}
                />
                <div 
                  ref={shortTermBarRef}
                  className="h-full bg-[#b20000] transition-[width] duration-75 ease-out"
                  style={{ width: '0%' }}
                />
              </div>
              <span ref={shortTermTextRef} className="w-24 shrink-0 text-[11px] font-sans font-bold tabular-nums text-right text-white">
                -120.0 LUFS
              </span>
            </div>

            {/* 3. Integrated Loudness */}
            <div className="flex items-center gap-3 w-full">
              <span className="w-24 shrink-0 text-[10px] font-sans font-bold text-[#cccccc] uppercase tracking-[1px] select-none" title="Dual-gated continuous average loudness">Integrated</span>
              <div className="flex-1 min-w-0 h-3.5 bg-[#121212] relative overflow-hidden border border-[#4a4a4a]">
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-white z-10" 
                  style={{ left: `${lufsToPercent(targetLoudness)}%` }}
                />
                <div 
                  ref={integratedBarRef}
                  className="h-full bg-[#b20000] transition-[width] duration-75 ease-out"
                  style={{ width: '0%' }}
                />
              </div>
              <span ref={integratedTextRef} className="w-24 shrink-0 text-[12px] font-sans tabular-nums font-bold text-right text-white">
                -120.0 LUFS
              </span>
            </div>

          </div>

          {/* Scale row aligned precisely to match bar levels horizontally */}
          <div className="flex items-center gap-3 w-full text-[10px] font-sans font-bold text-[#aaaaaa] mt-2 pt-1.5" id="lufs-scale-row">
            <div className="w-24 shrink-0" />
            <div className="flex-1 min-w-0 relative h-[16px]">
              <span className="absolute left-0 select-none text-[10px] text-[#aaaaaa] font-bold">-60 LUFS</span>
              <span className="absolute select-none text-[10px] text-[#aaaaaa] font-bold" style={{ left: '20%', transform: 'translateX(-50%)' }}>-48</span>
              <span className="absolute select-none text-[10px] text-[#aaaaaa] font-bold" style={{ left: '40%', transform: 'translateX(-50%)' }}>-36</span>
              <span className="absolute select-none text-[10px] text-[#aaaaaa] font-bold" style={{ left: '70%', transform: 'translateX(-50%)' }}>-18</span>
              <span className="absolute text-[#b20000] font-bold font-sans text-[11px] select-none" style={{ left: `${lufsToPercent(targetLoudness)}%`, transform: 'translateX(-50%)' }}>
                {targetLoudness}
              </span>
              <span className="absolute right-0 select-none text-[10px] text-[#aaaaaa] font-bold">0</span>
            </div>
            <div className="w-24 shrink-0" />
          </div>

        </div>

      </div>

      {/* 2.5 Historical Trend Timeline (Last 60 Seconds) */}
      <div className="bg-[#181818] p-3.5 flex flex-col space-y-2" id="trend-stage">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-[#b20000]" />
            <span className="text-[11px] font-sans font-bold tracking-[1.2px] text-white uppercase">
              Loudness Timeline (Past 60 Seconds)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-sans font-bold text-[#cccccc] uppercase tracking-[1px]">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-1 bg-[#b20000]" />
              <span>Short-Term (3s)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 bg-[#666666]" />
              <span>Momentary (400ms)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 border-t border-dashed border-[#b20000]" />
              <span className="text-white font-bold">Target Limit</span>
            </div>
          </div>
        </div>

        {/* Canvas container */}
        <div className="relative h-[210px] w-full bg-[#0e0e0e] border border-[#4a4a4a] overflow-hidden cursor-crosshair">
          <canvas
            ref={trendCanvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => {
              setHoverX(null);
              setHoverY(null);
            }}
            className="absolute inset-0 block w-full h-full"
          />
        </div>
      </div>

      {/* 3. Compliance and Diagnosis Warning Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch" id="compliance-block">
        
        {/* Compliance box (Left 4 cols) */}
        <div ref={complianceBadgeRef} className="lg:col-span-4 p-3.5 border flex flex-col justify-between bg-[#181818] border-[#4a4a4a] text-[#aaaaaa] transition-colors duration-150" id="compliance-badge-card">
          <div className="flex items-start gap-2.5">
            <div ref={matchedIconRef} style={{ display: 'none' }} className="flex-shrink-0"><CheckCircle className="w-5 h-5 text-emerald-400" /></div>
            <div ref={hotIconRef} style={{ display: 'none' }} className="flex-shrink-0"><ArrowUp className="w-5 h-5 text-[#ff4444]" /></div>
            <div ref={warmIconRef} style={{ display: 'none' }} className="flex-shrink-0"><ArrowUp className="w-5 h-5 text-amber-400" /></div>
            <div ref={coolIconRef} style={{ display: 'none' }} className="flex-shrink-0"><ArrowDown className="w-5 h-5 text-cyan-400" /></div>
            <div ref={coldIconRef} style={{ display: 'none' }} className="flex-shrink-0"><ArrowDown className="w-5 h-5 text-blue-400" /></div>
            <div ref={idleIconRef} style={{ display: 'block' }} className="flex-shrink-0"><Info className="w-5 h-5 text-[#aaaaaa]" /></div>

            <div className="space-y-0.5 animate-fade-in-quick">
              <h3 ref={complianceStatusHeaderRef} className="text-xs font-bold font-sans uppercase tracking-[1.4px] text-white">
                Waiting to integrate
              </h3>
              <p ref={complianceStatusDescRef} className="text-[11px] text-[#aaaaaa] leading-normal font-sans">
                Play an audio track or start synth generator loops to capture loudness margins.
              </p>
            </div>
          </div>

          {/* Delta math tag */}
          <div ref={complianceOffsetRowRef} style={{ display: 'none' }} className="mt-2 text-[10px] font-sans font-bold flex items-center justify-between border-t border-[#4a4a4a] pt-1.5 uppercase tracking-[1px]">
            <span className="text-white">Mismatch Offset:</span>
            <span ref={complianceOffsetValRef} className="text-[12px] text-white font-sans font-bold">
              0.0 LU
            </span>
          </div>
        </div>

        {/* Diagnostic Audio Specs (Right 8 cols) - Stacked horizontal panels with tooltip hover */}
        <div 
          className="lg:col-span-8 flex flex-col justify-between gap-2" 
          id="measurement-details-matrix" 
        >
          
          <div 
            title="Loudness Range (LRA): Quantified macro dynamic range spread of files."
            className="flex items-center justify-between bg-[#181818] p-2.5 px-3.5 border border-[#4a4a4a] cursor-default hover:border-white transition-colors"
          >
            <h4 className="text-[10px] font-sans font-bold tracking-[1.2px] text-[#cccccc] uppercase">Loudness Range (LRA)</h4>
            <div className="flex items-baseline gap-1 font-sans">
              <span ref={lraTextRef} className="text-[15px] font-bold text-white font-sans">
                0.0
              </span>
              <span className="text-[11px] text-[#aaaaaa] font-bold uppercase">LU</span>
            </div>
          </div>

          <div 
            title="Crest Factor: Peak-to-RMS power density. Higher is more dynamic."
            className="flex items-center justify-between bg-[#181818] p-2.5 px-3.5 border border-[#4a4a4a] cursor-default hover:border-white transition-colors"
          >
            <h4 className="text-[10px] font-sans font-bold tracking-[1.2px] text-[#cccccc] uppercase">Crest Factor</h4>
            <div className="flex items-baseline gap-1 font-sans">
              <span ref={crestFactorTextRef} className="text-[15px] font-bold text-white font-sans">
                0.0
              </span>
              <span className="text-[11px] text-[#aaaaaa] font-bold uppercase">dB</span>
            </div>
          </div>

          <div 
            title="Max Momentary: Shortest peak transient loudness caught over a 400ms sliding window."
            className="flex items-center justify-between bg-[#181818] p-2.5 px-3.5 border border-[#4a4a4a] cursor-default hover:border-white transition-colors"
          >
            <h4 className="text-[10px] font-sans font-bold tracking-[1.2px] text-[#cccccc] uppercase">Max Momentary</h4>
            <div className="flex items-baseline gap-1 font-sans">
              <span ref={maxMomentaryTextRef} className="text-[15px] font-bold text-white font-sans">
                -120.0 LUFS
              </span>
            </div>
          </div>

          <div 
            title="Max Short-term: Highest block window energy computed over 3-second segments."
            className="flex items-center justify-between bg-[#181818] p-2.5 px-3.5 border border-[#4a4a4a] cursor-default hover:border-white transition-colors"
          >
            <h4 className="text-[10px] font-sans font-bold tracking-[1.2px] text-[#cccccc] uppercase">Max Short-term</h4>
            <div className="flex items-baseline gap-1 font-sans">
              <span ref={maxShortTermTextRef} className="text-[15px] font-bold text-white font-sans">
                -120.0 LUFS
              </span>
            </div>
          </div>

        </div>

      </div>

      </div>

    </div>
  );
}
