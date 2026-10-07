import { PanelInfo } from './PanelInfo';
import { analyzeWaveformSlice, createWaveformFilterState } from '../utils/waveformAnalysis';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { 
  ZoomIn, 
  ZoomOut, 
  Volume2, 
  Play, 
  Pause, 
  Plus, 
  Minus, 
  AudioLines,
  Sliders,
  Snowflake,
  Activity,
  Layers,
  Sparkles
} from 'lucide-react';
import { audioAnalyzer } from '../audioEngine';
import { AnalyzerConfig, type TrackAnalysisDisplay } from '../types';
import { PopOutButton, ResetButton } from './SharedButtons';
import { detectBpmFromAudio, detectKeyFromAudio } from '../utils/audioAnalysis';
import { AudioFileRegistry } from '../utils';

export interface DJWaveformDeckProps {
  fileUrl?: string;
  fileName?: string;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  togglePlaybackRef?: React.MutableRefObject<(() => void) | null>;
  isPoppedOut?: boolean;
  onPopOut?: () => void;
  config?: AnalyzerConfig;
  onTrackAnalysis?: (result: TrackAnalysisDisplay) => void;
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
  isPlaying,
  setIsPlaying,
  togglePlaybackRef,
  isPoppedOut = false,
  onPopOut,
  config,
  onTrackAnalysis
}: DJWaveformDeckProps) {

  // Playback & Timing State
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bpm, setBpm] = useState<number>(0);
  const [gridOffset, setGridOffset] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(3.5);
  const [decodeState, setDecodeState] = useState('');
  const [isFrozen, setIsFrozen] = useState<boolean>(false);

  // Track decoding race condition token
  const decodeRequestIdRef = useRef<number>(0);

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

  // Decode once per track for the existing waveform, tempo and key analysis.
  useEffect(() => {
    const reqId = ++decodeRequestIdRef.current;
    decodedTrackSlicesRef.current = [];
    liveSlicesRef.current = [];
    overviewBufferRef.current = new Array(OVERVIEW_BINS).fill(null).map(() => ({
      peak: 0, rms: 0, lowEnergy: 0, midEnergy: 0, highEnergy: 0, isBeat: false, time: 0
    }));
    smoothTimeRef.current = 0;
    energyHistoryRef.current = []; beatIntervalsRef.current = [];
    setDuration(0); setCurrentTime(0); setGridOffset(0);
    setDecodeState(fileUrl ? 'Loading waveform…' : 'No source');
    setBpm(0);
    onTrackAnalysis?.({ fileUrl, bpm: 0, bpmSource: 'none', musicalKey: 'Unknown', camelotKey: '—', keyCorrelation: 0 });
    if (!fileUrl) return;

    let isMounted = true;

    const decodeTrack = async () => {
      try {
        const audioCtx = audioAnalyzer.getContext() || audioAnalyzer.initContext();
        let arrayBuf: ArrayBuffer;
        const registered = AudioFileRegistry.get(fileUrl);
        if (registered) {
          arrayBuf = await registered.arrayBuffer();
        } else {
          const res = await fetch(fileUrl);
          if (!res.ok) throw new Error(`HTTP error ${res.status} fetching audio file`);
          arrayBuf = await res.arrayBuffer();
        }

        const audioBuf = await new Promise<AudioBuffer>((resolve, reject) => {
          try {
            const p = audioCtx.decodeAudioData(arrayBuf.slice(0), resolve, reject);
            if (p && typeof p.then === 'function') {
              p.then(resolve).catch(reject);
            }
          } catch (err) {
            reject(err);
          }
        });

        if (!isMounted || reqId !== decodeRequestIdRef.current) return;

        const dur = audioBuf.duration;
        setDuration(dur);

        // Reuse the existing detectors; results are estimates with their existing confidence states.
        const bpmAnalysis = detectBpmFromAudio(audioBuf);
        const keyAnalysis = detectKeyFromAudio(audioBuf);

        console.debug('[AudioAnalysis:Tempo] Automatically detected tempo from file:', bpmAnalysis.bpm, bpmAnalysis.diagnostics);
        setBpm(bpmAnalysis.bpm);
        setGridOffset(bpmAnalysis.firstBeatTime);
        console.debug('[AudioAnalysis:Key Lifecycle] Applied key detection:', keyAnalysis.musicalKey, keyAnalysis.camelot, keyAnalysis.diagnostics);
        onTrackAnalysis?.({
          fileUrl, bpm: bpmAnalysis.bpm, bpmSource: bpmAnalysis.bpm > 0 ? 'auto' : 'none',
          musicalKey: keyAnalysis.musicalKey, camelotKey: keyAnalysis.camelot,
          keyCorrelation: keyAnalysis.correlation ?? keyAnalysis.diagnostics?.bestCorrelation ?? 0
        });

        const channels = Array.from({ length: audioBuf.numberOfChannels }, (_, c) => audioBuf.getChannelData(c));
        const sampleRate = audioBuf.sampleRate;
        const totalSamples = audioBuf.length;

        const totalSlices = Math.max(1, Math.ceil(dur * SLICES_PER_SECOND));
        const samplesPerSlice = totalSamples / totalSlices;

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

        const filters = createWaveformFilterState(channels.length);

        for (let s = 0; s < totalSlices; s++) {
          const startSample = Math.floor(s * samplesPerSlice);
          const endSample = Math.min(totalSamples, Math.floor((s + 1) * samplesPerSlice));
          const sliceTime = s / SLICES_PER_SECOND;

          const slice: WaveSlice = {
            ...analyzeWaveformSlice(channels, sampleRate, startSample, endSample, filters),
            isBeat: false,
            time: sliceTime
          };

          decodedSlices.push(slice);

          // Map into Overview buffer
          const overviewIdx = Math.floor((sliceTime / dur) * OVERVIEW_BINS);
          if (overviewIdx >= 0 && overviewIdx < OVERVIEW_BINS) {
            const slot = overviewSlices[overviewIdx];
            slot.peak = Math.max(slot.peak, slice.peak);
            slot.rms = Math.max(slot.rms, slice.rms);
            slot.lowEnergy = Math.max(slot.lowEnergy, slice.lowEnergy);
            slot.midEnergy = Math.max(slot.midEnergy, slice.midEnergy);
            slot.highEnergy = Math.max(slot.highEnergy, slice.highEnergy);
            slot.time = sliceTime;
          }
        }

        decodedTrackSlicesRef.current = decodedSlices;
        overviewBufferRef.current = overviewSlices;
        setDecodeState('');
      } catch (err) {
        if (isMounted && reqId === decodeRequestIdRef.current) setDecodeState('Waveform unavailable — source or format not accessible');
        console.warn('Failed to pre-decode track audio:', err);
      }
    };

    decodeTrack();
    return () => {
      isMounted = false;
    };
  }, [fileUrl, onTrackAnalysis]);

  // Synchronize duration and live seeking from audio element
  useEffect(() => {
    const elem = audioAnalyzer.getAudioElement();
    if (!elem) return;

    const onMeta = () => {
      if (elem.src !== fileUrl) return;
      if (!isNaN(elem.duration) && elem.duration > 0) {
        setDuration(elem.duration);
      }
    };

    const onSeekOrUpdate = () => {
      if (elem.src !== fileUrl) return;
      if (!isNaN(elem.currentTime)) {
        smoothTimeRef.current = elem.currentTime;
        setCurrentTime(elem.currentTime);
        drawOverviewCanvas();
        drawDetailCanvas();
      }
    };

    onMeta();
    elem.addEventListener('loadedmetadata', onMeta);
    elem.addEventListener('seeked', onSeekOrUpdate);
    elem.addEventListener('timeupdate', onSeekOrUpdate);
    return () => {
      elem.removeEventListener('loadedmetadata', onMeta);
      elem.removeEventListener('seeked', onSeekOrUpdate);
      elem.removeEventListener('timeupdate', onSeekOrUpdate);
    };
  }, [fileUrl, isPlaying]);

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
    if (bpm <= 0) return '---';
    const beatInterval = 60 / Math.max(40, bpm);
    const adjustedTime = Math.max(0, currentTime - gridOffset);
    const totalBeats = adjustedTime / beatInterval;
    const barNum = Math.floor(totalBeats / 4) + 1;
    const beatInBar = (Math.floor(totalBeats) % 4) + 1;
    return `${barNum}.${beatInBar}Bars`;
  }, [currentTime, bpm, gridOffset]);


  // Reset waveform buffer
  const handleResetBuffer = () => {
    liveSlicesRef.current = [];
    smoothTimeRef.current = 0;
    setCurrentTime(0);
    const elem = audioAnalyzer.getAudioElement();
    if (elem) audioAnalyzer.seek(0);
  };

  // 2. High-Performance 60 FPS Real-Time Audio Analysis & Continuous Scroll Loop
  useEffect(() => {
    let animId: number;
    let channelBuffers: Float32Array[] = [];
    let sourceNode: AnalyserNode | null = null;
    let filters = createWaveformFilterState(0);

    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);

      const now = performance.now();
      const dt = Math.min(0.1, (now - lastFrameTimestampRef.current) / 1000);
      lastFrameTimestampRef.current = now;

      // Advance smooth playback time continuously at 60 FPS
      const elem = audioAnalyzer.getAudioElement();
      if (!isPlaying) {
        // Paused Seeking: instantly update smoothTime and React currentTime if seeking while paused
        if (elem && !isNaN(elem.currentTime)) {
          if (Math.abs(smoothTimeRef.current - elem.currentTime) > 0.001) {
            smoothTimeRef.current = elem.currentTime;
            setCurrentTime(elem.currentTime);
          }
        }
      } else if (!isFrozen) {
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

      // Analyze the existing per-channel nodes so opposite polarity cannot cancel.
      const stereo = audioAnalyzer.getStereoAnalysers();
      const mono = audioAnalyzer.getAnalyser();
      const nodes = stereo.left && stereo.right ? [stereo.left, stereo.right] : mono ? [mono] : [];
      if (nodes.length) {
        if (sourceNode !== nodes[0] || channelBuffers.length !== nodes.length || channelBuffers[0]?.length !== nodes[0].fftSize) {
          sourceNode = nodes[0];
          channelBuffers = nodes.map(node => new Float32Array(node.fftSize));
          filters = createWaveformFilterState(nodes.length);
        }
        nodes.forEach((node, c) => node.getFloatTimeDomainData(channelBuffers[c]));
        const measured = analyzeWaveformSlice(channelBuffers, audioAnalyzer.getContext()?.sampleRate || 48000,
          0, channelBuffers[0].length, filters);
        const { lowEnergy, midEnergy, highEnergy, rms } = measured;
        const combinedPeak = measured.peak;

        // Beat Detection
        const instantEnergy = lowEnergy * 0.75 + midEnergy * 0.25;
        const eHistory = energyHistoryRef.current;
        eHistory.push(instantEnergy);
        if (eHistory.length > 40) eHistory.shift();

        const avgEnergy = eHistory.reduce((a, b) => a + b, 0) / Math.max(1, eHistory.length);
        const isBeat = instantEnergy > 0.16 && instantEnergy > avgEnergy * 1.3 && (now - lastBeatTimeRef.current > 240);

        if (isBeat) {
          lastBeatTimeRef.current = now;
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
  }, [isPlaying, isFrozen, duration, bpm, gridOffset, zoomLevel, config, fileUrl]);

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

    // 1. Draw Beat Grid Lines (Continuously scrolling along with the audio if tempo is available)
    if (bpm > 0) {
      const beatInterval = 60 / bpm;
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
      audioAnalyzer.seek(targetTime);
    }
    drawOverviewCanvas();
    drawDetailCanvas();
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
      const pixelsPerSecond = (detailCanvasRef.current?.getBoundingClientRect().width || 1) / visibleDuration;
      const deltaTime = -deltaX / pixelsPerSecond;

      const maxDur = duration > 0 ? duration : 3600;
      const nextTime = Math.max(0, Math.min(maxDur, smoothTimeRef.current + deltaTime));

      smoothTimeRef.current = nextTime;
      setCurrentTime(nextTime);

      const elem = audioAnalyzer.getAudioElement();
      if (elem) {
        audioAnalyzer.seek(nextTime);
      }
      drawOverviewCanvas();
      drawDetailCanvas();
    };

    const onMouseUp = () => {
      isDraggingDetailRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };



  return (
    <div 
      className="w-full h-full flex flex-col bg-[#141414] border border-[#383838] select-none text-left overflow-hidden" 
      id="dj-waveform-deck-container"
    >
      {/* 1. TOP TRACK HEADER BAR */}
      <div 
        className="w-full bg-[#121212] border-b border-[#4a4a4a] flex flex-col justify-between"
        id="dj-deck-header-top-bar"
      >
        <div className="flex items-center justify-between px-3 py-2 flex-wrap gap-2">
          {/* Left: Stable panel identity */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 bg-[#181818] border border-[#4a4a4a] flex items-center justify-center text-[#b20000] shrink-0">
              <AudioLines className="w-4 h-4 text-[#b20000]" />
            </div>
            <h1 className="text-xs font-semibold tracking-[1.4px] text-[#F2F2F2] font-sans uppercase animate-fade-in">
              Waveform Deck{fileUrl && <span className="ml-2 text-[9px] font-normal tracking-[0.5px] text-[#858585]">· ORIGINAL FILE</span>}
            </h1>
          </div>

          {/* Right: Timing and waveform actions */}
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-right ml-auto min-w-0 max-w-full">
            <div className="flex items-center gap-4 shrink-0">
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

            </div>
            <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full" id="waveform-header-controls">
        <PanelInfo label="About the waveform">The file waveform shows original audio; EQ changes appear in the live spectrum and meters. 
          <p>The beat grid is estimated and assumes 4/4 time. The waveform includes all decoded channels: its outline preserves the largest peaks, and its colors combine channel energy without phase cancellation.</p>
        </PanelInfo>
        {/* Horizontal zoom controls */}
        <div
          className="flex items-center shrink-0 gap-1 bg-[#141414]/95 backdrop-blur-sm border border-[#3a3a3a] p-1 rounded-none z-20 select-none shadow-xl"
          id="waveform-header-zoom-cluster"
        >
          {/* Zoom In (+) */}
          <div className="relative group/btn">
            <button
              type="button"
              onClick={() => setZoomLevel(prev => Math.min(12, prev + 0.5))}
              className="w-6 h-6 flex items-center justify-center bg-[#181818] border border-[#383838] text-[#B8B8B8] hover:text-[#F2F2F2] hover:bg-[#252525] hover:border-[#F2F2F2] active:bg-[#303030] rounded-none transition-[border-color,background-color,color] duration-150 ease-out cursor-pointer"
              title="Zoom in by 0.5× to inspect transients."
              id="btn-zoom-in-wf"
              aria-label="Zoom In (+0.5x)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <div className="pointer-events-none absolute bottom-full mb-2 left-0 z-30 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 ease-out bg-[#121212]/95 border border-[#3a3a3a] px-2 py-1 shadow-2xl whitespace-normal w-max max-w-[220px] text-[10px] font-mono text-[#B8B8B8] uppercase tracking-wider">
              <span>ZOOM IN (+0.5X) · TRANSIENT DETAIL <span className="text-[#F2F2F2]">[{zoomLevel.toFixed(1)}X / 12.0X]</span></span>
            </div>
          </div>

          {/* Reset Zoom (RST) */}
          <div className="relative group/btn">
            <button
              type="button"
              onClick={() => setZoomLevel(3.5)}
              className="px-2 h-6 flex items-center justify-center bg-[#181818] border border-[#383838] text-[10px] font-mono font-medium uppercase tracking-wider text-[#B8B8B8] hover:text-[#F2F2F2] hover:bg-[#252525] hover:border-[#F2F2F2] active:bg-[#303030] rounded-none transition-[border-color,background-color,color] duration-150 ease-out cursor-pointer"
              title="Return to the default 3.5× zoom."
              id="btn-zoom-rst-wf"
              aria-label="Reset Zoom (3.5x)"
            >
              RST
            </button>
            <div className="pointer-events-none absolute bottom-full mb-2 left-0 z-30 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 ease-out bg-[#121212]/95 border border-[#3a3a3a] px-2 py-1 shadow-2xl whitespace-normal w-max max-w-[220px] text-[10px] font-mono text-[#B8B8B8] uppercase tracking-wider">
              <span>RESET ZOOM <span className="text-[#F2F2F2]">[3.5X]</span> · DEFAULT VIEW</span>
            </div>
          </div>

          {/* Zoom Out (-) */}
          <div className="relative group/btn">
            <button
              type="button"
              onClick={() => setZoomLevel(prev => Math.max(1, prev - 0.5))}
              className="w-6 h-6 flex items-center justify-center bg-[#181818] border border-[#383838] text-[#B8B8B8] hover:text-[#F2F2F2] hover:bg-[#252525] hover:border-[#F2F2F2] active:bg-[#303030] rounded-none transition-[border-color,background-color,color] duration-150 ease-out cursor-pointer"
              title="Zoom out by 0.5× to see more of the track."
              id="btn-zoom-out-wf"
              aria-label="Zoom Out (-0.5x)"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <div className="pointer-events-none absolute bottom-full mb-2 left-0 z-30 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 ease-out bg-[#121212]/95 border border-[#3a3a3a] px-2 py-1 shadow-2xl whitespace-normal w-max max-w-[220px] text-[10px] font-mono text-[#B8B8B8] uppercase tracking-wider">
              <span>ZOOM OUT (-0.5X) · MACRO OVERVIEW <span className="text-[#F2F2F2]">[{zoomLevel.toFixed(1)}X / 1.0X]</span></span>
            </div>
          </div>


        </div>


          {/* Freeze Frame Button */}
          <button
            type="button"
            onClick={() => setIsFrozen(prev => !prev)}
            className={`h-7 px-2.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.8px] border transition-colors cursor-pointer ${
              isFrozen
                ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2] shadow-[0_0_8px_#b20000]'
                : 'bg-[#141414] border-[#3a3a3a] text-[#B8B8B8] hover:text-[#F2F2F2] hover:border-[#666666]'
            }`}
            title="Hold the waveform display for inspection. Audio keeps playing."
            id="btn-freeze-waveform"
          >
            <Snowflake className="w-3 h-3 text-current" />
            <span>{isFrozen ? 'FROZEN' : 'FREEZE'}</span>
          </button>
              <ResetButton
                onClick={handleResetBuffer}
                title="Clear the live waveform history."
                id="btn-reset-waveform-buffer"
              />
            {/* Popout Button if hosted on dashboard */}
            {onPopOut && (
                <PopOutButton 
                  onClick={onPopOut}
                  title="Pop out Waveform Deck"
                  id="btn-popout-dj-waveform"
                />
            )}
            </div>
          </div>
        </div>

        {decodeState && <div className="px-3 py-1 text-[10px] text-[#999]" role="status">{decodeState}</div>}
        {/* Mini Full-Length Track Overview Strip */}
        <div className="w-full relative h-[26px] bg-[#000000] border-t border-[#222222]" id="overview-strip-container">
          <canvas
            ref={overviewCanvasRef}
            width={1200}
            height={26}
            onMouseDown={handleOverviewMouseDown}
            className="w-full h-full cursor-pointer block"
            title="Click or drag to move through the track."
          />
        </div>
      </div>

      {/* 2. MAIN ZOOMED MULTI-BAND WAVEFORM CANVAS WITH 60 FPS SCROLLING */}
      <div className="w-full relative min-h-[220px] flex-1 bg-[#000000] overflow-hidden" id="dj-detail-canvas-stage">
        <canvas
          ref={detailCanvasRef}
          width={1400}
          height={220}
          onMouseDown={handleDetailMouseDown}
          className="w-full h-full block cursor-ew-resize"
          title="Drag left or right to scrub through the track."
        />

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

    </div>
  );
}
