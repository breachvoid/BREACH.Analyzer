/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { 
  ZoomIn, 
  ZoomOut, 
  Disc, 
  Activity, 
  Check, 
  Sliders, 
  Info, 
  RefreshCw, 
  Waves
} from 'lucide-react';
import { audioAnalyzer } from '../audioEngine';
import { ResetButton, PopOutButton, MinimizeButton } from './SharedButtons';
import { AudioFileRegistry, fetchPartialArrayBuffer, fetchSlice, getAudioFileSize } from '../utils';

interface WaveformPanelProps {
  fileUrl: string;
  isPlaying: boolean;
  fileName: string;
  isPoppedOut?: boolean;
  onPopOut?: () => void;
  isEmbeddedInDeck?: boolean;
  onDecodingStateChange?: (decoding: boolean) => void;
  waveformPalette?: 'void' | 'rgb' | 'blue' | '3-band';
  onWaveformPaletteChange?: (palette: 'void' | 'rgb' | 'blue' | '3-band') => void;
}

interface WaveformPeaks {
  max: Float32Array;
  min: Float32Array;
  bassRatio: Float32Array;
  midRatio: Float32Array;
  highRatio: Float32Array;
}

export class CircularAudioBuffer {
  public size: number;
  public max: Float32Array;
  public min: Float32Array;
  public bassRatio: Float32Array;
  public midRatio: Float32Array;
  public highRatio: Float32Array;
  public recorded: Uint8Array;
  public writePointer: number = 0;

  constructor(size = 1200) {
    this.size = size;
    this.max = new Float32Array(size);
    this.min = new Float32Array(size);
    this.bassRatio = new Float32Array(size);
    this.midRatio = new Float32Array(size);
    this.highRatio = new Float32Array(size);
    this.recorded = new Uint8Array(size);
    this.reset();
  }

  public reset() {
    this.max.fill(0);
    this.min.fill(0);
    this.bassRatio.fill(0.33);
    this.midRatio.fill(0.33);
    this.highRatio.fill(0.33);
    this.recorded.fill(0);
    this.writePointer = 0;
  }

  public write(
    currentTime: number,
    duration: number,
    maxVal: number,
    minVal: number,
    bassR: number,
    midR: number,
    highR: number
  ) {
    if (duration <= 0) return;
    const normTime = Math.max(0, Math.min(0.9999, currentTime / duration));
    const targetIdx = Math.floor(normTime * this.size);

    this.writePointer = targetIdx;

    const curMax = this.max[targetIdx];
    const curMin = this.min[targetIdx];
    const isRecorded = this.recorded[targetIdx] === 1;

    if (!isRecorded || Math.abs(maxVal) > Math.abs(curMax) || curMax === 0) {
      this.max[targetIdx] = Math.max(curMax, maxVal);
      this.min[targetIdx] = Math.min(curMin, minVal);
      this.bassRatio[targetIdx] = bassR;
      this.midRatio[targetIdx] = midR;
      this.highRatio[targetIdx] = highR;
      this.recorded[targetIdx] = 1;
    }
  }

  public seedFromPeaks(peaks: WaveformPeaks) {
    const len = Math.min(this.size, peaks.max.length);
    for (let i = 0; i < len; i++) {
      this.max[i] = peaks.max[i];
      this.min[i] = peaks.min[i];
      this.bassRatio[i] = peaks.bassRatio[i];
      this.midRatio[i] = peaks.midRatio[i];
      this.highRatio[i] = peaks.highRatio[i];
      if (Math.abs(peaks.max[i]) > 0.0001 || Math.abs(peaks.min[i]) > 0.0001) {
        this.recorded[i] = 1;
      }
    }
  }

  public toPeaks(): WaveformPeaks {
    return {
      max: this.max,
      min: this.min,
      bassRatio: this.bassRatio,
      midRatio: this.midRatio,
      highRatio: this.highRatio
    };
  }
}

function createEmptyPeaks(numPoints = 1200): WaveformPeaks {
  return {
    max: new Float32Array(numPoints),
    min: new Float32Array(numPoints),
    bassRatio: new Float32Array(numPoints),
    midRatio: new Float32Array(numPoints),
    highRatio: new Float32Array(numPoints),
  };
}

function getSample(view: DataView, bitsPerSample: number, offset: number): number {
  if (offset + bitsPerSample / 8 > view.byteLength) return 0;
  if (bitsPerSample === 16) {
    return view.getInt16(offset, true) / 32768; // normalize to -1.0 to 1.0
  } else if (bitsPerSample === 24) {
    const b0 = view.getUint8(offset);
    const b1 = view.getUint8(offset + 1);
    const b2 = view.getUint8(offset + 2);
    let val = b0 | (b1 << 8) | (b2 << 16);
    if (val & 0x800000) val |= ~0xffffff; // sign extend
    return val / 8388608;
  } else if (bitsPerSample === 32) {
    return view.getFloat32(offset, true); // IEEE Float
  } else if (bitsPerSample === 8) {
    return (view.getUint8(offset) - 128) / 128; // 8-bit unsigned
  }
  return 0;
}

async function decodeSliceWithRetry(
  ctx: AudioContext,
  fileUrl: string | null,
  arrayBuffer: ArrayBuffer | null,
  startByte: number,
  size: number,
  registeredFile?: File,
  totalLength = 0,
  retries = 2
): Promise<AudioBuffer | null> {
  const byteLength = arrayBuffer ? arrayBuffer.byteLength : totalLength;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const offset = Math.max(0, startByte + attempt * 2048);
    const end = Math.min(byteLength, offset + size);
    if (end <= offset) return null;

    try {
      let slice: ArrayBuffer;
      if (arrayBuffer) {
        slice = arrayBuffer.slice(offset, end);
      } else if (fileUrl) {
        slice = await fetchSlice(fileUrl, offset, end, registeredFile);
      } else {
        return null;
      }
      const decoded = await ctx.decodeAudioData(slice);
      return decoded;
    } catch (e) {
      // slice failed, try with shift
    }
  }
  return null;
}

function getWaveformColor(
  palette: 'void' | 'rgb' | 'blue' | '3-band',
  bass: number,
  mid: number,
  high: number
): { r: number; g: number; b: number } {
  if (palette === 'void') {
    // Red palette: White is passive/inaudible, active signals are vibrant Red spectrum
    const totalEnergy = bass + mid + high;
    if (totalEnergy < 0.08) {
      // Passive / inaudible noise floor: clean subtle white / light grey
      return { r: 215, g: 210, b: 215 };
    }
    // Active energy scale: Deep red (#5C0000) -> Brand Red (#B20000) -> Hot Red/White highlights (#FF3333 / #FFFFFF)
    return {
      r: Math.round(178 * bass + 255 * high + 100 * mid),
      g: Math.round(0 * bass + 50 * high + 10 * mid),
      b: Math.round(0 * bass + 50 * high + 10 * mid)
    };
  } else if (palette === 'blue') {
    return {
      r: Math.round(180 + high * 60),
      g: Math.round(200 + mid * 45),
      b: Math.round(235 + high * 20)
    };
  } else if (palette === '3-band') {
    return {
      r: Math.round(mid * 240 + high * 255),
      g: Math.round(mid * 140 + high * 255),
      b: Math.round(bass * 230 + high * 255)
    };
  } else {
    // Authentic Rekordbox RGB variant matching Pioneer CDJ / Rekordbox standard:
    // Mids = Vibrant Lime Green
    // Highs = Brilliant Cyan / Sky Blue
    // Lows/Bass = Fiery Red / Warm Orange / Yellow
    const total = (bass + mid + high) || 1;
    const bNorm = Math.min(1, Math.max(0, bass / total));
    const mNorm = Math.min(1, Math.max(0, mid / total));
    const hNorm = Math.min(1, Math.max(0, high / total));

    // When bass is high: strong red and warm orange (blends into yellow with mids)
    // When mids are high: dominant electric lime green
    // When highs are high: vibrant cyan / sky blue
    let r = Math.round(bNorm * 255 + (bNorm * mNorm * 130) + mNorm * 45);
    let g = Math.round(mNorm * 245 + bNorm * 85 + hNorm * 175);
    let b = Math.round(hNorm * 255 + mNorm * 30);

    // Boost saturation & vibrancy for high/mid/bass definition matching Rekordbox RGB screenshot
    if (hNorm > 0.42 && hNorm > bNorm) {
      // Crisp cyan/sky blue transient spikes
      b = Math.min(255, Math.round(b * 1.2));
      g = Math.min(240, Math.round(g * 0.95));
      r = Math.min(60, r);
    } else if (bNorm > 0.48) {
      // Warm fiery bass punch (red / orange / golden amber)
      r = Math.min(255, Math.max(220, Math.round(r * 1.15)));
      b = Math.min(40, Math.round(b * 0.3));
    } else if (mNorm > 0.45) {
      // Vivid Rekordbox electric lime green
      g = Math.min(255, Math.max(225, Math.round(g * 1.1)));
      b = Math.min(50, Math.round(b * 0.4));
      r = Math.min(75, Math.round(r * 0.5));
    }

    return { 
      r: Math.max(0, Math.min(255, r)), 
      g: Math.max(0, Math.min(255, g)), 
      b: Math.max(0, Math.min(255, b)) 
    };
  }
}

export function WaveformPanel({ 
  fileUrl, 
  isPlaying, 
  fileName, 
  isPoppedOut = false, 
  onPopOut, 
  isEmbeddedInDeck = false, 
  onDecodingStateChange, 
  waveformPalette = 'rgb',
  onWaveformPaletteChange
}: WaveformPanelProps) {
  const [zoomLevel, setZoomLevel] = useState<number>(3); // Desired zoom level (1 = full file, 3-20 = zoomed)
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isDecoding, setIsDecoding] = useState<boolean>(false);
  const [decodeProgress, setDecodeProgress] = useState<number>(0);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [decodeError, setDecodeError] = useState<string>('');
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [currentDuration, setCurrentDuration] = useState<number>(0);
  const [peaks, setPeaks] = useState<WaveformPeaks>(() => createEmptyPeaks(1200));
  const [focusedOnOutput, setFocusedOnOutput] = useState<boolean>(true);
  const [isLiveGenerating, setIsLiveGenerating] = useState<boolean>(false);

  const workerRef = useRef<Worker | null>(null);
  const circularBufferRef = useRef<CircularAudioBuffer>(new CircularAudioBuffer(1200));
  const peaksRef = useRef<WaveformPeaks>(circularBufferRef.current.toPeaks());

  // Reset circular buffer whenever fileUrl changes
  useEffect(() => {
    circularBufferRef.current.reset();
    peaksRef.current = circularBufferRef.current.toPeaks();
    setPeaks(circularBufferRef.current.toPeaks());
  }, [fileUrl]);

  // Initialize background worker for CPU-intensive DSP and calculation logic
  useEffect(() => {
    const workerBlob = new Blob([`
      self.onmessage = function(e) {
        const { action, channelData, numPoints, step, alphaBass, alphaHigh, pointsPerChunk, requestId } = e.data;
        if (action === 'calculatePeaks') {
          const maxPeaks = new Float32Array(numPoints);
          const minPeaks = new Float32Array(numPoints);
          const bassRatios = new Float32Array(numPoints);
          const midRatios = new Float32Array(numPoints);
          const highRatios = new Float32Array(numPoints);

          let lpBassState = 0;
          let lpMidState = 0;

          for (let i = 0; i < numPoints; i++) {
            const start = i * step;
            const end = Math.min(channelData.length, start + step);
            
            let maxVal = -1.0;
            let minVal = 1.0;
            let hasSamples = false;

            let bassEnergy = 0;
            let midEnergy = 0;
            let highEnergy = 0;

            for (let j = start; j < end; j++) {
              const val = channelData[j];
              
              if (!hasSamples) {
                maxVal = val;
                minVal = val;
                hasSamples = true;
              } else {
                if (val > maxVal) maxVal = val;
                if (val < minVal) minVal = val;
              }

              lpBassState += alphaBass * (val - lpBassState);
              const bassVal = lpBassState;

              lpMidState += alphaHigh * (val - lpMidState);
              const highVal = val - lpMidState;
              const midVal = val - bassVal - highVal;

              bassEnergy += Math.abs(bassVal);
              midEnergy += Math.abs(midVal);
              highEnergy += Math.abs(highVal);
            }

            if (!hasSamples) {
              maxVal = 0;
              minVal = 0;
            }

            maxPeaks[i] = maxVal;
            minPeaks[i] = minVal;

            const totalEnergy = bassEnergy + midEnergy + highEnergy;
            if (totalEnergy > 0) {
              bassRatios[i] = bassEnergy / totalEnergy;
              midRatios[i] = midEnergy / totalEnergy;
              highRatios[i] = highEnergy / totalEnergy;
            } else {
              bassRatios[i] = 0.33;
              midRatios[i] = 0.33;
              highRatios[i] = 0.33;
            }
          }

          self.postMessage({
            action: 'calculatePeaksResult',
            requestId,
            maxPeaks,
            minPeaks,
            bassRatios,
            midRatios,
            highRatios
          }, [maxPeaks.buffer, minPeaks.buffer, bassRatios.buffer, midRatios.buffer, highRatios.buffer]);
        } else if (action === 'calculateSegmentPeaks') {
          const maxPeaks = new Float32Array(pointsPerChunk);
          const minPeaks = new Float32Array(pointsPerChunk);
          const bassRatios = new Float32Array(pointsPerChunk);
          const midRatios = new Float32Array(pointsPerChunk);
          const highRatios = new Float32Array(pointsPerChunk);

          const innerStep = Math.floor(channelData.length / pointsPerChunk);
          let lpBassState = 0;
          let lpMidState = 0;

          for (let p = 0; p < pointsPerChunk; p++) {
            const start = p * innerStep;
            const end = Math.min(channelData.length, start + innerStep);
            let maxVal = -1.0;
            let minVal = 1.0;
            let hasSamples = false;

            let bassEnergy = 0;
            let midEnergy = 0;
            let highEnergy = 0;

            for (let j = start; j < end; j++) {
              const val = channelData[j];
              
              if (!hasSamples) {
                maxVal = val;
                minVal = val;
                hasSamples = true;
              } else {
                if (val > maxVal) maxVal = val;
                if (val < minVal) minVal = val;
              }

              lpBassState += alphaBass * (val - lpBassState);
              const bassVal = lpBassState;

              lpMidState += alphaHigh * (val - lpMidState);
              const highVal = val - lpMidState;
              const midVal = val - bassVal - highVal;

              bassEnergy += Math.abs(bassVal);
              midEnergy += Math.abs(midVal);
              highEnergy += Math.abs(highVal);
            }

            if (!hasSamples) {
              maxVal = 0;
              minVal = 0;
            }

            maxPeaks[p] = maxVal;
            minPeaks[p] = minVal;

            const totalEnergy = bassEnergy + midEnergy + highEnergy;
            if (totalEnergy > 0) {
              bassRatios[p] = bassEnergy / totalEnergy;
              midRatios[p] = midEnergy / totalEnergy;
              highRatios[p] = highEnergy / totalEnergy;
            } else {
              bassRatios[p] = 0.33;
              midRatios[p] = 0.33;
              highRatios[p] = 0.33;
            }
          }

          self.postMessage({
            action: 'calculateSegmentPeaksResult',
            requestId,
            maxPeaks,
            minPeaks,
            bassRatios,
            midRatios,
            highRatios
          }, [maxPeaks.buffer, minPeaks.buffer, bassRatios.buffer, midRatios.buffer, highRatios.buffer]);
        }
      };
    `], { type: 'application/javascript' });

    const workerUrl = URL.createObjectURL(workerBlob);
    const worker = new Worker(workerUrl);
    workerRef.current = worker;

    return () => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };
  }, []);

  const calculatePeaksWithWorker = (channelData: Float32Array): Promise<WaveformPeaks> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const requestId = Math.random();

      const handleMessage = (e: MessageEvent) => {
        if (e.data.action === 'calculatePeaksResult' && e.data.requestId === requestId) {
          workerRef.current?.removeEventListener('message', handleMessage);
          resolve({
            max: e.data.maxPeaks,
            min: e.data.minPeaks,
            bassRatio: e.data.bassRatios,
            midRatio: e.data.midRatios,
            highRatio: e.data.highRatios
          });
        }
      };

      workerRef.current.addEventListener('message', handleMessage);

      const step = Math.floor(channelData.length / 1200);
      // Transfer of active playback buffers directly is unsafe and causes silent/detached buffers.
      // Therefore, we let normal structured clone handle array duplication asynchronously.
      workerRef.current.postMessage({
        action: 'calculatePeaks',
        requestId,
        channelData,
        numPoints: 1200,
        step,
        alphaBass: 0.028,
        alphaHigh: 0.57
      });
    });
  };

  const calculateSegmentPeaksWithWorker = (channelData: Float32Array, pointsPerChunk: number): Promise<WaveformPeaks> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const requestId = Math.random();

      const handleMessage = (e: MessageEvent) => {
        if (e.data.action === 'calculateSegmentPeaksResult' && e.data.requestId === requestId) {
          workerRef.current?.removeEventListener('message', handleMessage);
          resolve({
            max: e.data.maxPeaks,
            min: e.data.minPeaks,
            bassRatio: e.data.bassRatios,
            midRatio: e.data.midRatios,
            highRatio: e.data.highRatios
          });
        }
      };

      workerRef.current.addEventListener('message', handleMessage);

      // Slices can be transferred safely since they are short-lived allocations from the segment loop
      workerRef.current.postMessage({
        action: 'calculateSegmentPeaks',
        requestId,
        channelData,
        pointsPerChunk,
        alphaBass: 0.028,
        alphaHigh: 0.57
      }, [channelData.buffer]);
    });
  };

  useEffect(() => {
    onDecodingStateChange?.(isDecoding);
  }, [isDecoding, onDecodingStateChange]);

  const [fontsLoaded, setFontsLoaded] = useState(false);
  useEffect(() => {
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(() => setFontsLoaded(true));
    }
  }, []);

  const overviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cachedBuffers = useRef<Map<string, AudioBuffer>>(new Map());
  const cachedPeaks = useRef<Map<string, WaveformPeaks>>(new Map());

  const setCachedBuffer = (url: string, buffer: AudioBuffer) => {
    const cache = cachedBuffers.current;
    if (cache.size >= 3) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
    cache.set(url, buffer);
  };

  const setCachedPeaks = (url: string, pf: WaveformPeaks) => {
    const cache = cachedPeaks.current;
    if (cache.size >= 10) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
    cache.set(url, pf);
  };

  // Real-time live output waveform sampler loop (samples active output audio node)
  useEffect(() => {
    let animId: number;

    const sampleLiveOutput = () => {
      const elem = audioAnalyzer.getAudioElement();
      const cTime = elem ? elem.currentTime : currentTime;
      if (elem && elem.currentTime !== currentTime) {
        setCurrentTime(elem.currentTime);
      }

      const dur = (elem && !isNaN(elem.duration) && elem.duration > 0)
        ? elem.duration
        : (currentDuration || 180);

      if (elem && elem.duration && elem.duration !== currentDuration && !isNaN(elem.duration)) {
        setCurrentDuration(elem.duration);
      }

      const analyser = audioAnalyzer.getAnalyser();
      const isSourceActive = audioAnalyzer.isSourceActive();

      if (analyser && (isPlaying || isSourceActive)) {
        setIsLiveGenerating(true);
        const fftSize = analyser.fftSize || 2048;
        const timeData = new Float32Array(fftSize);
        analyser.getFloatTimeDomainData(timeData);

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData);

        let maxVal = -1.0;
        let minVal = 1.0;
        for (let i = 0; i < timeData.length; i++) {
          const v = timeData[i];
          if (v > maxVal) maxVal = v;
          if (v < minVal) minVal = v;
        }
        if (maxVal === -1.0 || isNaN(maxVal)) {
          maxVal = 0;
          minVal = 0;
        }

        const sampleRate = audioAnalyzer.getContext()?.sampleRate || 44100;
        const binHz = (sampleRate / 2) / freqData.length;
        let bassSum = 0, midSum = 0, highSum = 0;
        for (let i = 0; i < freqData.length; i++) {
          const freq = i * binHz;
          const val = freqData[i] / 255;
          if (freq < 250) bassSum += val;
          else if (freq < 4000) midSum += val;
          else highSum += val;
        }
        const totalSum = bassSum + midSum + highSum;
        let bassR = 0.33, midR = 0.33, highR = 0.33;
        if (totalSum > 0) {
          bassR = bassSum / totalSum;
          midR = midSum / totalSum;
          highR = highSum / totalSum;
        }

        // Write real-time audio amplitude and spectral distribution to circular buffer
        circularBufferRef.current.write(cTime, dur, maxVal, minVal, bassR, midR, highR);
        peaksRef.current = circularBufferRef.current.toPeaks();
      } else {
        setIsLiveGenerating(false);
      }

      animId = requestAnimationFrame(sampleLiveOutput);
    };

    animId = requestAnimationFrame(sampleLiveOutput);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, currentTime, currentDuration, zoomLevel, waveformPalette, focusedOnOutput]);

  // Synchronize dynamic duration changes
  useEffect(() => {
    const elem = audioAnalyzer.getAudioElement();
    if (!elem) return;

    const updateDuration = () => {
      if (elem.duration && !isNaN(elem.duration)) {
        setCurrentDuration(elem.duration);
      }
    };

    updateDuration();
    elem.addEventListener('durationchange', updateDuration);
    elem.addEventListener('loadedmetadata', updateDuration);

    return () => {
      elem.removeEventListener('durationchange', updateDuration);
      elem.removeEventListener('loadedmetadata', updateDuration);
    };
  }, [fileUrl, audioBuffer]);

  // Extract multi-chromatic frequency peaks from AudioBuffer
  const calculatePeaksFromBuffer = (buffer: AudioBuffer): WaveformPeaks => {
    const numPoints = 1200; // Resolution of peak extraction
    const maxPeaks = new Float32Array(numPoints);
    const minPeaks = new Float32Array(numPoints);
    const bassRatios = new Float32Array(numPoints);
    const midRatios = new Float32Array(numPoints);
    const highRatios = new Float32Array(numPoints);

    const channelData = buffer.getChannelData(0);
    const step = Math.floor(channelData.length / numPoints);

    // Exponential Moving Average (EMA) coefficients for low/mid/high separation
    const alphaBass = 0.028; // ~200Hz crossover
    const alphaHigh = 0.57;  // ~4000Hz crossover

    let lpBassState = 0;
    let lpMidState = 0;

    for (let i = 0; i < numPoints; i++) {
      const start = i * step;
      const end = Math.min(channelData.length, start + step);
      
      let maxVal = -1.0;
      let minVal = 1.0;
      let hasSamples = false;

      let bassEnergy = 0;
      let midEnergy = 0;
      let highEnergy = 0;

      for (let j = start; j < end; j++) {
        const val = channelData[j];
        
        if (!hasSamples) {
          maxVal = val;
          minVal = val;
          hasSamples = true;
        } else {
          if (val > maxVal) maxVal = val;
          if (val < minVal) minVal = val;
        }

        // True physical band separations via DSP filtering
        lpBassState += alphaBass * (val - lpBassState);
        const bassVal = lpBassState;

        lpMidState += alphaHigh * (val - lpMidState);
        const highVal = val - lpMidState;
        const midVal = val - bassVal - highVal;

        bassEnergy += Math.abs(bassVal);
        midEnergy += Math.abs(midVal);
        highEnergy += Math.abs(highVal);
      }

      if (!hasSamples) {
        maxVal = 0;
        minVal = 0;
      }

      maxPeaks[i] = maxVal;
      minPeaks[i] = minVal;

      const totalEnergy = bassEnergy + midEnergy + highEnergy;
      if (totalEnergy > 0) {
        bassRatios[i] = bassEnergy / totalEnergy;
        midRatios[i] = midEnergy / totalEnergy;
        highRatios[i] = highEnergy / totalEnergy;
      } else {
        bassRatios[i] = 0.33;
        midRatios[i] = 0.33;
        highRatios[i] = 0.33;
      }
    }

    return { max: maxPeaks, min: minPeaks, bassRatio: bassRatios, midRatio: midRatios, highRatio: highRatios };
  };

  // Decode the sound whenever fileUrl changes (progressive sampling algorithm for large files)
  useEffect(() => {
    if (!fileUrl) {
      setAudioBuffer(null);
      const emptyP = createEmptyPeaks(1200);
      peaksRef.current = emptyP;
      setPeaks(emptyP);
      setDecodeError('');
      setCurrentDuration(0);
      return;
    }

    if (cachedBuffers.current.has(fileUrl)) {
      const decoded = cachedBuffers.current.get(fileUrl) || null;
      setAudioBuffer(decoded);
      if (decoded && cachedPeaks.current.has(fileUrl)) {
        const cp = cachedPeaks.current.get(fileUrl)!;
        circularBufferRef.current.seedFromPeaks(cp);
        peaksRef.current = circularBufferRef.current.toPeaks();
        setPeaks(peaksRef.current);
      } else {
        const emptyP = createEmptyPeaks(1200);
        peaksRef.current = emptyP;
        setPeaks(emptyP);
      }
      setDecodeError('');
      setIsDecoding(false);
      return;
    }

    // Cache lookup for progressively decoded ones
    if (cachedPeaks.current.has(fileUrl)) {
      setPeaks(cachedPeaks.current.get(fileUrl) || null);
      const elem = audioAnalyzer.getAudioElement();
      const pDuration = (elem && !isNaN(elem.duration) && elem.duration > 0) ? elem.duration : 180;
      const pBuffer = {
        get duration() { return currentDuration || pDuration; },
        length: pDuration * 44100,
        numberOfChannels: 1,
        sampleRate: 44100,
        getChannelData: (ch: number) => new Float32Array(0)
      } as any;
      setAudioBuffer(pBuffer);
      setDecodeError('');
      setIsDecoding(false);
      return;
    }

    let active = true;
    const fetchAndDecode = async () => {
      let ctxOnTheFly: AudioContext | null = null;
      try {
        setIsDecoding(true);
        setDecodeProgress(10);
        setDecodeError('');

        const totalLength = await getAudioFileSize(fileUrl, AudioFileRegistry.get(fileUrl));
        if (!active) return;
        setDecodeProgress(25);

        const existingCtx = audioAnalyzer.getContext();
        ctxOnTheFly = !existingCtx ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;
        const ctx = existingCtx || ctxOnTheFly;
        
        // Large files (larger than 4.5MB) are loaded progressively/sampled to avoid crashing Web Audio memory thread
        const isLargeFile = totalLength >= 4.5 * 1024 * 1024;

        if (!isLargeFile) {
          // Standard Context Decoding for small files
          const response = await fetch(fileUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch audio file: ${response.status} ${response.statusText}`);
          }
          if (!active) return;
          setDecodeProgress(45);

          const arrayBuffer = await response.arrayBuffer();
          if (!active) return;
          setDecodeProgress(65);

          const decoded = await ctx.decodeAudioData(arrayBuffer);
          if (!active) return;

          const channelData = decoded.getChannelData(0);
          const calculatedPeaks = await calculatePeaksWithWorker(channelData);
          if (!active) return;

          setCachedBuffer(fileUrl, decoded);
          setCachedPeaks(fileUrl, calculatedPeaks);
          
          circularBufferRef.current.seedFromPeaks(calculatedPeaks);
          peaksRef.current = circularBufferRef.current.toPeaks();
          setPeaks(peaksRef.current);
          setAudioBuffer(decoded);
          setCurrentDuration(decoded.duration);
          setDecodeProgress(100);
          setIsDecoding(false);
        } else {
          // Progressive Multi-region Segment sampling for large files
          const numPoints = 1200;
          const maxPeaks = new Float32Array(numPoints);
          const minPeaks = new Float32Array(numPoints);
          const bassRatios = new Float32Array(numPoints);
          const midRatios = new Float32Array(numPoints);
          const highRatios = new Float32Array(numPoints);

          const registeredFile = AudioFileRegistry.get(fileUrl);

          // Get first 4KB header buffer to inspect and test WAV fast path
          const headerBuffer = await fetchPartialArrayBuffer(fileUrl, 4096);
          const headerView = new DataView(headerBuffer);

          // Fast-path: Binary decoding for WAV type container
          const isWav = headerBuffer.byteLength > 12 &&
                        String.fromCharCode(...new Uint8Array(headerBuffer, 0, 4)) === 'RIFF' &&
                        String.fromCharCode(...new Uint8Array(headerBuffer, 8, 4)) === 'WAVE';

          if (isWav) {
            try {
              let offset = 12;
              let numChannels = 1;
              let sampleRate = 44100;
              let bitsPerSample = 16;
              let dataOffset = 44;
              let dataLen = registeredFile ? registeredFile.size - 44 : totalLength - 44;

              while (offset < headerBuffer.byteLength - 8) {
                const chunkId = String.fromCharCode(...new Uint8Array(headerBuffer, offset, 4));
                const chunkSize = headerView.getUint32(offset + 4, true);
                if (chunkId === "fmt ") {
                  const view = new DataView(headerBuffer, offset + 8, chunkSize);
                  numChannels = view.getUint16(2, true);
                  sampleRate = view.getUint32(4, true);
                  bitsPerSample = view.getUint16(14, true);
                } else if (chunkId === "data") {
                  dataOffset = offset + 8;
                  dataLen = chunkSize;
                  break;
                }
                offset += 8 + chunkSize + (chunkSize % 2);
              }

              if (dataLen > 0) {
                const bytesPerSample = bitsPerSample / 8;
                const blockAlign = numChannels * bytesPerSample;
                const totalFrames = Math.floor(dataLen / blockAlign);
                const stepFrames = Math.floor(totalFrames / numPoints);

                let lpBassState = 0;
                let lpMidState = 0;
                const alphaBass = 0.028;
                const alphaHigh = 0.57;

                for (let i = 0; i < numPoints; i++) {
                  if (!active) return;
                  const startFrame = i * stepFrames;
                  const blockFrames = Math.min(1024, stepFrames);
                  
                  let maxVal = -1.0;
                  let minVal = 1.0;
                  let hasSamples = false;

                  let bassEnergy = 0;
                  let midEnergy = 0;
                  let highEnergy = 0;

                  // Slice and fetch ONLY the targeted sequence off-disk or via HTTP range requests
                  const readSize = blockFrames * blockAlign;
                  const frameOffset = dataOffset + startFrame * blockAlign;
                  
                  let sliceBuf: ArrayBuffer;
                  try {
                    sliceBuf = await fetchSlice(fileUrl, frameOffset, frameOffset + readSize, registeredFile);
                  } catch (e) {
                    sliceBuf = new ArrayBuffer(0);
                  }
                  
                  const view = new DataView(sliceBuf);

                  for (let f = 0; f < blockFrames; f++) {
                    const blockByteOffset = f * blockAlign;
                    if (blockByteOffset + blockAlign > sliceBuf.byteLength) break;

                    const val = getSample(view, bitsPerSample, blockByteOffset);
                    
                    if (!hasSamples) {
                      maxVal = val;
                      minVal = val;
                      hasSamples = true;
                    } else {
                      if (val > maxVal) maxVal = val;
                      if (val < minVal) minVal = val;
                    }

                    // 3-band separation filters
                    lpBassState += alphaBass * (val - lpBassState);
                    const bassVal = lpBassState;

                    lpMidState += alphaHigh * (val - lpMidState);
                    const highVal = val - lpMidState;
                    const midVal = val - bassVal - highVal;

                    bassEnergy += Math.abs(bassVal);
                    midEnergy += Math.abs(midVal);
                    highEnergy += Math.abs(highVal);
                  }

                  if (!hasSamples) {
                    maxVal = 0;
                    minVal = 0;
                  }

                  maxPeaks[i] = maxVal;
                  minPeaks[i] = minVal;

                  const totalEnergy = bassEnergy + midEnergy + highEnergy;
                  if (totalEnergy > 0) {
                    bassRatios[i] = bassEnergy / totalEnergy;
                    midRatios[i] = midEnergy / totalEnergy;
                    highRatios[i] = highEnergy / totalEnergy;
                  } else {
                    bassRatios[i] = 0.33;
                    midRatios[i] = 0.33;
                    highRatios[i] = 0.33;
                  }

                  if (i % 60 === 0) {
                    setDecodeProgress(Math.round(45 + (i / numPoints) * 55));
                    setPeaks({
                      max: new Float32Array(maxPeaks),
                      min: new Float32Array(minPeaks),
                      bassRatio: new Float32Array(bassRatios),
                      midRatio: new Float32Array(midRatios),
                      highRatio: new Float32Array(highRatios)
                    });
                  }
                }

                const finalDuration = totalFrames / sampleRate;
                const result = { max: maxPeaks, min: minPeaks, bassRatio: bassRatios, midRatio: midRatios, highRatio: highRatios };
                setCachedPeaks(fileUrl, result);
                
                const pBuffer = {
                  get duration() { return currentDuration || finalDuration; },
                  length: totalFrames,
                  numberOfChannels: numChannels,
                  sampleRate: sampleRate,
                  getChannelData: (ch: number) => new Float32Array(0)
                } as any;

                circularBufferRef.current.seedFromPeaks(result);
                peaksRef.current = circularBufferRef.current.toPeaks();
                setPeaks(peaksRef.current);
                setAudioBuffer(pBuffer);
                setCurrentDuration(finalDuration);
                setDecodeProgress(100);
                setIsDecoding(false);
                return;
              }
            } catch (wavErr) {
              console.warn("Fast-path WAV peak parsing failed, using fallback:", wavErr);
            }
          }

          // Otherwise (MP3, OGG, FLAC, M4A, etc.): Sliced-Chunk decoder
          const numChunks = 40;
          const chunkSize = 256 * 1024; // 256KB segments
          const pointsPerChunk = numPoints / numChunks;

          // Set initial zero peaks for progressive overlay rendering
          setPeaks({ max: maxPeaks, min: minPeaks, bassRatio: bassRatios, midRatio: midRatios, highRatio: highRatios });

          for (let c = 0; c < numChunks; c++) {
            if (!active) return;
            setDecodeProgress(Math.round(45 + (c / numChunks) * 50));

            const maxStartByte = Math.max(0, totalLength - chunkSize);
            const startByte = Math.floor((c / (numChunks - 1)) * maxStartByte);

            const decodedSlice = await decodeSliceWithRetry(ctx, fileUrl, null, startByte, chunkSize, registeredFile, totalLength);
            if (!active) return;

            if (decodedSlice) {
              const channelData = decodedSlice.getChannelData(0);
              const segmentPeaks = await calculateSegmentPeaksWithWorker(channelData, pointsPerChunk);
              if (!active) return;

              for (let p = 0; p < pointsPerChunk; p++) {
                const globalIdx = c * pointsPerChunk + p;
                maxPeaks[globalIdx] = segmentPeaks.max[p];
                minPeaks[globalIdx] = segmentPeaks.min[p];
                bassRatios[globalIdx] = segmentPeaks.bassRatio[p];
                midRatios[globalIdx] = segmentPeaks.midRatio[p];
                highRatios[globalIdx] = segmentPeaks.highRatio[p];
              }
            }

            // Stagger and yield to trigger progressive UI drawing frame
            setPeaks({
              max: new Float32Array(maxPeaks),
              min: new Float32Array(minPeaks),
              bassRatio: new Float32Array(bassRatios),
              midRatio: new Float32Array(midRatios),
              highRatio: new Float32Array(highRatios)
            });
            await new Promise(r => setTimeout(r, 4));
          }

          // Build dynamic pseudo buffer
          const elem = audioAnalyzer.getAudioElement();
          const pDuration = (elem && !isNaN(elem.duration) && elem.duration > 0) ? elem.duration : 180;
          
          const pBuffer = {
            get duration() { return currentDuration || (elem && !isNaN(elem.duration) && elem.duration > 0 ? elem.duration : pDuration); },
            length: pDuration * 44100,
            numberOfChannels: 1,
            sampleRate: 44100,
            getChannelData: (ch: number) => new Float32Array(0)
          } as any;

          const finalPeaksSet = { max: maxPeaks, min: minPeaks, bassRatio: bassRatios, midRatio: midRatios, highRatio: highRatios };
          setCachedPeaks(fileUrl, finalPeaksSet);

          circularBufferRef.current.seedFromPeaks(finalPeaksSet);
          peaksRef.current = circularBufferRef.current.toPeaks();
          setPeaks(peaksRef.current);
          setAudioBuffer(pBuffer);
          if (elem && elem.duration && !isNaN(elem.duration)) {
            setCurrentDuration(elem.duration);
          } else {
            setCurrentDuration(pDuration);
          }
          setDecodeProgress(100);
          setIsDecoding(false);
        }
      } catch (err: any) {
        console.warn('Waveform background decode handled gracefully:', err);
        if (active) {
          const isNetworkError = err && (err.name === 'TypeError' || err.message === 'Failed to fetch' || String(err).includes('fetch'));
          if (isNetworkError) {
            setDecodeError('CORS restriction on remote track. Waveform estimation is bypassed, but master audio playback works perfectly.');
          } else {
            setDecodeError('Could not decode audio structure. (Unsupported format or restricted sandbox capacity).');
          }
          setIsDecoding(false);
        }
      } finally {
        if (ctxOnTheFly) {
          try {
            await ctxOnTheFly.close();
          } catch (e) {
            console.warn('Temporary decoding AudioContext close failed:', e);
          }
        }
      }
    };

    fetchAndDecode();

    return () => {
      active = false;
    };
  }, [fileUrl]);

  // Handle Scrubbing/Seeking on click
  const handleSeek = (ratio: number) => {
    const elem = audioAnalyzer.getAudioElement();
    if (elem) {
      elem.currentTime = ratio * elem.duration;
    }
  };

  // Draw Overview Waveform
  useEffect(() => {
    const canvas = overviewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Deep space slate theme background
    ctx.fillStyle = 'rgba(1, 1, 3, 0.45)';
    ctx.fillRect(0, 0, width, height);

    const p = peaksRef.current;
    const length = p.max.length;
    const barWidth = width / length;
    const dur = currentDuration || (audioBuffer ? audioBuffer.duration : 180);
    const ratioPlayed = Math.max(0, Math.min(1, currentTime / dur));

    for (let i = 0; i < length; i++) {
      const maxVal = p.max[i] || 0;
      const minVal = p.min[i] || 0;
      const hMax = (maxVal * height) / 2;
      const hMin = (minVal * height) / 2;

      const midY = height / 2;
      const x = i * (width / length);

      // Resolve Rekordbox cohesive color palettes (Blue, RGB, 3-band)
      const { r, g, b } = getWaveformColor(waveformPalette || 'rgb', p.bassRatio[i] || 0.33, p.midRatio[i] || 0.33, p.highRatio[i] || 0.33);

      // Desaturated if played
      const isPlayed = (i / length) < ratioPlayed;
      const alpha = isPlayed ? '0.4' : '0.82';
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;

      // Center balanced vertical vector lines (no wider fat bars)
      const drawWidth = barWidth <= 3 ? Math.max(1, barWidth - 0.5) : 2.0;
      const drawX = x + (barWidth - drawWidth) / 2;
      ctx.fillRect(drawX, midY - hMax, drawWidth, hMax - hMin);
    }

    // Playhead indicator line
    const px = ratioPlayed * width;
    ctx.strokeStyle = '#B20000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();

    // Zoom window bracket
    if (zoomLevel > 1) {
      const zoomWindowWidth = width / zoomLevel;
      const windowStart = Math.min(Math.max(0, px - zoomWindowWidth / 2), width - zoomWindowWidth);
      ctx.fillStyle = 'rgba(178, 0, 0, 0.15)';
      ctx.strokeStyle = 'rgba(255, 51, 51, 0.4)';
      ctx.lineWidth = 1;
      ctx.fillRect(windowStart, 0, zoomWindowWidth, height);
      ctx.strokeRect(windowStart, 0, zoomWindowWidth, height);
    }
  }, [peaks, audioBuffer, currentTime, zoomLevel, waveformPalette, currentDuration]);

  // Draw Segment Detail Zoomed Waveform
  useEffect(() => {
    const canvas = detailCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Deep premium background
    ctx.fillStyle = 'rgba(2, 2, 5, 0.75)';
    ctx.fillRect(0, 0, width, height);

    const p = peaksRef.current;
    const length = p.max.length;
    const dur = currentDuration || (audioBuffer ? audioBuffer.duration : 180);
    const ratioPlayed = Math.max(0, Math.min(1, currentTime / dur));

    // Time domain windowing mapping:
    const viewWidth = length / zoomLevel;
    const centerIndex = ratioPlayed * length;
    const startIndex = Math.min(Math.max(0, centerIndex - viewWidth / 2), length - viewWidth);

    // Dynamic resolution scaler factor:
    // As zoomLevel increases, we dynamically scale up the sample rendering density and sub-sample interpolation
    // so high zoom levels display fine sub-pixel interpolated vectors rather than chunky blocks.
    const resolutionScale = Math.min(8, Math.max(1, Math.round(Math.sqrt(zoomLevel) * 2)));
    const renderSteps = Math.floor(viewWidth * resolutionScale);
    const stepPixelWidth = width / renderSteps;
    const midY = height / 2;

    // Draw horizontal silence marker
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    for (let step = 0; step < renderSteps; step++) {
      const fracIndex = startIndex + (step / renderSteps) * viewWidth;
      if (fracIndex >= length) break;

      const idx0 = Math.floor(fracIndex);
      const idx1 = Math.min(length - 1, idx0 + 1);
      const t = fracIndex - idx0;

      const maxVal = (1 - t) * (p.max[idx0] || 0) + t * (p.max[idx1] || 0);
      const minVal = (1 - t) * (p.min[idx0] || 0) + t * (p.min[idx1] || 0);
      const bassR = (1 - t) * (p.bassRatio[idx0] || 0.33) + t * (p.bassRatio[idx1] || 0.33);
      const midR = (1 - t) * (p.midRatio[idx0] || 0.33) + t * (p.midRatio[idx1] || 0.33);
      const highR = (1 - t) * (p.highRatio[idx0] || 0.33) + t * (p.highRatio[idx1] || 0.33);

      const hMax = (maxVal * height) / 2.1;
      const hMin = (minVal * height) / 2.1;

      const x = step * stepPixelWidth;

      // Pioneer Multi-color styling (Bass: Coral-Red, Mid: Green, High: Electric Blue)
      const { r, g, b } = getWaveformColor(waveformPalette || 'rgb', bassR, midR, highR);

      const isPlayed = (fracIndex / length) < ratioPlayed;
      const alpha = isPlayed ? '0.35' : '1.0';

      const drawWidth = stepPixelWidth <= 3 ? Math.max(1, stepPixelWidth - 0.5) : 2.0;
      const drawX = x + (stepPixelWidth - drawWidth) / 2;

      // Drop shadows for professional contrast
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(drawX, midY - hMax + 1, drawWidth, hMax - hMin);

      // Core Peak Line
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fillRect(drawX, midY - hMax, drawWidth, hMax - hMin);
    }

    // Centered Playhead Line Marker (The Scrolling center target)
    const barPixelWidth = width / viewWidth;
    const playheadX = Math.min(Math.max(0, (centerIndex - startIndex) * barPixelWidth), width);
    ctx.strokeStyle = '#B20000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // Visual red triangle accents on top/bottom of zoom cursor
    ctx.fillStyle = '#B20000';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, 0);
    ctx.lineTo(playheadX + 6, 0);
    ctx.lineTo(playheadX, 6);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(playheadX - 6, height);
    ctx.lineTo(playheadX + 6, height);
    ctx.lineTo(playheadX, height - 6);
    ctx.fill();

    // Time grids
    ctx.font = '10px "Geist Pixel", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(formatTime(currentTime), playheadX + 4, 13);
    ctx.fillText(formatTime(dur), width - 45, 13);

    // Live generating badge
    if (isLiveGenerating) {
      ctx.fillStyle = 'rgba(122, 31, 209, 0.85)';
      ctx.fillRect(6, height - 16, 125, 12);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '7px "Geist Pixel", monospace';
      ctx.fillText('• LIVE GENERATING FROM OUTPUT', 10, height - 7);
    }
  }, [peaks, audioBuffer, currentTime, zoomLevel, waveformPalette, currentDuration, focusedOnOutput, isLiveGenerating, fontsLoaded]);

  // Scrubber drag state refs for smooth mouse & touch scrubbing
  const isScrubbingRef = useRef<boolean>(false);
  const activeScrubCanvasRef = useRef<'overview' | 'detail' | null>(null);

  const seekFromClientX = (clientX: number, target: 'overview' | 'detail') => {
    if (target === 'overview') {
      const canvas = overviewCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const ratio = Math.max(0, Math.min(0.9999, x / rect.width));
      handleSeek(ratio);
    } else {
      const canvas = detailCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;

      const dur = currentDuration || (audioBuffer ? audioBuffer.duration : 180);
      const ratioPlayed = currentTime / dur;
      const length = 1200;

      const viewWidth = length / zoomLevel;
      const centerIndex = ratioPlayed * length;
      const startIndex = Math.max(0, Math.min(length - viewWidth, centerIndex - viewWidth / 2));

      const clickedRatio = (startIndex + (x / rect.width) * viewWidth) / length;
      handleSeek(Math.max(0, Math.min(0.9999, clickedRatio)));
    }
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isScrubbingRef.current && activeScrubCanvasRef.current) {
        seekFromClientX(e.clientX, activeScrubCanvasRef.current);
      }
    };

    const handleGlobalMouseUp = () => {
      if (isScrubbingRef.current) {
        isScrubbingRef.current = false;
        activeScrubCanvasRef.current = null;
      }
    };

    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (isScrubbingRef.current && activeScrubCanvasRef.current && e.touches[0]) {
        seekFromClientX(e.touches[0].clientX, activeScrubCanvasRef.current);
      }
    };

    const handleGlobalTouchEnd = () => {
      if (isScrubbingRef.current) {
        isScrubbingRef.current = false;
        activeScrubCanvasRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchmove', handleGlobalTouchMove);
    window.addEventListener('touchend', handleGlobalTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchmove', handleGlobalTouchMove);
      window.removeEventListener('touchend', handleGlobalTouchEnd);
    };
  }, [currentTime, currentDuration, zoomLevel, audioBuffer]);

  // Click/press handler on overview
  const handleOverviewClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    seekFromClientX(e.clientX, 'overview');
  };

  // Click/press handler on Detail/Scrolling
  const handleDetailClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    seekFromClientX(e.clientX, 'detail');
  };

  // Helper formats
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div 
      className={`select-none w-full flex flex-col bg-[#1a1a1a] ${
        isEmbeddedInDeck 
          ? 'space-y-1.5 p-0 bg-transparent' 
          : isPoppedOut 
            ? 'space-y-5 border-0 p-0 h-full' 
            : 'border border-[#4a4a4a] overflow-hidden'
      }`} 
      id="waveform-panel-observe-card"
    >
      {/* 1. Header Toolbar */}
      {!isPoppedOut && !isEmbeddedInDeck && (
        <div className="flex flex-col md:flex-row md:items-center justify-between p-3 bg-[#121212] border-b border-[#4a4a4a] z-10 gap-3" id="waveform-header">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-[#181818] border border-[#4a4a4a] text-[#b20000] flex items-center justify-center">
                <Waves className="w-4 h-4 text-[#b20000]" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white tracking-[1.4px] font-sans uppercase">
                  Waveform Monitor
                </h3>
              </div>
            </div>

            {/* Instant Waveform Palette Switcher */}
            {onWaveformPaletteChange && (
              <div 
                className="flex items-center gap-1.5 p-1 bg-[#181818] border border-[#4a4a4a] h-7"
                title="Select waveform color bands palette type"
              >
                <span className="text-[#aaaaaa] pl-1 text-[9px] font-sans font-bold uppercase tracking-[1px]">Mode:</span>
                <select
                  id="select-waveform-palette-header"
                  value={waveformPalette}
                  onChange={(e) => onWaveformPaletteChange(e.target.value as 'void' | 'rgb' | 'blue' | '3-band')}
                  className="bg-transparent border-0 text-white focus:outline-none cursor-pointer font-sans text-[10px] font-bold uppercase tracking-[0.5px] pr-1"
                >
                  <option value="rgb" className="bg-[#181818]">RGB (Default)</option>
                  <option value="void" className="bg-[#181818]">BREACH Red</option>
                  <option value="blue" className="bg-[#181818]">Blue</option>
                  <option value="3-band" className="bg-[#181818]">3-Band</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2" id="waveform-header-controls">
            {/* 4. Zoom feature (Mag Zoom) */}
            {(audioBuffer || fileUrl || isLiveGenerating) && (
              <div className="flex items-center gap-1.5 bg-[#181818] px-2 py-0.5 border border-[#4a4a4a] h-8 text-[10px]">
                <span className="text-[#aaaaaa] font-sans font-bold uppercase tracking-[1px]">Zoom:</span>
                <button
                  type="button"
                  onClick={() => setZoomLevel(Math.max(1, zoomLevel - 1))}
                  disabled={zoomLevel <= 1}
                  className="text-[#aaaaaa] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer p-0.5"
                  title="Decode Waveform Out"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <input
                  type="range"
                  min="1"
                  max="15"
                  step="0.5"
                  value={zoomLevel}
                  onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
                  className="w-16 accent-[#b20000] h-1 bg-[#333333] cursor-pointer"
                  title="Magnification Lever"
                />
                <button
                  type="button"
                  onClick={() => setZoomLevel(Math.min(15, zoomLevel + 1))}
                  disabled={zoomLevel >= 15}
                  className="text-[#aaaaaa] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer p-0.5"
                  title="Decode Waveform In"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
                <span className="text-white font-sans text-[10px] font-bold min-w-[28px] text-right pr-1">
                  {zoomLevel.toFixed(1)}x
                </span>
              </div>
            )}

            {(audioBuffer || fileUrl || isLiveGenerating) && (
              <ResetButton
                id="btn-waveform-reset"
                onClick={() => {
                  setZoomLevel(1);
                  handleSeek(0);
                }}
                title="Reset Zoom to 1.0x"
                className="h-8 w-8"
              />
            )}

            {/* 1. PopOut Button */}
            {onPopOut && (
              <PopOutButton
                id="btn-popout-waveform"
                onClick={onPopOut}
                title="Pop out waveform observer to a floating component window"
              />
            )}
          </div>
        </div>
      )}

      {!isMinimized && (
        <div className={`flex flex-col flex-grow ${isEmbeddedInDeck || isPoppedOut ? 'p-0' : 'p-4'}`} id="waveform-panel-content">
          {/* 2. Primary Waveform displays */}
          <div 
            className={`relative w-full overflow-hidden ${
              isEmbeddedInDeck ? 'min-h-[96px]' : 'min-h-[140px]'
            }`} 
            id="waveform-drawing-stage"
          >
            {/* State A: Loading/Decoding Audio File */}
            {isDecoding && (
              <div className="absolute inset-0 bg-[#0e0e0e]/95 flex flex-col items-center justify-center space-y-2 z-10 animate-fade-in border border-[#4a4a4a]">
                <RefreshCw className="w-4 h-4 text-[#b20000] animate-spin" />
                <div className="space-y-0.5 text-center">
                  <span className="text-[8px] font-sans uppercase font-bold text-white tracking-[1.4px]">
                    DECODING WAVEFORM...
                  </span>
                  <div className="w-32 bg-[#181818] h-1 overflow-hidden mt-0.5 mx-auto border border-[#4a4a4a]">
                    <div 
                      className="bg-[#b20000] h-full transition-all duration-300 ease-out"
                      style={{ width: `${decodeProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* State B: Errors decoding */}
            {decodeError && (
              <div className="absolute inset-0 bg-[#0e0e0e]/95 flex flex-col items-center justify-center p-3 text-center z-10 border border-[#4a4a4a]">
                <Activity className="w-4 h-4 text-[#b20000] mb-1" />
                <span className="text-[9px] font-sans font-bold text-[#b20000] uppercase tracking-[1px] max-w-sm">
                  {decodeError}
                </span>
              </div>
            )}

            {/* State C: Active Loaded Waveforms */}
            {(audioBuffer || fileUrl || isLiveGenerating || currentTime > 0) ? (
              <div className="flex flex-col gap-1 w-full">
                {/* Top Waveform: Large scrolling high precision detail view */}
                <div className={`relative w-full border border-[#4a4a4a] overflow-hidden bg-[#0e0e0e] ${isEmbeddedInDeck ? 'h-[72px]' : 'h-[100px]'}`}>
                  <canvas
                    ref={detailCanvasRef}
                    height={isEmbeddedInDeck ? 72 : 100}
                    width={1200}
                    onClick={handleDetailClick}
                    onMouseDown={(e) => {
                      isScrubbingRef.current = true;
                      activeScrubCanvasRef.current = 'detail';
                      seekFromClientX(e.clientX, 'detail');
                    }}
                    onTouchStart={(e) => {
                      if (e.touches[0]) {
                        isScrubbingRef.current = true;
                        activeScrubCanvasRef.current = 'detail';
                        seekFromClientX(e.touches[0].clientX, 'detail');
                      }
                    }}
                    className="w-full h-full cursor-ew-resize absolute inset-0 block hover:opacity-95 transition-opacity"
                    title="Click and drag/scrub on active zooming window scroll timeline"
                  />
                  <span className="absolute left-1.5 top-1 text-[8.5px] uppercase font-sans tracking-[1px] text-white bg-[#181818] px-1.5 py-0.5 pointer-events-none leading-none border border-[#4a4a4a] font-bold">
                    {zoomLevel > 1 
                      ? `ZOOMED (${zoomLevel}X) • DYN RES (${Math.floor((1200 / zoomLevel) * Math.min(8, Math.max(1, Math.round(Math.sqrt(zoomLevel) * 2))))} PTS)` 
                      : 'FULL VIEW (1200 PTS)'}
                  </span>
                </div>

                {/* Bottom Waveform: Compact unzoomed miniaturized Full-track navigator bar */}
                <div className={`relative w-full border border-[#4a4a4a] overflow-hidden bg-[#0e0e0e] ${isEmbeddedInDeck ? 'h-[20px]' : 'h-[28px]'}`}>
                  <canvas
                    ref={overviewCanvasRef}
                    height={isEmbeddedInDeck ? 20 : 28}
                    width={1200}
                    onClick={handleOverviewClick}
                    onMouseDown={(e) => {
                      isScrubbingRef.current = true;
                      activeScrubCanvasRef.current = 'overview';
                      seekFromClientX(e.clientX, 'overview');
                    }}
                    onTouchStart={(e) => {
                      if (e.touches[0]) {
                        isScrubbingRef.current = true;
                        activeScrubCanvasRef.current = 'overview';
                        seekFromClientX(e.touches[0].clientX, 'overview');
                      }
                    }}
                    className="w-full h-full cursor-ew-resize absolute inset-0 block hover:brightness-110 transition-all"
                    title="Click and drag anywhere to scrub timeline instantly"
                  />
                  {!isEmbeddedInDeck && (
                    <span className="absolute left-2.5 bottom-1 text-[8.5px] uppercase font-sans tracking-[1px] text-white/90 pointer-events-none font-bold">
                      FULL-TRACK OVERVIEW NAVIGATOR
                    </span>
                  )}
                </div>
              </div>
            ) : (
              /* State D: Placeholder, Waiting for track upload/select */
              <div className="w-full h-[140px] bg-[#0e0e0e] border border-[#4a4a4a] flex flex-col items-center justify-center p-8 text-center gap-2.5 relative select-none animate-fade-in">
                <div className="h-10 w-10 bg-[#181818] border border-[#4a4a4a] flex items-center justify-center text-[#b20000]">
                  <Waves className="w-5 h-5 text-[#b20000]" />
                </div>
                <h3 className="text-[10px] font-bold text-white font-sans tracking-[1.4px] uppercase">
                  NO WAVEFORM DATA ACTIVE
                </h3>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
