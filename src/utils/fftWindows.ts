/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FFTWindowFunction } from '../types';

export interface WindowInfo {
  id: FFTWindowFunction;
  name: string;
  sidelobeLevel: string;
  bandwidth: string;
  description: string;
}

export const WINDOW_FUNCTIONS_INFO: Record<FFTWindowFunction, WindowInfo> = {
  [FFTWindowFunction.BLACKMAN_HARRIS]: {
    id: FFTWindowFunction.BLACKMAN_HARRIS,
    name: 'Blackman-Harris (4-Term)',
    sidelobeLevel: '-92 dB',
    bandwidth: '2.0 bins',
    description: 'Ultra-low sidelobe leakage (-92 dB). Ideal for mastering, detecting faint harmonics next to loud sub-bass, and wide dynamic range audio.'
  },
  [FFTWindowFunction.HANN]: {
    id: FFTWindowFunction.HANN,
    name: 'Hann (Hanning)',
    sidelobeLevel: '-31.5 dB',
    bandwidth: '1.5 bins',
    description: 'Balanced general-purpose window with good frequency separation and fast 18 dB/octave sidelobe rolloff. Best for mixed music and vocals.'
  },
  [FFTWindowFunction.HAMMING]: {
    id: FFTWindowFunction.HAMMING,
    name: 'Hamming',
    sidelobeLevel: '-42.7 dB',
    bandwidth: '1.36 bins',
    description: 'Cancels the first sidelobe for sharper spectral peak resolution. Ideal for separating closely spaced harmonic instruments.'
  },
  [FFTWindowFunction.BLACKMAN]: {
    id: FFTWindowFunction.BLACKMAN,
    name: 'Blackman (Standard)',
    sidelobeLevel: '-58 dB',
    bandwidth: '1.7 bins',
    description: 'Classical 3-term window offering -58 dB stopband attenuation. Good intermediate compromise between Hann and Blackman-Harris.'
  },
  [FFTWindowFunction.FLAT_TOP]: {
    id: FFTWindowFunction.FLAT_TOP,
    name: 'Flat Top',
    sidelobeLevel: '-93 dB',
    bandwidth: '3.7 bins',
    description: 'Provides exact 0.01 dB amplitude measurement accuracy across bin boundaries. Best for calibration, level metering, and acoustic testing.'
  },
  [FFTWindowFunction.RECTANGULAR]: {
    id: FFTWindowFunction.RECTANGULAR,
    name: 'Rectangular (Uniform)',
    sidelobeLevel: '-13.3 dB',
    bandwidth: '1.0 bin',
    description: 'No time-domain tapering (w[n]=1). Offers the narrowest possible mainlobe for pure tone pitch detection, but exhibits high spectral leakage.'
  }
};

// Window cache for precomputed tables
const windowCache = new Map<string, { table: Float32Array; coherentGain: number }>();

/**
 * Computes or retrieves precomputed window weights and coherent gain for size N
 */
export function getWindowTable(type: FFTWindowFunction, size: number): { table: Float32Array; coherentGain: number } {
  const key = `${type}_${size}`;
  const cached = windowCache.get(key);
  if (cached) return cached;

  const table = new Float32Array(size);
  let gainSum = 0;
  const twoPi = 2 * Math.PI;

  for (let n = 0; n < size; n++) {
    const ratio = n / size;
    let w = 1.0;

    switch (type) {
      case FFTWindowFunction.HANN:
        // 0.5 - 0.5 * cos(2*pi*n/N)
        w = 0.5 - 0.5 * Math.cos(twoPi * ratio);
        break;

      case FFTWindowFunction.HAMMING:
        // 0.54 - 0.46 * cos(2*pi*n/N)
        w = 0.54 - 0.46 * Math.cos(twoPi * ratio);
        break;

      case FFTWindowFunction.BLACKMAN:
        // 0.42 - 0.5 * cos(2*pi*n/N) + 0.08 * cos(4*pi*n/N)
        w = 0.42 - 0.5 * Math.cos(twoPi * ratio) + 0.08 * Math.cos(2 * twoPi * ratio);
        break;

      case FFTWindowFunction.BLACKMAN_HARRIS:
        // 4-Term Blackman-Harris
        w = 0.35875 
          - 0.48829 * Math.cos(twoPi * ratio) 
          + 0.14128 * Math.cos(2 * twoPi * ratio) 
          - 0.01168 * Math.cos(3 * twoPi * ratio);
        break;

      case FFTWindowFunction.FLAT_TOP:
        // Flat-top window for amplitude accuracy
        w = 0.21557895 
          - 0.41663158 * Math.cos(twoPi * ratio) 
          + 0.277263158 * Math.cos(2 * twoPi * ratio) 
          - 0.083578947 * Math.cos(3 * twoPi * ratio) 
          + 0.006947368 * Math.cos(4 * twoPi * ratio);
        break;

      case FFTWindowFunction.RECTANGULAR:
      default:
        w = 1.0;
        break;
    }

    table[n] = w;
    gainSum += w;
  }

  const coherentGain = gainSum / size || 1.0;
  const result = { table, coherentGain };
  windowCache.set(key, result);
  return result;
}

// Precomputed twiddle factor and bit reversal cache
interface FFTPlan {
  size: number;
  cosTable: Float32Array;
  sinTable: Float32Array;
  bitRev: Uint32Array;
}

const planCache = new Map<number, FFTPlan>();

function getFFTPlan(size: number): FFTPlan {
  const cached = planCache.get(size);
  if (cached) return cached;

  const halfSize = size / 2;
  const cosTable = new Float32Array(halfSize);
  const sinTable = new Float32Array(halfSize);

  for (let i = 0; i < halfSize; i++) {
    const angle = (-2 * Math.PI * i) / size;
    cosTable[i] = Math.cos(angle);
    sinTable[i] = Math.sin(angle);
  }

  // Bit-reversal table
  const bitRev = new Uint32Array(size);
  const levels = Math.log2(size);
  for (let i = 0; i < size; i++) {
    let rev = 0;
    for (let j = 0; j < levels; j++) {
      rev = (rev << 1) | ((i >> j) & 1);
    }
    bitRev[i] = rev;
  }

  const plan: FFTPlan = { size, cosTable, sinTable, bitRev };
  planCache.set(size, plan);
  return plan;
}

/**
 * Computes custom windowed FFT on time-domain audio samples.
 * Returns decibel magnitude spectrum (size N/2) smoothed into outDbArray.
 */
export function computeWindowedFFT(
  timeSamples: Float32Array,
  windowType: FFTWindowFunction,
  outDbArray: Float32Array,
  smoothing: number = 0.8,
  minDecibels: number = -120,
  maxDecibels: number = 0
): void {
  const N = timeSamples.length;
  // Ensure power of 2
  if ((N & (N - 1)) !== 0 || N < 64) {
    return;
  }

  const { table: winTable, coherentGain } = getWindowTable(windowType, N);
  const plan = getFFTPlan(N);

  // Real and Imag arrays
  const real = new Float32Array(N);
  const imag = new Float32Array(N);

  // Apply window & bit-reversal permutation
  for (let i = 0; i < N; i++) {
    const revIdx = plan.bitRev[i];
    real[revIdx] = timeSamples[i] * winTable[i];
    imag[revIdx] = 0;
  }

  // Cooley-Tukey Radix-2 decimation-in-time
  for (let halfSize = 1; halfSize < N; halfSize *= 2) {
    const step = halfSize * 2;
    const tableStep = N / step;

    for (let i = 0; i < N; i += step) {
      for (let j = 0; j < halfSize; j++) {
        const tableIdx = j * tableStep;
        const cos = plan.cosTable[tableIdx];
        const sin = plan.sinTable[tableIdx];

        const matchIdx = i + j + halfSize;
        const targetIdx = i + j;

        const tr = real[matchIdx] * cos - imag[matchIdx] * sin;
        const ti = real[matchIdx] * sin + imag[matchIdx] * cos;

        real[matchIdx] = real[targetIdx] - tr;
        imag[matchIdx] = imag[targetIdx] - ti;

        real[targetIdx] += tr;
        imag[targetIdx] += ti;
      }
    }
  }

  // Calculate dBFS magnitudes for the positive half-spectrum [0 .. N/2]
  const numBins = Math.min(outDbArray.length, N / 2);
  const normFactor = 2.0 / (N * coherentGain); // Factor of 2 accounts for single-sided spectrum

  const smoothAlpha = Math.max(0, Math.min(0.99, smoothing));
  const oneMinusAlpha = 1.0 - smoothAlpha;

  for (let i = 0; i < numBins; i++) {
    const r = real[i];
    const im = imag[i];
    const mag = Math.sqrt(r * r + im * im) * normFactor;

    // Convert to dBFS
    let db = mag > 1e-6 ? 20 * Math.log10(mag) : minDecibels;
    if (db < minDecibels) db = minDecibels;
    if (db > maxDecibels + 6) db = maxDecibels + 6;

    // Exponential smoothing
    const prev = outDbArray[i];
    if (prev <= minDecibels || isNaN(prev)) {
      outDbArray[i] = db;
    } else {
      outDbArray[i] = prev * smoothAlpha + db * oneMinusAlpha;
    }
  }
}
