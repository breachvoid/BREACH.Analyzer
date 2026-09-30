/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { 
  Eye, 
  Compass, 
  Percent, 
  Activity, 
  Maximize2, 
  SlidersHorizontal,
  Info
} from 'lucide-react';
import { audioAnalyzer } from '../audioEngine';
import { ResetButton, PopOutButton } from './SharedButtons';
import { AnalyzerConfig } from '../types';
import { resolvePalette } from '../utils';

// Helper to safely convert hex or rgb colors to transparent rgba variants
function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgb')) {
    if (hex.startsWith('rgba')) {
      return hex.replace(/[\d\.]+\)$/, `${alpha})`);
    }
    return hex.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
  }
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface StereoVectorScopeProps {
  isActive: boolean;
  isPoppedOut?: boolean;
  onPopOut?: () => void;
  resetRef?: React.MutableRefObject<(() => void) | null>;
  config?: AnalyzerConfig;
}

export function StereoVectorScope({ 
  isActive, 
  isPoppedOut = false, 
  onPopOut,
  resetRef,
  config
}: StereoVectorScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scaleFactor = 0.8; // constant scale factor for maximum layout consistency
  const plotStyle = 'glow'; // determined by requirements: always glow

  const minCorrRef = useRef<number>(1.0);
  const maxCorrRef = useRef<number>(1.0);
  const phaseCorrRef = useRef<number>(1.0);

  const peakHoldRef = useRef<HTMLDivElement | null>(null);
  const recentPeaks = useRef<{ value: number; timestamp: number }[]>([]);
  const lastActiveTime = useRef<number>(Date.now());

  const minCorrTextRef = useRef<HTMLSpanElement | null>(null);
  const phaseCorrTextRef = useRef<HTMLSpanElement | null>(null);
  const maxCorrTextRef = useRef<HTMLSpanElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const descRef = useRef<HTMLParagraphElement | null>(null);

  const palette = resolvePalette(config?.colorPalette || 'pioneer-rgb', config?.customColors);
  const strokeColor = palette.primary;

  // Pre-parse the strokeColor to enable high-performance color interpolation in the requestAnimationFrame loop
  const parsedStrokeColor = useMemo(() => {
    let hex = strokeColor;
    if (hex.startsWith('rgb')) {
      const match = hex.match(/\d+/g);
      if (match) {
        return {
          r: parseInt(match[0], 10),
          g: parseInt(match[1], 10),
          b: parseInt(match[2], 10),
        };
      }
    }
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
    const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
    const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
    return { r, g, b };
  }, [strokeColor]);

  const getCorrelationDescription = (corr: number): string => {
    if (corr > 0.9) {
      return "High correlation: Narrow/mono signal content perfectly aligned.";
    } else if (corr > 0.5) {
      return "High correlation: Strong in-phase signal, safe for mono compatibility.";
    } else if (corr >= 0) {
      return "Low correlation: Wide stereo field, check mono downmix.";
    } else {
      return "Out of phase: Signal contains phase cancellation, will disappear in mono!";
    }
  };

  // Reset peak correlation
  const handleResetPeak = () => {
    minCorrRef.current = 1.0;
    maxCorrRef.current = 1.0;
    phaseCorrRef.current = 1.0;
    recentPeaks.current = [];
    lastActiveTime.current = Date.now();

    if (minCorrTextRef.current) {
      minCorrTextRef.current.textContent = '-';
    }
    if (phaseCorrTextRef.current) {
      phaseCorrTextRef.current.textContent = '1.000';
    }
    if (maxCorrTextRef.current) {
      maxCorrTextRef.current.textContent = '1.000';
    }
    if (barRef.current) {
      barRef.current.style.left = '50%';
      barRef.current.style.width = '50%';
      barRef.current.className = "absolute top-0 bottom-0 transition-all duration-75 bg-[#b20000]";
    }
    if (peakHoldRef.current) {
      peakHoldRef.current.style.left = '100%';
      peakHoldRef.current.style.display = 'none';
    }
    if (descRef.current) {
      descRef.current.textContent = getCorrelationDescription(1.0);
    }
  };

  // Bind reset reference for popped out window support
  useEffect(() => {
    if (resetRef) {
      resetRef.current = handleResetPeak;
    }
    return () => {
      if (resetRef) {
        resetRef.current = null;
      }
    };
  }, [resetRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrame: number;
    
    // Allocate arrays for channel data
    const bufferLength = 1024;
    const timeDataL = new Float32Array(bufferLength);
    const timeDataR = new Float32Array(bufferLength);

    const draw = () => {
      animFrame = requestAnimationFrame(draw);
      const now = Date.now();

      // Prune recent peak list values older than 10 seconds
      while (recentPeaks.current.length > 0 && now - recentPeaks.current[0].timestamp > 10000) {
        recentPeaks.current.shift();
      }

      // --- 1. Real-time Phase Correlation Monitor update ---
      const metrics = audioAnalyzer.getMetrics();
      if (metrics) {
        const value = metrics.phaseCorrelation;
        phaseCorrRef.current = value;
        minCorrRef.current = Math.min(minCorrRef.current, value);
        maxCorrRef.current = Math.max(maxCorrRef.current, value);

        // Keep track of the current value in our rolling 10-second history
        recentPeaks.current.push({ value, timestamp: now });

        // Retrieve the lowest correlation reached over the last 10 seconds
        const peakHoldMin = recentPeaks.current.reduce((min, p) => p.value < min ? p.value : min, 1.0);

        const currMinCorr = minCorrRef.current;
        const currPhaseCorr = phaseCorrRef.current;
        const currMaxCorr = maxCorrRef.current;

        if (minCorrTextRef.current) {
          minCorrTextRef.current.textContent = currMinCorr < 0 ? currMinCorr.toFixed(3) : '-';
        }
        if (phaseCorrTextRef.current) {
          phaseCorrTextRef.current.textContent = currPhaseCorr.toFixed(3);
        }
        if (maxCorrTextRef.current) {
          maxCorrTextRef.current.textContent = currMaxCorr.toFixed(3);
        }
        if (barRef.current) {
          const leftPercent = currPhaseCorr >= 0 ? 50 : 50 - Math.abs(currPhaseCorr) * 50;
          const widthPercent = Math.abs(currPhaseCorr) * 50;
          barRef.current.style.left = `${leftPercent}%`;
          barRef.current.style.width = `${widthPercent}%`;
          
          if (currPhaseCorr >= 0.7) {
            barRef.current.className = "absolute top-0 bottom-0 transition-all duration-75 bg-[#b20000]";
          } else if (currPhaseCorr >= 0.0) {
            barRef.current.className = "absolute top-0 bottom-0 transition-all duration-75 bg-[#b20000]";
          } else {
            barRef.current.className = "absolute top-0 bottom-0 transition-all duration-75 bg-[#660000] border border-[#b20000]";
          }
        }

        // Position the yellow peak-hold tick
        if (peakHoldRef.current) {
          const isSourceActive = audioAnalyzer.isSourceActive();
          if (isSourceActive) {
            const peakPercent = (peakHoldMin + 1) * 50; // Map [-1.0, 1.0] to [0%, 100%]
            peakHoldRef.current.style.left = `${peakPercent}%`;
            peakHoldRef.current.style.display = 'block';
          } else {
            peakHoldRef.current.style.display = 'none';
          }
        }

        if (descRef.current) {
          const description = getCorrelationDescription(currPhaseCorr);
          if (descRef.current.textContent !== description) {
            descRef.current.textContent = description;
          }
        }
      }

      // --- 2. Goniometer rendering ---
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const renderRadius = Math.min(width, height) / 2 * scaleFactor;

      // Extract channel audio arrays
      const stereoAnalysers = audioAnalyzer.getStereoAnalysers();
      const leftAnal = stereoAnalysers.left;
      const rightAnal = stereoAnalysers.right;

      let rmsL = -120;
      let rmsR = -120;
      let isSilent = true;

      // Active check or signal calculation
      if (audioAnalyzer.isSourceActive() && leftAnal && rightAnal) {
        leftAnal.getFloatTimeDomainData(timeDataL);
        rightAnal.getFloatTimeDomainData(timeDataR);

        let sumSqL = 0;
        let sumSqR = 0;
        for (let i = 0; i < bufferLength; i++) {
          sumSqL += timeDataL[i] * timeDataL[i];
          sumSqR += timeDataR[i] * timeDataR[i];
        }
        rmsL = 10 * Math.log10(sumSqL / bufferLength + 1e-12);
        rmsR = 10 * Math.log10(sumSqR / bufferLength + 1e-12);

        // Treat below -85dBFS as silence to avoid micro-residual background noise causing static phosphor persistence
        if (rmsL > -85 || rmsR > -85) {
          isSilent = false;
        }
      }

      // Manage auto-reset trigger on silence/static signal
      if (!isSilent) {
        lastActiveTime.current = now;
      } else {
        const silentDuration = now - lastActiveTime.current;
        if (silentDuration > 3000) {
          // Clear stale phosphor decay trails
          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = '#070707';
          ctx.fillRect(0, 0, width, height);

          // Render centered idle point and standard radar grid, then exit early
          drawGrid(ctx, centerX, centerY, renderRadius, width, height);
          return;
        }
      }

      // Semi-transparent background fade for beautiful decay phosphor trails
      if (plotStyle === 'glow') {
        ctx.fillStyle = 'rgba(7, 7, 7, 0.14)'; // Slow, organic CRT phosphor decay rate
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#070707';
        ctx.fillRect(0, 0, width, height);
      }

      // Draw standard alignment grid
      drawGrid(ctx, centerX, centerY, renderRadius, width, height);

      // Render vector path if audio has signal
      if (!isSilent) {
        ctx.globalCompositeOperation = 'lighter';

        // High-performance GPU-accelerated Linear Gradients mapping stereo width to warning colors
        const gradientGlow = ctx.createLinearGradient(centerX - renderRadius, centerY, centerX + renderRadius, centerY);
        gradientGlow.addColorStop(0.5, `rgba(${parsedStrokeColor.r}, ${parsedStrokeColor.g}, ${parsedStrokeColor.b}, 0.12)`);
        gradientGlow.addColorStop(0.35, `rgba(${parsedStrokeColor.r}, ${parsedStrokeColor.g}, ${parsedStrokeColor.b}, 0.12)`);
        gradientGlow.addColorStop(0.65, `rgba(${parsedStrokeColor.r}, ${parsedStrokeColor.g}, ${parsedStrokeColor.b}, 0.12)`);
        gradientGlow.addColorStop(0.0, 'rgba(178, 0, 0, 0.20)'); // Out-of-phase area warning glow
        gradientGlow.addColorStop(1.0, 'rgba(178, 0, 0, 0.20)');

        const gradientCore = ctx.createLinearGradient(centerX - renderRadius, centerY, centerX + renderRadius, centerY);
        gradientCore.addColorStop(0.5, `rgba(${parsedStrokeColor.r}, ${parsedStrokeColor.g}, ${parsedStrokeColor.b}, 0.80)`);
        gradientCore.addColorStop(0.35, `rgba(${parsedStrokeColor.r}, ${parsedStrokeColor.g}, ${parsedStrokeColor.b}, 0.80)`);
        gradientCore.addColorStop(0.65, `rgba(${parsedStrokeColor.r}, ${parsedStrokeColor.g}, ${parsedStrokeColor.b}, 0.80)`);
        gradientCore.addColorStop(0.18, 'rgba(255, 51, 51, 0.85)');
        gradientCore.addColorStop(0.82, 'rgba(255, 51, 51, 0.85)');
        gradientCore.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
        gradientCore.addColorStop(1.0, 'rgba(255, 255, 255, 0.95)');

        // Pre-allocate coordinate float arrays for fast path drawing
        const sampleCount = 512;
        const pxArray = new Float32Array(sampleCount);
        const pyArray = new Float32Array(sampleCount);

        for (let i = 0; i < sampleCount; i++) {
          const sampleIdx = i * 2;
          const l = timeDataL[sampleIdx];
          const r = timeDataR[sampleIdx];

          // 45 degree vector rotation for goniometer mapping
          const side = (r - l) * 0.707;
          const mid = (l + r) * 0.707;

          pxArray[i] = centerX + side * renderRadius;
          pyArray[i] = centerY - mid * renderRadius;
        }

        // Pass 1: Broad soft outer CRT electron beam flare / glow (Single joint draw stroke)
        ctx.beginPath();
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = gradientGlow;
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = 4;

        ctx.moveTo(pxArray[0], pyArray[0]);
        for (let i = 1; i < sampleCount; i++) {
          ctx.lineTo(pxArray[i], pyArray[i]);
        }
        ctx.stroke();

        // Pass 2: Ultra-bright sharp high-density cathode core (Single joint draw stroke)
        ctx.beginPath();
        ctx.lineWidth = 1.0;
        ctx.strokeStyle = gradientCore;
        ctx.shadowBlur = 0; // Disable shadows for sharp physical core trace

        ctx.moveTo(pxArray[0], pyArray[0]);
        for (let i = 1; i < sampleCount; i++) {
          ctx.lineTo(pxArray[i], pyArray[i]);
        }
        ctx.stroke();

        ctx.globalCompositeOperation = 'source-over'; // Restore standard composition for overlays
      } else {
        // Draw centered idle point
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.beginPath();
        ctx.arc(centerX, centerY, 1.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    };

    // Isolated grid drawing function to prevent code repetition during auto-resets
    function drawGrid(
      ctx: CanvasRenderingContext2D, 
      centerX: number, 
      centerY: number, 
      renderRadius: number,
      width: number,
      height: number
    ) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;

      // Concentric circles
      ctx.beginPath();
      ctx.arc(centerX, centerY, renderRadius, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX, centerY, renderRadius * 0.5, 0, 2 * Math.PI);
      ctx.stroke();

      // Horizontal / Vertical crosshairs (M / Mono line)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - renderRadius);
      ctx.lineTo(centerX, centerY + renderRadius);
      ctx.stroke();

      // Horizontal (S / Side signal)
      ctx.beginPath();
      ctx.moveTo(centerX - renderRadius, centerY);
      ctx.lineTo(centerX + renderRadius, centerY);
      ctx.stroke();

      // 45-degree Left / Right boundary lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.moveTo(centerX + renderRadius * 0.707, centerY - renderRadius * 0.707);
      ctx.lineTo(centerX - renderRadius * 0.707, centerY + renderRadius * 0.707);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(centerX - renderRadius * 0.707, centerY - renderRadius * 0.707);
      ctx.lineTo(centerX + renderRadius * 0.707, centerY + renderRadius * 0.707);
      ctx.stroke();

      // Labels
      ctx.font = '10px "Geist Pixel", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('M (MONO)', centerX, centerY - renderRadius - 8);
      ctx.fillText('S (SIDE)', centerX - renderRadius - 15, centerY);
      ctx.fillText('L', centerX - renderRadius * 0.707 - 8, centerY - renderRadius * 0.707 - 8);
      ctx.fillText('R', centerX + renderRadius * 0.707 + 8, centerY - renderRadius * 0.707 - 8);
    }

    draw();

    return () => {
      cancelAnimationFrame(animFrame);
    };
  }, [scaleFactor, config, strokeColor, parsedStrokeColor]);

  return (
    <div 
      className={`bg-[#1a1a1a] flex flex-col select-none w-full ${
        isPoppedOut ? 'border-0 p-0 h-full' : 'border border-[#4a4a4a] overflow-hidden h-full'
      }`} 
      id="stereo-vector-scope-card"
    >
      {/* 1. Header with Title & Action Buttons (Reset/Popout) */}
      {!isPoppedOut && (
        <div className="flex flex-col md:flex-row md:items-center justify-between p-3 bg-[#121212] border-b border-[#4a4a4a] z-10 gap-3" id="vector-panel-header">
          <div className="flex items-center gap-2.5 cursor-default" title="Lissajous Mid/Side Phase Space Vector Monitor" id="vector-panel-title-group">
            <div className="p-1.5 bg-[#181818] border border-[#4a4a4a] text-[#b20000] flex items-center justify-center">
              <Compass className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-bold text-white tracking-[1.4px] font-sans uppercase">
              Phase Correlation & Stereo Scope
            </h3>
          </div>
          
          <div className="flex items-center gap-2">
            <ResetButton 
              onClick={handleResetPeak} 
              title="Reset captured correlation minimum limits"
            />
            
            {onPopOut && (
              <PopOutButton
                onClick={onPopOut}
                title="Pop out Phase Correlation and Stereo Vector Scope to a floating overlay window"
              />
            )}
          </div>
        </div>
      )}

      {/* Content wrapper with conditional padding to match standard margins */}
      <div 
        className={`flex flex-col space-y-4 flex-grow ${isPoppedOut ? 'p-0' : 'p-4'}`} 
        id="vector-panel-content"
        style={isPoppedOut ? undefined : { height: '510px', width: '499px' }}
      >

        {/* 2. Goniometer Canvas primary visual focus at the TOP of the content body */}
        <div className="flex flex-col space-y-3 pt-0" id="vector-scope-section">

        {/* Center the Goniometer Canvas or align it to match phase panel exactly */}
        <div 
          className="flex justify-center" 
          id="goniometer-focus"
          style={{
            borderWidth: '0px',
            backgroundColor: 'transparent',
            width: '430px',
            marginLeft: '17px',
            padding: '2px',
            marginTop: '8px'
          }}
        >
          <div className="relative w-full aspect-square bg-[#0e0e0e] border border-[#4a4a4a]">
            <canvas 
              ref={canvasRef} 
              width={426} 
              height={426}
              className="w-full h-full block bg-[#0e0e0e] border-0"
            />
          </div>
        </div>

      </div>

      {/* 3. HTML / React Phase Correlation Meter & Information Text */}
      <div className="flex flex-col w-[430px] ml-[17px] mt-2" id="react-correlation-panel">
        {/* Numbers strip: Min (-), Current, Max */}
        <div className="flex justify-between font-sans text-[11px] font-bold px-1 select-none text-white tracking-[1px] uppercase">
          <span ref={minCorrTextRef} className="text-left w-20 text-[#b20000]">-</span>
          <span ref={phaseCorrTextRef} className="text-center flex-grow text-white">1.000</span>
          <span ref={maxCorrTextRef} className="text-right w-20 text-white">1.000</span>
        </div>

        {/* Bar / Track */}
        <div className="w-full h-2 bg-[#121212] overflow-hidden relative border border-[#4a4a4a] mt-1">
          {/* Split warning area for the out-of-phase domain */}
          <div className="absolute left-0 top-0 bottom-0 w-1/2 bg-[#b20000]/20" />
          
          {/* Central tick dividing line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/40 z-10" />

          {/* Filled segment indicating current correlation */}
          <div 
            ref={barRef}
            className="absolute top-0 bottom-0 transition-all duration-75 bg-[#b20000]"
            style={{
              left: '50%',
              width: '50%'
            }}
          />

          {/* Persistent lowest peak hold indicator of last 10 seconds */}
          <div 
            ref={peakHoldRef}
            className="absolute top-0 bottom-0 w-0.5 bg-white z-20 transition-all duration-100 ease-out"
            style={{
              left: '100%',
              display: 'none'
            }}
          />
        </div>

        {/* Labels under the bar */}
        <div className="flex justify-between text-[10px] font-sans font-bold mt-1 px-1 tracking-[1px] select-none text-white uppercase">
          <span className="text-[#b20000] font-bold text-[10px] font-sans">-1.0 (OUT-OF-PHASE)</span>
          <span className="text-[#cccccc] font-bold text-[10px] font-sans">0.0 (WIDE STEREO)</span>
          <span className="text-[#cccccc] font-bold text-[10px] font-sans">+1.0 (MONO)</span>
        </div>

        {/* Subtle divider line */}
        <div className="border-t border-[#4a4a4a] my-2.5" />

        {/* Dynamic description of the phase status */}
        <p ref={descRef} className="text-[11px] font-sans font-normal text-center text-[#aaaaaa] leading-normal uppercase tracking-wider" id="correlation-explanation-text">
          High correlation: Narrow/mono signal content perfectly aligned.
        </p>
      </div>

      </div>

    </div>
  );
}
