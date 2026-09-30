/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Comprehensive Audio BPM Tempo & Musical Key Analyzer with Camelot Wheel Mapping

export interface AudioAnalysisResult {
  bpm: number;
  firstBeatTime: number;
  musicalKey: string;
  camelot: string;
  scale: 'maj' | 'min';
  displayKey: string;
}

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Camelot Wheel Mapping: Minor = A, Major = B
const CAMELOT_MAP: Record<string, string> = {
  'G# min': '1A', 'Ab min': '1A', 'B maj': '1B',
  'D# min': '2A', 'Eb min': '2A', 'F# maj': '2B', 'Gb maj': '2B',
  'A# min': '3A', 'Bb min': '3A', 'C# maj': '3B', 'Db maj': '3B',
  'F min': '4A', 'G# maj': '4B', 'Ab maj': '4B',
  'C min': '5A', 'D# maj': '5B', 'Eb maj': '5B',
  'G min': '6A', 'A# maj': '6B', 'Bb maj': '6B',
  'D min': '7A', 'F maj': '7B',
  'A min': '8A', 'C maj': '8B',
  'E min': '9A', 'G maj': '9B',
  'B min': '10A', 'D maj': '10B',
  'F# min': '11A', 'Gb min': '11A', 'A maj': '11B',
  'C# min': '12A', 'Db min': '12A', 'E maj': '12B'
};

// Krumhansl-Schmuckler Key Profiles for Pitch Class Correlation
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Accurately analyzes the BPM (tempo) and first beat alignment from an AudioBuffer.
 * Uses envelope onset novelty extraction & autocorrelation with tempo prior weighting.
 */
export function detectBpmFromAudio(audioBuffer: AudioBuffer): { bpm: number; firstBeatTime: number } {
  try {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;

    // Downsample to 11025 Hz for efficient tempo autocorrelation
    const targetSampleRate = 11025;
    const step = Math.max(1, Math.floor(sampleRate / targetSampleRate));
    const effectiveRate = sampleRate / step;

    // Use up to 60 seconds of audio
    const maxSamples = Math.min(Math.floor(totalSamples / step), Math.floor(60 * effectiveRate));
    if (maxSamples < 1000) {
      return { bpm: 124.0, firstBeatTime: 0.12 };
    }

    const downsampled = new Float32Array(maxSamples);
    for (let i = 0; i < maxSamples; i++) {
      downsampled[i] = channelData[i * step];
    }

    // Energy envelope (hop size ~11.6ms)
    const hopSize = 128;
    const numFrames = Math.floor(maxSamples / hopSize);
    const envelope = new Float32Array(numFrames);

    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSize;
      const end = Math.min(maxSamples, start + hopSize);
      let sum = 0;
      for (let i = start; i < end; i++) {
        sum += Math.abs(downsampled[i]);
      }
      envelope[f] = sum / (end - start);
    }

    // Half-wave rectified onset novelty
    const novelty = new Float32Array(numFrames);
    for (let f = 1; f < numFrames; f++) {
      const diff = envelope[f] - envelope[f - 1];
      novelty[f] = diff > 0 ? diff : 0;
    }

    // Autocorrelation over range 75 - 180 BPM
    const fps = effectiveRate / hopSize;
    const minBpm = 75;
    const maxBpm = 180;
    const minLag = Math.floor((60 / maxBpm) * fps);
    const maxLag = Math.ceil((60 / minBpm) * fps);

    let bestLag = minLag;
    let maxScore = -1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < numFrames - lag; i++) {
        sum += novelty[i] * novelty[i + lag];
        count++;
      }
      const corr = count > 0 ? sum / count : 0;

      // Tempo prior weighting centered around 124 BPM
      const curBpm = (60 * fps) / lag;
      const dev = (curBpm - 124) / 40;
      const weight = Math.exp(-0.5 * dev * dev);
      const score = corr * (0.65 + 0.35 * weight);

      if (score > maxScore) {
        maxScore = score;
        bestLag = lag;
      }
    }

    const rawBpm = (60 * fps) / bestLag;
    const finalBpm = Math.round(rawBpm * 100) / 100;

    // Detect first downbeat offset
    let firstBeatTime = 0.12;
    let maxNovelty = 0;
    const searchLimit = Math.min(novelty.length, bestLag * 2);
    for (let i = 0; i < searchLimit; i++) {
      if (novelty[i] > maxNovelty) {
        maxNovelty = novelty[i];
        firstBeatTime = (i * hopSize) / effectiveRate;
      }
    }

    return {
      bpm: finalBpm >= 65 && finalBpm <= 200 ? finalBpm : 124.0,
      firstBeatTime: Math.max(0, Math.min(2.0, firstBeatTime))
    };
  } catch (err) {
    console.warn('Error in detectBpmFromAudio:', err);
    return { bpm: 124.0, firstBeatTime: 0.12 };
  }
}

/**
 * Detects the musical key and Camelot Wheel identifier from an AudioBuffer.
 * Analyzes pitch class profile (chroma vector) and correlates against Krumhansl-Schmuckler profiles.
 */
export function detectKeyFromAudio(audioBuffer: AudioBuffer): {
  musicalKey: string;
  camelot: string;
  scale: 'maj' | 'min';
  displayKey: string;
} {
  try {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;

    // 12-dimensional Chromagram vector (energy for C, C#, D, D#, E, F, F#, G, G#, A, A#, B)
    const chroma = new Float64Array(12);

    // Analyze across multiple octaves (C2=65.4Hz up to B5=987.7Hz)
    const octaves = [2, 3, 4, 5];
    const samplesToAnalyze = Math.min(totalSamples, Math.floor(sampleRate * 45)); // analyze first 45 seconds

    for (let note = 0; note < 12; note++) {
      let noteEnergy = 0;

      for (const oct of octaves) {
        const midi = 12 * (oct + 1) + note;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const omega = (2 * Math.PI * freq) / sampleRate;

        // Goertzel single-frequency filter evaluation
        const coeff = 2 * Math.cos(omega);
        let s_prev = 0;
        let s_prev2 = 0;

        // Sample in chunks to maintain performance
        const step = 4;
        for (let i = 0; i < samplesToAnalyze; i += step) {
          const sample = channelData[i];
          const s = sample + coeff * s_prev - s_prev2;
          s_prev2 = s_prev;
          s_prev = s;
        }

        const power = s_prev2 * s_prev2 + s_prev * s_prev - coeff * s_prev * s_prev2;
        noteEnergy += Math.max(0, power);
      }

      chroma[note] = noteEnergy;
    }

    // Normalize chroma vector
    const chromaMax = Math.max(...chroma);
    if (chromaMax > 0) {
      for (let i = 0; i < 12; i++) {
        chroma[i] /= chromaMax;
      }
    }

    // Correlate against 12 Major and 12 Minor keys
    let bestKey = 'A';
    let bestScale: 'maj' | 'min' = 'min';
    let bestCorrelation = -999;

    const pearsonCorr = (x: Float64Array, y: number[]): number => {
      const n = 12;
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
      for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
        sumXY += x[i] * y[i];
        sumX2 += x[i] * x[i];
        sumY2 += y[i] * y[i];
      }
      const num = n * sumXY - sumX * sumY;
      const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
      return den === 0 ? 0 : num / den;
    };

    // Test all 12 root notes
    for (let root = 0; root < 12; root++) {
      // Rotated chroma for root comparison
      const rotated = new Float64Array(12);
      for (let i = 0; i < 12; i++) {
        rotated[i] = chroma[(root + i) % 12];
      }

      const majorCorr = pearsonCorr(rotated, MAJOR_PROFILE);
      const minorCorr = pearsonCorr(rotated, MINOR_PROFILE);

      if (majorCorr > bestCorrelation) {
        bestCorrelation = majorCorr;
        bestKey = PITCH_NAMES[root];
        bestScale = 'maj';
      }
      if (minorCorr > bestCorrelation) {
        bestCorrelation = minorCorr;
        bestKey = PITCH_NAMES[root];
        bestScale = 'min';
      }
    }

    const keyName = bestScale === 'min' ? `${bestKey} min` : `${bestKey} maj`;
    const shortKey = bestScale === 'min' ? `${bestKey}m` : bestKey;
    const camelot = CAMELOT_MAP[keyName] || (bestScale === 'min' ? '8A' : '8B');

    return {
      musicalKey: shortKey,
      camelot,
      scale: bestScale,
      displayKey: `${shortKey} (${camelot})`
    };
  } catch (err) {
    console.warn('Error in detectKeyFromAudio:', err);
    return {
      musicalKey: 'Am',
      camelot: '8A',
      scale: 'min',
      displayKey: 'Am (8A)'
    };
  }
}
