/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { 
  ZoomIn, 
  ZoomOut, 
  Lock, 
  Unlock, 
  Volume2, 
  Play, 
  Pause, 
  Plus, 
  Minus, 
  ChevronLeft, 
  ChevronRight, 
  Disc,
  RotateCw,
  Sliders,
  Snowflake,
  Activity,
  Layers,
  Sparkles
} from 'lucide-react';
import { audioAnalyzer, useStreamMetadata } from '../audioEngine';
import { AnalyzerConfig } from '../types';
import { PopOutButton, ResetButton } from './SharedButtons';
import { detectBpmFromAudio, detectKeyFromAudio } from '../utils/audioAnalysis';

export interface DJWaveformDeckProps {
  fileUrl?: string;
  fileName?: string;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  togglePlaybackRef?: React.MutableRefObject<(() => void) | null>;
  isPoppedOut?: boolean;
  onPopOut?: () => void;
  config?: AnalyzerConfig;
}

interface WaveSlice {
  peak: number;        // Peak amplitude (0..1)
  rms: number;         // RMS power (0..1)
  lowEnergy: number;   // 20-250 Hz bass/kick energy (0..1)
  midEnergy: number;   // 250-4000 Hz vocal/instrument energy (0..1)
  highEnergy: number;  // 4000-20000 Hz transient/cymbal energy (0..1)
  isBeat: boolean;     // Detected rhythmic beat/transient
  time: number;        // Audio time in seconds
}

const MAX_LIVE_SLICES = 1200;
const OVERVIEW_BINS = 600;
const SLICES_PER_SECOND = 75; // 75 slices/sec gives ~13.3ms resolution, ideal for 60fps scrolling

export function DJWaveformDeck({
  fileUrl = '',
  fileName = '',
  isPlaying,
  setIsPlaying,
  togglePlaybackRef,
  isPoppedOut = false,
  onPopOut,
  config
}: DJWaveformDeckProps) {
  const streamMetadata = useStreamMetadata();

  // Playback & Timing State
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bpm, setBpm] = useState<number>(106.6);
  const [isBpmEditing, setIsBpmEditing] = useState<boolean>(false);
  const [bpmInputVal, setBpmInputVal] = useState<string>('106.60');
  const [musicalKey, setMusicalKey] = useState<string>('Am');
  const [camelotKey, setCamelotKey] = useState<string>('8A');
  const [gridOffset, setGridOffset] = useState<number>(0.12);
  const [isGridLocked, setIsGridLocked] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<number>(3.5);
  const [activeTab, setActiveTab] = useState<'MONITOR' | 'GRID_ANALYSIS'>('GRID_ANALYSIS');
  const [isFrozen, setIsFrozen] = useState<boolean>(false);
  const [beatFlash, setBeatFlash] = useState<boolean>(false);
  const [tapTimes, setTapTimes] = useState<number[]>([]);
  const [isTapActive, setIsTapActive] = useState<boolean>(false);

  // Canvases
  const overviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingOverviewRef = useRef<boolean>(false);
  const isDraggingDetailRef = useRef<boolean>(false);
  const lastMouseXRef = useRef<number>(0);

  // Continuous 60fps Smooth Playback Time Tracker
  const smoothTimeRef = useRef<number>(0);
  const lastFrameTimestampRef = useRef<number>(performance.now());

  // Waveform Buffers
  const decodedTrackSlicesRef = useRef<WaveSlice[]>([]);
  const liveSlicesRef = useRef<WaveSlice[]>([]);
  const overviewBufferRef = useRef<WaveSlice[]>(new Array(OVERVIEW_BINS).fill(null).map(() => ({
    peak: 0,
    rms: 0,
    lowEnergy: 0,
    midEnergy: 0,
    highEnergy: 0,
    isBeat: false,
    time: 0
  })));

  // Transient beat detection state
  const energyHistoryRef = useRef<number[]>([]);
  const lastBeatTimeRef = useRef<number>(0);
  const beatIntervalsRef = useRef<number[]>([]);

  // 1. Pre-decode Track Audio when fileUrl changes
  useEffect(() => {
    if (!fileUrl) return;

    let isMounted = true;
    const decodeTrack = async () => {
      try {
        const audioCtx = audioAnalyzer.getContext() || audioAnalyzer.initContext();
        const res = await fetch(fileUrl);
        const arrayBuf = await res.arrayBuffer();
        const audioBuf = await audioCtx.decodeAudioData(arrayBuf.slice(0));

        if (!isMounted) return;

        const dur = audioBuf.duration;
        setDuration(dur);

        // Accurately re-analyze BPM and Musical Key on each new loaded song
        const bpmAnalysis = detectBpmFromAudio(audioBuf);
        const keyAnalysis = detectKeyFromAudio(audioBuf);

        setBpm(bpmAnalysis.bpm);
        setBpmInputVal(bpmAnalysis.bpm.toFixed(2));
        setGridOffset(bpmAnalysis.firstBeatTime);
        setMusicalKey(keyAnalysis.musicalKey);
        setCamelotKey(keyAnalysis.camelot);

        const channelData = audioBuf.getChannelData(0);
        const sampleRate = audioBuf.sampleRate;
        const totalSamples = channelData.length;

        const totalSlices = Math.floor(dur * SLICES_PER_SECOND);
        const samplesPerSlice = Math.max(1, Math.floor(totalSamples / totalSlices));

        const decodedSlices: WaveSlice[] = [];
        const overviewSlices: WaveSlice[] = new Array(OVERVIEW_BINS).fill(null).map(() => ({
          peak: 0,
          rms: 0,
          lowEnergy: 0,
          midEnergy: 0,
          highEnergy: 0,
          isBeat: false,
          time: 0
        }));

        // 1-Pole Digital Filter Coefficients
        let lowFilterState = 0;
        let midFilterState = 0;
        const lowAlpha = Math.min(1, (2 * Math.PI * 250) / sampleRate);
        const midAlpha = Math.min(1, (2 * Math.PI * 3500) / sampleRate);

        for (let s = 0; s < totalSlices; s++) {
          const startSample = s * samplesPerSlice;
          const endSample = Math.min(totalSamples, startSample + samplesPerSlice);
          const sliceTime = s / SLICES_PER_SECOND;

          let peakVal = 0;
          let sumSquares = 0;
          let lowSum = 0;
          let midSum = 0;
          let highSum = 0;
          const count = endSample - startSample;

          for (let i = startSample; i < endSample; i++) {
            const raw = channelData[i];
            const absRaw = Math.abs(raw);
            if (absRaw > peakVal) peakVal = absRaw;
            sumSquares += raw * raw;

            // Low-pass (~250 Hz)
            lowFilterState += lowAlpha * (raw - lowFilterState);
            lowSum += Math.abs(lowFilterState);

            // Mid-pass (250-3500 Hz)
            midFilterState += midAlpha * (raw - midFilterState);
            const midSample = midFilterState - lowFilterState;
            midSum += Math.abs(midSample);

            // High-pass (>3500 Hz)
            const highSample = raw - midFilterState;
            highSum += Math.abs(highSample);
          }

          const rmsVal = Math.sqrt(sumSquares / Math.max(1, count));
          const lowE = Math.min(1.0, (lowSum / Math.max(1, count)) * 2.8);
          const midE = Math.min(1.0, (midSum / Math.max(1, count)) * 3.2);
          const highE = Math.min(1.0, (highSum / Math.max(1, count)) * 4.5);

          const slice: WaveSlice = {
            peak: Math.min(1.0, peakVal),
            rms: Math.min(1.0, rmsVal),
            lowEnergy: lowE,
            midEnergy: midE,
            highEnergy: highE,
            isBeat: false,
            time: sliceTime
          };

          decodedSlices.push(slice);

          // Map into Overview buffer
          const overviewIdx = Math.floor((sliceTime / dur) * OVERVIEW_BINS);
          if (overviewIdx >= 0 && overviewIdx < OVERVIEW_BINS) {
            const slot = overviewSlices[overviewIdx];
            if (slice.peak > slot.peak) {
              slot.peak = slice.peak;
              slot.rms = slice.rms;
              slot.lowEnergy = slice.lowEnergy;
              slot.midEnergy = slice.midEnergy;
              slot.highEnergy = slice.highEnergy;
              slot.time = sliceTime;
            }
          }
        }

        decodedTrackSlicesRef.current = decodedSlices;
        overviewBufferRef.current = overviewSlices;
      } catch (err) {
        console.warn('Failed to pre-decode track audio:', err);
      }
    };

    decodeTrack();
    return () => {
      isMounted = false;
    };
  }, [fileUrl]);

  // Synchronize duration from audio element
  useEffect(() => {
    const elem = audioAnalyzer.getAudioElement();
    if (!elem) return;

    const onMeta = () => {
      if (!isNaN(elem.duration) && elem.duration > 0) {
        setDuration(elem.duration);
      }
    };

    elem.addEventListener('loadedmetadata', onMeta);
    return () => elem.removeEventListener('loadedmetadata', onMeta);
  }, []);

  // Format Elapsed mm:ss.s
  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const tenths = Math.floor((sec % 1) * 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
  };

  // Format Remaining -mm:ss.s
  const formatRemaining = (cur: number, total: number) => {
    const rem = Math.max(0, total > 0 ? total - cur : 0);
    const m = Math.floor(rem / 60);
    const s = Math.floor(rem % 60);
    const tenths = Math.floor((rem % 1) * 10);
    return `-${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
  };

  // Live Bar & Beat Counter synced to tempo & audio time
  const barCounter = useMemo(() => {
    const beatInterval = 60 / Math.max(40, bpm);
    const adjustedTime = Math.max(0, currentTime - gridOffset);
    const totalBeats = adjustedTime / beatInterval;
    const barNum = Math.floor(totalBeats / 4) + 1;
    const beatInBar = (Math.floor(totalBeats) % 4) + 1;
    return `${barNum}.${beatInBar}Bars`;
  }, [currentTime, bpm, gridOffset]);

  // Tap tempo handler
  const handleTapTempo = () => {
    const now = performance.now();
    setIsTapActive(true);
    setTimeout(() => setIsTapActive(false), 120);

    const recentTaps = [...tapTimes, now].filter(t => now - t < 3000);
    setTapTimes(recentTaps);

    if (recentTaps.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < recentTaps.length; i++) {
        intervals.push(recentTaps[i] - recentTaps[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval > 0) {
        const calculatedBpm = Math.round((60000 / avgInterval) * 100) / 100;
        if (calculatedBpm >= 60 && calculatedBpm <= 220) {
          setBpm(calculatedBpm);
          setBpmInputVal(calculatedBpm.toFixed(2));
        }
      }
    }
  };

  // Nudge beatgrid left / right
  const handleNudgeGrid = (direction: 'left' | 'right') => {
    const step = 0.005; // 5ms
    setGridOffset(prev => prev + (direction === 'right' ? step : -step));
  };

  // Stretch / compress beatgrid
  const handleStretchGrid = (direction: 'compress' | 'expand') => {
    const bpmDelta = direction === 'expand' ? -0.1 : 0.1;
    setBpm(prev => {
      const next = Math.max(50, Math.min(240, Math.round((prev + bpmDelta) * 100) / 100));
      setBpmInputVal(next.toFixed(2));
      return next;
    });
  };

  // Set downbeat (Beat 1) at current playhead position
  const handleSetDownbeat = () => {
    setGridOffset(currentTime % (60 / bpm));
  };

  // Reset waveform buffer
  const handleResetBuffer = () => {
    liveSlicesRef.current = [];
    smoothTimeRef.current = 0;
    setCurrentTime(0);
    const elem = audioAnalyzer.getAudioElement();
    if (elem) elem.currentTime = 0;
  };

  // 2. High-Performance 60 FPS Real-Time Audio Analysis & Continuous Scroll Loop
  useEffect(() => {
    let animId: number;
    let freqBuffer: Uint8Array | null = null;
    let timeBuffer: Uint8Array | null = null;

    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);

      const now = performance.now();
      const dt = Math.min(0.1, (now - lastFrameTimestampRef.current) / 1000);
      lastFrameTimestampRef.current = now;

      // Advance smooth playback time continuously at 60 FPS
      if (isPlaying && !isFrozen) {
        const elem = audioAnalyzer.getAudioElement();
        if (elem && !elem.paused && !isNaN(elem.currentTime)) {
          const targetTime = elem.currentTime;
          // If seeking or drift > 0.2s, snap smoothly
          if (Math.abs(smoothTimeRef.current - targetTime) > 0.2) {
            smoothTimeRef.current = targetTime;
          } else {
            // Smooth continuous advance
            smoothTimeRef.current += dt * (elem.playbackRate || 1);
            smoothTimeRef.current += (targetTime - smoothTimeRef.current) * 0.15;
          }
        } else {
          // Continuous streaming scroll
          smoothTimeRef.current += dt;
        }

        // Keep React state updated periodically for numerical readouts
        setCurrentTime(smoothTimeRef.current);
      }

      // Query Live Web Audio API Analyser
      const analyser = audioAnalyzer.getAnalyser();
      if (analyser) {
        const binCount = analyser.frequencyBinCount;
        const fftSize = analyser.fftSize;

        if (!freqBuffer || freqBuffer.length !== binCount) {
          freqBuffer = new Uint8Array(binCount);
        }
        if (!timeBuffer || timeBuffer.length !== fftSize) {
          timeBuffer = new Uint8Array(fftSize);
        }

        analyser.getByteFrequencyData(freqBuffer);
        analyser.getByteTimeDomainData(timeBuffer);

        const ctxAudio = audioAnalyzer.getContext();
        const sampleRate = ctxAudio ? ctxAudio.sampleRate : 44100;
        const binHz = sampleRate / fftSize;

        // Calculate Multi-Band Energy Splits from Live Audio
        const lowStart = Math.max(1, Math.floor(20 / binHz));
        const lowEnd = Math.min(binCount - 1, Math.floor(250 / binHz));
        let lowSum = 0;
        let lowCount = 0;
        for (let i = lowStart; i <= lowEnd; i++) {
          lowSum += freqBuffer[i];
          lowCount++;
        }
        const rawLow = lowCount > 0 ? (lowSum / lowCount) / 255 : 0;

        const midStart = lowEnd + 1;
        const midEnd = Math.min(binCount - 1, Math.floor(4000 / binHz));
        let midSum = 0;
        let midCount = 0;
        for (let i = midStart; i <= midEnd; i++) {
          midSum += freqBuffer[i];
          midCount++;
        }
        const rawMid = midCount > 0 ? (midSum / midCount) / 255 : 0;

        const highStart = midEnd + 1;
        const highEnd = Math.min(binCount - 1, Math.floor(20000 / binHz));
        let highSum = 0;
        let highCount = 0;
        for (let i = highStart; i <= highEnd; i++) {
          highSum += freqBuffer[i];
          highCount++;
        }
        const rawHigh = highCount > 0 ? (highSum / highCount) / 255 : 0;

        // Peak & RMS
        let peak = 0;
        let sumSquares = 0;
        for (let i = 0; i < timeBuffer.length; i++) {
          const norm = (timeBuffer[i] - 128) / 128;
          const absVal = Math.abs(norm);
          if (absVal > peak) peak = absVal;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / timeBuffer.length);

        const lowEnergy = Math.min(1.0, Math.pow(rawLow, 1.1) * 1.3);
        const midEnergy = Math.min(1.0, Math.pow(rawMid, 1.05) * 1.2);
        const highEnergy = Math.min(1.0, Math.pow(rawHigh, 1.0) * 1.5);
        const combinedPeak = Math.max(peak, (lowEnergy * 0.5 + midEnergy * 0.35 + highEnergy * 0.25));

        // Beat Detection
        const instantEnergy = lowEnergy * 0.75 + midEnergy * 0.25;
        const eHistory = energyHistoryRef.current;
        eHistory.push(instantEnergy);
        if (eHistory.length > 40) eHistory.shift();

        const avgEnergy = eHistory.reduce((a, b) => a + b, 0) / Math.max(1, eHistory.length);
        const isBeat = instantEnergy > 0.16 && instantEnergy > avgEnergy * 1.3 && (now - lastBeatTimeRef.current > 240);

        if (isBeat) {
          lastBeatTimeRef.current = now;
          setBeatFlash(true);
          setTimeout(() => setBeatFlash(false), 90);
        }

        // Record Live Slice
        if (isPlaying && !isFrozen) {
          const liveSlice: WaveSlice = {
            peak: Math.min(1.0, combinedPeak),
            rms: Math.min(1.0, rms),
            lowEnergy,
            midEnergy,
            highEnergy,
            isBeat,
            time: smoothTimeRef.current
          };

          const liveList = liveSlicesRef.current;
          liveList.push(liveSlice);
          if (liveList.length > MAX_LIVE_SLICES) {
            liveList.shift();
          }

          // If no pre-decoded track exists, record into Overview buffer in real-time
          if (decodedTrackSlicesRef.current.length === 0 && duration > 0) {
            const overviewIdx = Math.floor((smoothTimeRef.current / duration) * OVERVIEW_BINS);
            if (overviewIdx >= 0 && overviewIdx < OVERVIEW_BINS) {
              const slot = overviewBufferRef.current[overviewIdx];
              if (liveSlice.peak > slot.peak) {
                slot.peak = liveSlice.peak;
                slot.rms = liveSlice.rms;
                slot.lowEnergy = liveSlice.lowEnergy;
                slot.midEnergy = liveSlice.midEnergy;
                slot.highEnergy = liveSlice.highEnergy;
                slot.time = smoothTimeRef.current;
              }
            }
          }
        }
      }

      // Render Visualizations with continuous 60fps scrolling
      drawOverviewCanvas();
      drawDetailCanvas();
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, isFrozen, duration, bpm, isGridLocked, zoomLevel, config]);

  // Color Theme Resolution
  const colors = useMemo(() => {
    if (config?.colorPalette === 'custom' && config.customColors) {
      return {
        low: config.customColors.secondary || '#0055FF',     // Deep Blue
        mid: config.customColors.primary || '#FF1E56',       // Crimson / Pink
        high: config.customColors.accent || '#FFFFFF',       // White / Cyan
        tertiary: config.customColors.tertiary || '#FF8800'  // Amber
      };
    }
    // High-contrast Rekordbox / Serato 3-band RGB standard
    return {
      low: '#0055FF',      // Electric Blue for Lows / Sub Kicks
      mid: '#FF1E56',      // Crimson / Magenta for Mids / Vocals
      high: '#FFFFFF',     // Pure White for High Transients / Air
      tertiary: '#FFAA00'  // Amber for Mid-High transitions
    };
  }, [config]);

  // 1. Draw Mini Full-Length Track Overview Strip
  const drawOverviewCanvas = () => {
    const canvas = overviewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const halfH = height / 2;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const overview = overviewBufferRef.current;
    const barWidth = width / OVERVIEW_BINS;

    for (let i = 0; i < OVERVIEW_BINS; i++) {
      const slice = overview[i];
      const x = i * barWidth;
      const peakVal = Math.max(0.04, slice.peak);
      const barH = peakVal * (halfH - 2);

      // Low Band (Blue)
      const lowH = barH * Math.max(0.3, slice.lowEnergy);
      ctx.fillStyle = colors.low;
      ctx.fillRect(x, halfH - lowH, Math.max(1, barWidth - 0.4), lowH * 2);

      // Mid Band (Crimson / Magenta)
      if (slice.midEnergy > 0.08) {
        const midH = barH * (slice.midEnergy * 0.8);
        ctx.fillStyle = colors.mid;
        ctx.fillRect(x, halfH - midH, Math.max(1, barWidth - 0.4), midH * 2);
      }

      // High Band (White / Cyan)
      if (slice.highEnergy > 0.2) {
        const highH = barH * (slice.highEnergy * 0.6);
        ctx.fillStyle = colors.high;
        ctx.fillRect(x, halfH - highH, Math.max(1, barWidth - 0.4), highH * 2);
      }
    }

    // Playhead Needle on Overview
    const ratio = duration > 0 ? Math.min(1.0, Math.max(0, smoothTimeRef.current / duration)) : 0;
    const playX = ratio * width;

    ctx.fillStyle = '#b20000';
    ctx.fillRect(playX - 0.75, 0, 1.5, height);

    // Top downward triangle
    ctx.beginPath();
    ctx.moveTo(playX - 4, 0);
    ctx.lineTo(playX + 4, 0);
    ctx.lineTo(playX, 5);
    ctx.closePath();
    ctx.fill();

    // Bottom upward triangle
    ctx.beginPath();
    ctx.moveTo(playX - 4, height);
    ctx.lineTo(playX + 4, height);
    ctx.lineTo(playX, height - 5);
    ctx.closePath();
    ctx.fill();
  };

  // 2. Draw Main Zoomed Multi-Band Waveform with Continuous 60 FPS Scrolling
  const drawDetailCanvas = () => {
    const canvas = detailCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const halfH = height / 2;
    const centerX = width / 2;

    // Pitch black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const renderTime = smoothTimeRef.current;
    const visibleDuration = 24 / zoomLevel;
    const pixelsPerSecond = width / visibleDuration;
    const beatInterval = 60 / Math.max(40, bpm);

    const startTime = renderTime - visibleDuration / 2;
    const endTime = renderTime + visibleDuration / 2;

    // 1. Draw Beat Grid Lines (Continuously scrolling along with the audio)
    const firstBeatIdx = Math.floor((startTime - gridOffset) / beatInterval);
    const lastBeatIdx = Math.ceil((endTime - gridOffset) / beatInterval);

    for (let bi = firstBeatIdx; bi <= lastBeatIdx; bi++) {
      const beatTime = gridOffset + bi * beatInterval;
      if (beatTime < 0) continue;
      if (duration > 0 && beatTime > duration) continue;

      const beatX = centerX + (beatTime - renderTime) * pixelsPerSecond;
      if (beatX < 0 || beatX > width) continue;

      const isDownbeat = (bi % 4 + 4) % 4 === 0;

      if (isDownbeat) {
        // Red Downbeat Bar Line
        ctx.strokeStyle = '#b20000';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(beatX, 0);
        ctx.lineTo(beatX, height);
        ctx.stroke();

        // Top triangle flag
        ctx.fillStyle = '#b20000';
        ctx.beginPath();
        ctx.moveTo(beatX - 4, 0);
        ctx.lineTo(beatX + 4, 0);
        ctx.lineTo(beatX, 6);
        ctx.closePath();
        ctx.fill();

        // Bottom triangle flag
        ctx.beginPath();
        ctx.moveTo(beatX - 4, height);
        ctx.lineTo(beatX + 4, height);
        ctx.lineTo(beatX, height - 6);
        ctx.closePath();
        ctx.fill();
      } else {
        // Cyan Regular Beat Line with T-Ticks
        ctx.strokeStyle = '#00BFFF';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(beatX, 0);
        ctx.lineTo(beatX, height);
        ctx.stroke();

        // Top T-cap
        ctx.beginPath();
        ctx.moveTo(beatX - 3, 1);
        ctx.lineTo(beatX + 3, 1);
        ctx.stroke();

        // Bottom T-cap
        ctx.beginPath();
        ctx.moveTo(beatX - 3, height - 1);
        ctx.lineTo(beatX + 3, height - 1);
        ctx.stroke();
      }
    }

    // 2. Draw Multi-Band Waveform Slices Scrolling Past Center Playhead
    // Prefer full pre-decoded track slices if available, else live history buffer
    const hasDecoded = decodedTrackSlicesRef.current.length > 0;
    const slices = hasDecoded ? decodedTrackSlicesRef.current : liveSlicesRef.current;

    if (slices.length > 0) {
      if (hasDecoded) {
        // Directly index slices in the visible time window [startTime, endTime]
        const startSliceIdx = Math.max(0, Math.floor(startTime * SLICES_PER_SECOND));
        const endSliceIdx = Math.min(slices.length - 1, Math.ceil(endTime * SLICES_PER_SECOND));

        const colWidth = Math.max(2.0, pixelsPerSecond / SLICES_PER_SECOND);

        for (let s = startSliceIdx; s <= endSliceIdx; s++) {
          const slice = slices[s];
          const sliceX = centerX + (slice.time - renderTime) * pixelsPerSecond;
          if (sliceX < -4 || sliceX > width + 4) continue;

          const totalH = Math.max(2, slice.peak * (halfH - 14));

          // Layer 1: Bass / Sub Layer (Deep Electric Blue - Solid Base)
          const bassH = totalH * (0.55 + slice.lowEnergy * 0.45);
          ctx.fillStyle = colors.low;
          ctx.fillRect(sliceX - colWidth / 2, halfH - bassH, colWidth, bassH * 2);

          // Layer 2: Midrange / Vocals / Instruments (Crimson / Magenta / Warm Amber)
          if (slice.midEnergy > 0.08) {
            const midH = totalH * (0.35 + slice.midEnergy * 0.55);
            ctx.fillStyle = colors.mid;
            ctx.fillRect(sliceX - colWidth / 2, halfH - midH, colWidth, midH * 2);
          }

          // Layer 3: High Transients / Air (Brilliant White / Cyan Peak Tips)
          if (slice.highEnergy > 0.2) {
            const highH = totalH * (slice.highEnergy * 0.7);
            ctx.fillStyle = colors.high;
            ctx.fillRect(sliceX - colWidth / 2, halfH - highH, colWidth * 0.85, highH * 2);
          }
        }
      } else {
        // Live Rolling Stream: Draw slices recorded into liveSlicesRef
        const sliceCount = slices.length;
        const colWidth = 2.4;

        for (let i = 0; i < sliceCount; i++) {
          const slice = slices[i];
          const sliceX = centerX + (slice.time - renderTime) * pixelsPerSecond;
          if (sliceX < -4 || sliceX > width + 4) continue;

          const totalH = Math.max(2, slice.peak * (halfH - 14));

          const bassH = totalH * (0.55 + slice.lowEnergy * 0.45);
          ctx.fillStyle = colors.low;
          ctx.fillRect(sliceX - colWidth / 2, halfH - bassH, colWidth, bassH * 2);

          if (slice.midEnergy > 0.08) {
            const midH = totalH * (0.35 + slice.midEnergy * 0.55);
            ctx.fillStyle = colors.mid;
            ctx.fillRect(sliceX - colWidth / 2, halfH - midH, colWidth, midH * 2);
          }

          if (slice.highEnergy > 0.2) {
            const highH = totalH * (slice.highEnergy * 0.7);
            ctx.fillStyle = colors.high;
            ctx.fillRect(sliceX - colWidth / 2, halfH - highH, colWidth * 0.85, highH * 2);
          }
        }
      }
    }

    // 3. Center Red Playhead Needle with Subtle Center Glow
    ctx.strokeStyle = '#b20000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(178, 0, 0, 0.45)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.stroke();

    // Top & Bottom Needle Flags
    ctx.fillStyle = '#b20000';
    ctx.beginPath();
    ctx.moveTo(centerX - 5, 0);
    ctx.lineTo(centerX + 5, 0);
    ctx.lineTo(centerX, 8);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centerX - 5, height);
    ctx.lineTo(centerX + 5, height);
    ctx.lineTo(centerX, height - 8);
    ctx.closePath();
    ctx.fill();

    // 4. Live Bar Indicator in Cyan Mono Font (e.g. "13.4Bars")
    ctx.font = 'bold 12px "Geist Mono", monospace';
    ctx.fillStyle = '#00BFFF';
    ctx.textAlign = 'right';
    ctx.fillText(barCounter, centerX - 10, 18);
  };

  // Scrubbing on overview
  const handleOverviewMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingOverviewRef.current = true;
    seekOverview(e.clientX);
    const onMouseMove = (ev: MouseEvent) => {
      if (isDraggingOverviewRef.current) seekOverview(ev.clientX);
    };
    const onMouseUp = () => {
      isDraggingOverviewRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const seekOverview = (clientX: number) => {
    const canvas = overviewCanvasRef.current;
    if (!canvas || duration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = ratio * duration;

    smoothTimeRef.current = targetTime;
    setCurrentTime(targetTime);

    const elem = audioAnalyzer.getAudioElement();
    if (elem) {
      elem.currentTime = targetTime;
    }
  };

  // Drag-to-Scrub Horizontally on Main Detail Canvas (Like Scratching / Jog Wheel)
  const handleDetailMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingDetailRef.current = true;
    lastMouseXRef.current = e.clientX;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingDetailRef.current) return;
      const deltaX = ev.clientX - lastMouseXRef.current;
      lastMouseXRef.current = ev.clientX;

      const visibleDuration = 24 / zoomLevel;
      const pixelsPerSecond = (detailCanvasRef.current?.width || 1400) / visibleDuration;
      const deltaTime = -deltaX / pixelsPerSecond;

      const maxDur = duration > 0 ? duration : 3600;
      const nextTime = Math.max(0, Math.min(maxDur, smoothTimeRef.current + deltaTime));

      smoothTimeRef.current = nextTime;
      setCurrentTime(nextTime);

      const elem = audioAnalyzer.getAudioElement();
      if (elem) {
        elem.currentTime = nextTime;
      }
    };

    const onMouseUp = () => {
      isDraggingDetailRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleBpmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(bpmInputVal);
    if (!isNaN(val) && val >= 40 && val <= 240) {
      setBpm(Math.round(val * 100) / 100);
    } else {
      setBpmInputVal(bpm.toFixed(2));
    }
    setIsBpmEditing(false);
  };

  // Audio Format Badge
  const audioFormatBadge = useMemo(() => {
    if (streamMetadata && streamMetadata.sampleRate > 0) {
      const sr = (streamMetadata.sampleRate / 1000).toFixed(1) + ' kHz';
      const codec = streamMetadata.codec ? streamMetadata.codec.toUpperCase() : 'WAV';
      return `${codec} ${sr}`;
    }
    return '44.1 kHz 16-BIT WAV';
  }, [streamMetadata]);

  return (
    <div 
      className="w-full flex flex-col bg-[#141414] border border-[#383838] select-none text-left overflow-hidden" 
      id="dj-waveform-deck-container"
    >
      {/* 1. TOP TRACK HEADER BAR */}
      <div 
        className="w-full bg-[#181818] border-b border-[#333333] flex flex-col justify-between" 
        id="dj-deck-header-top-bar"
      >
        <div className="flex items-center justify-between px-3 py-2 flex-wrap gap-2">
          {/* Left: Track Information & Status */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Visual Icon / Disc Thumbnail */}
            <div className="relative w-9 h-9 rounded-full bg-[#111111] border border-[#444444] flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
              <Disc className={`w-5 h-5 text-[#b20000] ${isPlaying && !isFrozen ? 'animate-spin' : ''}`} style={{ animationDuration: '2.5s' }} />
              <div className="absolute inset-0 rounded-full border border-black/50" />
            </div>

            {/* Track Title, Specs, & Format */}
            <div className="min-w-0 flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-sans font-semibold text-[#F2F2F2] tracking-wide truncate max-w-[280px] sm:max-w-[420px]" title={fileName || 'No Audio Track Loaded'}>
                  {fileName || 'No Audio Track Loaded'}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[#222222] border border-[#4a4a4a] text-[#B8B8B8] font-medium uppercase">
                  {audioFormatBadge}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#858585] mt-0.5">
                <span className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-[#00FF66] shadow-[0_0_6px_#00FF66]' : 'bg-[#555555]'}`} />
                  <span className="font-semibold text-[#B8B8B8]">{isPlaying ? (isFrozen ? 'FROZEN INSPECTION' : 'LIVE 60FPS SCROLLING') : 'STANDBY'}</span>
                </span>
                <span>•</span>
                <span>Bar Grid: {bpm.toFixed(2)} BPM</span>
              </div>
            </div>
          </div>

          {/* Right: Dynamic Timing Readouts, Tempo, & Popout */}
          <div className="flex items-center gap-4 text-right shrink-0">
            {/* Elapsed Time */}
            <div className="flex flex-col items-end">
              <span className="text-[10px] uppercase font-sans font-medium text-[#858585] tracking-wider">ELAPSED</span>
              <span className="text-[15px] font-mono font-semibold text-[#F2F2F2] tabular-nums tracking-wide">
                {formatElapsed(currentTime)}
              </span>
            </div>

            {/* Remaining Time */}
            <div className="flex flex-col items-end">
              <span className="text-[10px] uppercase font-sans font-medium text-[#858585] tracking-wider">REMAINING</span>
              <span className="text-[15px] font-mono font-semibold text-[#b20000] tabular-nums tracking-wide">
                {formatRemaining(currentTime, duration)}
              </span>
            </div>

            {/* Dynamic BPM Indicator with Beat Flash */}
            <div className="flex flex-col items-end pl-2 border-l border-[#333333]">
              <span className="text-[10px] uppercase font-sans font-medium text-[#858585] tracking-wider flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full transition-all duration-75 ${beatFlash ? 'bg-[#00BFFF] scale-150 shadow-[0_0_8px_#00BFFF]' : 'bg-[#333333]'}`} />
                TEMPO
              </span>
              <span 
                className="text-[15px] font-mono font-semibold text-[#F2F2F2] tabular-nums tracking-wide cursor-pointer hover:text-[#00BFFF] transition-colors"
                title="Click to manually edit BPM"
                onClick={() => setIsBpmEditing(true)}
              >
                {bpm.toFixed(2)}
              </span>
            </div>

            {/* Dynamic Musical Key & Camelot Wheel Indicator */}
            <div className="flex flex-col items-end pl-2 border-l border-[#333333]">
              <span className="text-[10px] uppercase font-sans font-medium text-[#858585] tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#b20000]" />
                KEY (CAMELOT)
              </span>
              <div 
                className="flex items-center gap-1.5 mt-0.5 cursor-pointer hover:opacity-85 transition-opacity"
                title={`Detected Key: ${musicalKey} • Camelot Code: ${camelotKey}`}
              >
                <span className="text-[14px] font-mono font-semibold text-[#F2F2F2] tracking-tight">
                  {musicalKey}
                </span>
                <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-[#b20000] text-[#F2F2F2]">
                  {camelotKey}
                </span>
              </div>
            </div>

            {/* Popout Button if hosted on dashboard */}
            {onPopOut && (
              <div className="ml-1 border-l border-[#333333] pl-2">
                <PopOutButton 
                  onClick={onPopOut}
                  title="Pop out Waveform Deck"
                  id="btn-popout-dj-waveform"
                />
              </div>
            )}
          </div>
        </div>

        {/* Mini Full-Length Track Overview Strip */}
        <div className="w-full relative h-[26px] bg-[#000000] border-t border-[#222222]" id="overview-strip-container">
          <canvas
            ref={overviewCanvasRef}
            width={1200}
            height={26}
            onMouseDown={handleOverviewMouseDown}
            className="w-full h-full cursor-pointer block"
            title="Real-time multi-band overview. Click or drag to seek anywhere in the track."
          />
        </div>
      </div>

      {/* 2. MAIN ZOOMED MULTI-BAND WAVEFORM CANVAS WITH 60 FPS SCROLLING */}
      <div className="w-full relative h-[220px] bg-[#000000] overflow-hidden" id="dj-detail-canvas-stage">
        <canvas
          ref={detailCanvasRef}
          width={1400}
          height={220}
          onMouseDown={handleDetailMouseDown}
          className="w-full h-full block cursor-ew-resize"
          title="Live multi-band waveform scrolling continuously as generated. Click and drag horizontally to scrub."
        />

        {/* Floating Zoom & Timebase Navigation Overlay */}
        <div 
          className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-[#121212]/85 backdrop-blur-sm border border-[#333333] p-1 rounded-sm z-20 select-none shadow-lg"
          id="waveform-canvas-zoom-cluster"
        >
          {/* Zoom In (+) */}
          <button
            type="button"
            onClick={() => setZoomLevel(prev => Math.min(12, prev + 0.5))}
            className="w-6 h-6 flex items-center justify-center text-[#B8B8B8] hover:text-[#F2F2F2] hover:bg-[#252525] rounded transition-colors cursor-pointer"
            title="Zoom In Waveform (+)"
            id="btn-zoom-in-wf"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {/* Reset Zoom (RST) */}
          <button
            type="button"
            onClick={() => setZoomLevel(3.5)}
            className="px-1.5 h-6 text-[10px] font-sans font-medium uppercase tracking-wider text-[#B8B8B8] hover:text-[#F2F2F2] hover:bg-[#252525] rounded transition-colors cursor-pointer flex items-center justify-center"
            title="Reset Zoom to 3.5x"
            id="btn-zoom-rst-wf"
          >
            RST
          </button>

          {/* Zoom Out (-) */}
          <button
            type="button"
            onClick={() => setZoomLevel(prev => Math.max(1, prev - 0.5))}
            className="w-6 h-6 flex items-center justify-center text-[#B8B8B8] hover:text-[#F2F2F2] hover:bg-[#252525] rounded transition-colors cursor-pointer"
            title="Zoom Out Waveform (-)"
            id="btn-zoom-out-wf"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          {/* Nudge Left */}
          <button
            type="button"
            onClick={() => handleNudgeGrid('left')}
            className="w-6 h-6 flex items-center justify-center text-[#B8B8B8] hover:text-[#F2F2F2] hover:bg-[#252525] rounded transition-colors cursor-pointer border-l border-[#333333] pl-1 ml-0.5"
            title="Nudge Beatgrid Left"
            id="btn-nudge-left-wf"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Legend Overlay at Top Right of Canvas */}
        <div className="absolute right-3 top-3 flex items-center gap-3 bg-[#111111]/85 backdrop-blur-sm border border-[#333333] px-2.5 py-1 rounded text-[10px] font-sans font-medium uppercase tracking-wider text-[#B8B8B8] z-10 pointer-events-none">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-xs" style={{ backgroundColor: colors.low }} />
            <span>LOW / BASS</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-xs" style={{ backgroundColor: colors.mid }} />
            <span>MID / VOCAL</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-xs" style={{ backgroundColor: colors.high }} />
            <span>HIGH / AIR</span>
          </div>
        </div>
      </div>

      {/* 3. BOTTOM AUDIO ANALYSIS & DECK CONTROL STRIP */}
      <div 
        className="w-full bg-[#181818] border-t border-[#333333] px-3 py-2 flex flex-wrap items-center justify-between gap-3 text-white text-[11px] font-sans shrink-0" 
        id="dj-deck-grid-strip"
      >
        {/* Left Side: Mode Tabs + Grid Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Mode Selector Tabs */}
          <div className="flex items-center gap-1 bg-[#111111] p-0.5 border border-[#383838]" id="dj-tab-mode-selector">
            <button
              type="button"
              onClick={() => setActiveTab('MONITOR')}
              className={`px-3 py-1 text-[11px] font-medium uppercase tracking-[0.8px] cursor-pointer transition-colors ${
                activeTab === 'MONITOR' 
                  ? 'bg-[#2a2a2a] text-[#F2F2F2]' 
                  : 'text-[#B8B8B8] hover:text-[#F2F2F2]'
              }`}
              id="tab-btn-monitor"
            >
              WAVEFORM MONITOR
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('GRID_ANALYSIS')}
              className={`px-3 py-1 text-[11px] font-medium uppercase tracking-[0.8px] cursor-pointer transition-colors ${
                activeTab === 'GRID_ANALYSIS' 
                  ? 'bg-[#2a2a2a] text-[#F2F2F2]' 
                  : 'text-[#B8B8B8] hover:text-[#F2F2F2]'
              }`}
              id="tab-btn-gridedit"
            >
              BEATGRID ANALYSIS
            </button>
          </div>

          {/* Downbeat Marker Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSetDownbeat}
              disabled={isGridLocked}
              className="px-2.5 h-7 bg-[#141414] border border-[#3a3a3a] hover:border-[#b20000] text-[11px] font-medium uppercase tracking-wider text-[#F2F2F2] flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Set Beat 1 Downbeat at current playhead position"
              id="btn-set-downbeat"
            >
              <span className="w-1.5 h-3 bg-[#b20000]" />
              <span>SET DOWNBEAT</span>
            </button>

            {/* Editable BPM Input Box */}
            {isBpmEditing ? (
              <form onSubmit={handleBpmSubmit} className="inline-flex">
                <input
                  type="text"
                  value={bpmInputVal}
                  onChange={(e) => setBpmInputVal(e.target.value)}
                  onBlur={() => {
                    const val = parseFloat(bpmInputVal);
                    if (!isNaN(val) && val >= 40 && val <= 240) {
                      setBpm(Math.round(val * 100) / 100);
                    } else {
                      setBpmInputVal(bpm.toFixed(2));
                    }
                    setIsBpmEditing(false);
                  }}
                  autoFocus
                  className="w-16 h-7 bg-[#121212] border border-[#00BFFF] px-1 text-center font-mono font-medium text-[#F2F2F2] text-[11px] focus:outline-none"
                />
              </form>
            ) : (
              <div 
                onClick={() => !isGridLocked && setIsBpmEditing(true)}
                className={`h-7 px-2.5 bg-[#141414] border border-[#3a3a3a] flex items-center justify-center font-mono font-medium text-[#F2F2F2] text-[11px] cursor-pointer hover:border-[#666666] select-none ${
                  isGridLocked ? 'cursor-default' : 'hover:border-[#00BFFF]'
                }`}
                title="Click to edit grid tempo manually"
              >
                {bpm.toFixed(2)} BPM
              </div>
            )}

            {/* TAP Tempo Button */}
            <button
              type="button"
              onClick={handleTapTempo}
              disabled={isGridLocked}
              className={`h-7 px-2.5 text-[11px] font-medium uppercase tracking-[0.8px] border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                isTapActive 
                  ? 'bg-[#00BFFF] border-[#00BFFF] text-black font-semibold' 
                  : 'bg-[#141414] border-[#3a3a3a] text-[#B8B8B8] hover:text-[#F2F2F2] hover:border-[#666666]'
              }`}
              title="Tap repeatedly on rhythm to measure BPM"
              id="btn-tap-tempo"
            >
              TAP
            </button>

            {/* Nudge Left / Right Buttons */}
            <div className="flex items-center bg-[#141414] border border-[#3a3a3a] h-7">
              <button
                type="button"
                onClick={() => handleNudgeGrid('left')}
                disabled={isGridLocked}
                className="px-2 h-full text-[#B8B8B8] hover:text-[#F2F2F2] border-r border-[#3a3a3a] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center font-mono text-[11px]"
                title="Nudge beat grid phase left"
                id="btn-nudge-grid-left"
              >
                ◀ |||
              </button>
              <button
                type="button"
                onClick={() => handleNudgeGrid('right')}
                disabled={isGridLocked}
                className="px-2 h-full text-[#B8B8B8] hover:text-[#F2F2F2] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center font-mono text-[11px]"
                title="Nudge beat grid phase right"
                id="btn-nudge-grid-right"
              >
                ||| ▶
              </button>
            </div>

            {/* Stretch / Compress Grid */}
            <div className="flex items-center bg-[#141414] border border-[#3a3a3a] h-7">
              <button
                type="button"
                onClick={() => handleStretchGrid('compress')}
                disabled={isGridLocked}
                className="px-2 h-full text-[#B8B8B8] hover:text-[#F2F2F2] border-r border-[#3a3a3a] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center font-mono text-[11px]"
                title="Compress beat spacing (Fine BPM +)"
                id="btn-compress-grid"
              >
                ◀ |||*
              </button>
              <button
                type="button"
                onClick={() => handleStretchGrid('expand')}
                disabled={isGridLocked}
                className="px-2 h-full text-[#B8B8B8] hover:text-[#F2F2F2] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center font-mono text-[11px]"
                title="Expand beat spacing (Fine BPM -)"
                id="btn-expand-grid"
              >
                *||| ▶
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Freeze Frame, Reset Buffer, & Lock Grid */}
        <div className="flex items-center gap-2">
          {/* Freeze Frame Button */}
          <button
            type="button"
            onClick={() => setIsFrozen(prev => !prev)}
            className={`h-7 px-2.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.8px] border transition-colors cursor-pointer ${
              isFrozen
                ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2] shadow-[0_0_8px_#b20000]'
                : 'bg-[#141414] border-[#3a3a3a] text-[#B8B8B8] hover:text-[#F2F2F2] hover:border-[#666666]'
            }`}
            title="Freeze and inspect current audio waveform transients"
            id="btn-freeze-waveform"
          >
            <Snowflake className="w-3 h-3 text-current" />
            <span>{isFrozen ? 'FROZEN' : 'FREEZE'}</span>
          </button>

          {/* Reset Buffer */}
          <button
            type="button"
            onClick={handleResetBuffer}
            className="h-7 px-2.5 bg-[#141414] border border-[#3a3a3a] text-[11px] font-medium uppercase tracking-[0.8px] text-[#B8B8B8] hover:text-[#F2F2F2] hover:border-[#666666] flex items-center gap-1 transition-colors cursor-pointer"
            title="Clear and reset live waveform history buffer"
            id="btn-reset-waveform-buffer"
          >
            <RotateCw className="w-3 h-3" />
            <span>RESET</span>
          </button>

          {/* Lock / Unlock Grid Button */}
          <button
            type="button"
            onClick={() => setIsGridLocked(!isGridLocked)}
            className={`h-7 px-2.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.8px] border transition-colors cursor-pointer ${
              isGridLocked 
                ? 'bg-[#1a1a1a] border-[#3a3a3a] text-[#858585]' 
                : 'bg-[#00BFFF]/20 border-[#00BFFF] text-[#00BFFF]'
            }`}
            title={isGridLocked ? "Beatgrid is locked against accidental shifts" : "Beatgrid unlocked for editing"}
            id="btn-lock-grid"
          >
            {isGridLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            <span>{isGridLocked ? 'LOCKED' : 'UNLOCKED'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
