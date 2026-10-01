/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Accurate Audio BPM Tempo & Musical Key Analyzer with Camelot Wheel Mapping

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
 * Analyzes the BPM (tempo) and first beat alignment from an AudioBuffer.
 * Uses envelope onset novelty extraction & autocorrelation with octave disambiguation.
 * Returns bpm: 0 when evidence is insufficient (silence, non-rhythmic material, or short clips).
 */
export function detectBpmFromAudio(audioBuffer: AudioBuffer): { bpm: number; firstBeatTime: number } {
  try {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;

    // Minimum 1.0 second required for meaningful tempo analysis
    if (totalSamples < sampleRate * 1.0) {
      return { bpm: 0, firstBeatTime: 0 };
    }

    // Downsample to ~11025 Hz with anti-aliasing averaging
    const targetSampleRate = 11025;
    const step = Math.max(1, Math.round(sampleRate / targetSampleRate));
    const effectiveRate = sampleRate / step;

    // Use up to 60 seconds of audio
    const maxSamples = Math.min(Math.floor(totalSamples / step), Math.floor(60 * effectiveRate));
    if (maxSamples < 1000) {
      return { bpm: 0, firstBeatTime: 0 };
    }

    // Decimate with block averaging (boxcar anti-aliasing)
    const downsampled = new Float32Array(maxSamples);
    let signalRms = 0;
    for (let i = 0; i < maxSamples; i++) {
      let sum = 0;
      const base = i * step;
      const end = Math.min(totalSamples, base + step);
      for (let j = base; j < end; j++) {
        sum += channelData[j];
      }
      const val = sum / (end - base);
      downsampled[i] = val;
      signalRms += val * val;
    }
    signalRms = Math.sqrt(signalRms / maxSamples);

    // Gating for silence or near-silence (< -70 dBFS)
    if (signalRms < 1e-4) {
      return { bpm: 0, firstBeatTime: 0 };
    }

    // Energy envelope (hop size ~11.6ms)
    const hopSize = 128;
    const numFrames = Math.floor(maxSamples / hopSize);
    if (numFrames < 50) {
      return { bpm: 0, firstBeatTime: 0 };
    }

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
    let maxNovelty = 0;
    let sumNovelty = 0;
    for (let f = 1; f < numFrames; f++) {
      const diff = envelope[f] - envelope[f - 1];
      const val = diff > 0 ? diff : 0;
      novelty[f] = val;
      if (val > maxNovelty) maxNovelty = val;
      sumNovelty += val;
    }

    // If novelty flux is flat (drone, sustained tone, or ambient noise with no rhythmic onsets)
    if (maxNovelty < 1e-4 || (sumNovelty / numFrames) < 1e-5) {
      return { bpm: 0, firstBeatTime: 0 };
    }

    // Autocorrelation over range 60 - 200 BPM using zero-mean novelty for maximum peak contrast
    const fps = effectiveRate / hopSize;
    const minBpm = 60;
    const maxBpm = 200;
    const minLag = Math.max(1, Math.floor((60 / maxBpm) * fps));
    const maxLag = Math.min(numFrames - 2, Math.ceil((60 / minBpm) * fps));

    const meanNovelty = sumNovelty / numFrames;
    const normNovelty = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      normNovelty[i] = novelty[i] - meanNovelty;
    }

    const corrScores = new Float32Array(maxLag + 1);
    let bestLag = minLag;
    let maxScore = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < numFrames - lag; i++) {
        sum += normNovelty[i] * normNovelty[i + lag];
        count++;
      }
      const rawCorr = count > 0 ? sum / count : 0;
      corrScores[lag] = rawCorr;

      if (rawCorr > maxScore) {
        maxScore = rawCorr;
        bestLag = lag;
      }
    }

    // If correlation peak is too weak or negative, evidence is insufficient
    if (maxScore <= 0 || maxScore < (sumNovelty / numFrames) * 0.05) {
      return { bpm: 0, firstBeatTime: 0 };
    }

    // Octave disambiguation: check if half-lag (fundamental pulse) has a strong peak
    const findLocalPeak = (scores: Float32Array, targetLag: number) => {
      let best = targetLag;
      let max = -Infinity;
      for (let l = targetLag - 2; l <= targetLag + 2; l++) {
        if (l >= minLag && l <= maxLag && scores[l] > max) {
          max = scores[l];
          best = l;
        }
      }
      return { lag: best, score: max };
    };

    let finalLag = bestLag;
    const halfTarget = Math.round(bestLag / 2);
    if (halfTarget >= minLag) {
      const halfPeak = findLocalPeak(corrScores, halfTarget);
      // If half-lag peak has >= 75% of max correlation, the true beat pulse is the faster fundamental
      if (halfPeak.score >= maxScore * 0.75) {
        finalLag = halfPeak.lag;
      }
    }

    // Parabolic sub-lag interpolation for fine sub-frame precision
    let refinedLag = finalLag;
    if (finalLag > minLag && finalLag < maxLag) {
      const y0 = corrScores[finalLag - 1];
      const y1 = corrScores[finalLag];
      const y2 = corrScores[finalLag + 1];
      const denom = y0 - 2 * y1 + y2;
      if (denom < 0 && Math.abs(denom) > 1e-12) {
        const delta = (y0 - y2) / (2 * denom);
        if (Math.abs(delta) < 1) {
          refinedLag = finalLag + delta;
        }
      }
    }

    const rawBpm = (60 * fps) / refinedLag;
    const finalBpm = Math.round(rawBpm * 100) / 100;

    // Detect first downbeat offset from onset peaks
    let firstBeatTime = 0.0;
    let peakNovelty = 0;
    const searchLimit = Math.min(novelty.length, Math.ceil(finalLag * 2));
    for (let i = 0; i < searchLimit; i++) {
      if (novelty[i] > peakNovelty) {
        peakNovelty = novelty[i];
        firstBeatTime = (i * hopSize) / effectiveRate;
      }
    }

    return {
      bpm: finalBpm >= 50 && finalBpm <= 220 ? finalBpm : 0,
      firstBeatTime: Math.max(0, Math.min(2.0, firstBeatTime))
    };
  } catch (err) {
    console.warn('Error in detectBpmFromAudio:', err);
    return { bpm: 0, firstBeatTime: 0 };
  }
}

/**
 * Detects the musical key and Camelot Wheel identifier from an AudioBuffer.
 * Analyzes pitch class profile (chroma vector) using block-windowed Goertzel resonators (Hann window)
 * across multiple octaves, and correlates against Krumhansl-Schmuckler profiles.
 * Returns "Unknown" with "—" Camelot when evidence is insufficient (silence, noise, percussion, or ambiguous harmony).
 */
export function detectKeyFromAudio(audioBuffer: AudioBuffer): {
  musicalKey: string;
  camelot: string;
  scale: 'maj' | 'min';
  displayKey: string;
} {
  const UNKNOWN_RESULT = {
    musicalKey: 'Unknown',
    camelot: '—',
    scale: 'min' as const,
    displayKey: 'Unknown'
  };

  try {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;

    // Minimum 0.5s duration needed
    if (totalSamples < sampleRate * 0.5) {
      return UNKNOWN_RESULT;
    }

    // Downsample to ~11025 Hz with anti-aliasing boxcar averaging
    // Notes C2 (65.4 Hz) to B5 (987.7 Hz) are well below the 5512.5 Hz Nyquist limit.
    const targetRate = 11025;
    const step = Math.max(1, Math.round(sampleRate / targetRate));
    const effectiveRate = sampleRate / step;

    const samplesToAnalyze = Math.min(
      Math.floor(totalSamples / step),
      Math.floor(effectiveRate * 40) // Analyze up to 40 seconds
    );

    const blockSize = 2048;
    const numBlocks = Math.floor(samplesToAnalyze / blockSize);
    if (numBlocks < 2) {
      return UNKNOWN_RESULT;
    }

    // Decimate to effectiveRate
    const decimated = new Float32Array(samplesToAnalyze);
    let totalRms = 0;
    for (let i = 0; i < samplesToAnalyze; i++) {
      let sum = 0;
      const base = i * step;
      const end = Math.min(totalSamples, base + step);
      for (let j = base; j < end; j++) {
        sum += channelData[j];
      }
      const val = sum / (end - base);
      decimated[i] = val;
      totalRms += val * val;
    }
    totalRms = Math.sqrt(totalRms / samplesToAnalyze);

    // Gating for silence or near-silence (< -70 dBFS)
    if (totalRms < 1e-4) {
      return UNKNOWN_RESULT;
    }

    // Precompute Hann window
    const hann = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (blockSize - 1)));
    }

    // 12-dimensional Chromagram vector
    const chroma = new Float64Array(12);
    const octaves = [2, 3, 4, 5];

    // Compute coefficients for each note across octaves
    // omega MUST use effectiveRate of the decimated buffer!
    const noteCoeffs: { note: number; coeff: number }[] = [];
    for (let note = 0; note < 12; note++) {
      for (const oct of octaves) {
        const midi = 12 * (oct + 1) + note;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const omega = (2 * Math.PI * freq) / effectiveRate;
        noteCoeffs.push({ note, coeff: 2 * Math.cos(omega) });
      }
    }

    // Analyze across blocks with Hann window to average spectral variance
    for (let b = 0; b < numBlocks; b++) {
      const blockOffset = b * blockSize;

      for (let c = 0; c < noteCoeffs.length; c++) {
        const { note, coeff } = noteCoeffs[c];
        let s_prev = 0;
        let s_prev2 = 0;

        for (let i = 0; i < blockSize; i++) {
          const sample = decimated[blockOffset + i] * hann[i];
          const s = sample + coeff * s_prev - s_prev2;
          s_prev2 = s_prev;
          s_prev = s;
        }

        const power = s_prev2 * s_prev2 + s_prev * s_prev - coeff * s_prev * s_prev2;
        chroma[note] += Math.max(0, power);
      }
    }

    // Calculate chroma vector statistics
    let chromaSum = 0;
    for (let i = 0; i < 12; i++) chromaSum += chroma[i];
    if (chromaSum <= 0) {
      return UNKNOWN_RESULT;
    }

    const chromaMean = chromaSum / 12;
    let chromaVar = 0;
    for (let i = 0; i < 12; i++) {
      const diff = chroma[i] - chromaMean;
      chromaVar += diff * diff;
    }
    const chromaStdDev = Math.sqrt(chromaVar / 12);
    const relativeStdDev = chromaStdDev / chromaMean;

    // In white/pink noise or broadband percussion, energy across note bins is flat (relativeStdDev < 0.30)
    if (relativeStdDev < 0.30) {
      return UNKNOWN_RESULT;
    }

    // Normalize chroma vector
    const chromaMax = Math.max(...chroma);
    if (chromaMax > 0) {
      for (let i = 0; i < 12; i++) {
        chroma[i] /= chromaMax;
      }
    }

    // Pearson correlation function against key profiles
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

    let bestKey = '';
    let bestScale: 'maj' | 'min' = 'min';
    let bestCorrelation = -1;
    let secondBestCorrelation = -1;

    // Test all 12 root notes for Major and Minor profiles
    for (let root = 0; root < 12; root++) {
      const rotated = new Float64Array(12);
      for (let i = 0; i < 12; i++) {
        rotated[i] = chroma[(root + i) % 12];
      }

      const majorCorr = pearsonCorr(rotated, MAJOR_PROFILE);
      const minorCorr = pearsonCorr(rotated, MINOR_PROFILE);

      if (majorCorr > bestCorrelation) {
        secondBestCorrelation = bestCorrelation;
        bestCorrelation = majorCorr;
        bestKey = PITCH_NAMES[root];
        bestScale = 'maj';
      } else if (majorCorr > secondBestCorrelation) {
        secondBestCorrelation = majorCorr;
      }

      if (minorCorr > bestCorrelation) {
        secondBestCorrelation = bestCorrelation;
        bestCorrelation = minorCorr;
        bestKey = PITCH_NAMES[root];
        bestScale = 'min';
      } else if (minorCorr > secondBestCorrelation) {
        secondBestCorrelation = minorCorr;
      }
    }

    // Strict confidence gating:
    // 1. Minimum correlation threshold: must be >= 0.50
    // 2. Margin over second-best: must be >= 0.03 to avoid ambiguous harmony
    if (bestCorrelation < 0.50 || (bestCorrelation - secondBestCorrelation) < 0.03 || !bestKey) {
      return UNKNOWN_RESULT;
    }

    const keyName = bestScale === 'min' ? `${bestKey} min` : `${bestKey} maj`;
    const shortKey = bestScale === 'min' ? `${bestKey}m` : bestKey;
    const camelot = CAMELOT_MAP[keyName];

    if (!camelot) {
      return UNKNOWN_RESULT;
    }

    return {
      musicalKey: shortKey,
      camelot,
      scale: bestScale,
      displayKey: `${shortKey} (${camelot})`
    };
  } catch (err) {
    console.warn('Error in detectKeyFromAudio:', err);
    return UNKNOWN_RESULT;
  }
}

