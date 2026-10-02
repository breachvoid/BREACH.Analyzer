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

export interface TempoDiagnostics {
  trackDuration: number;
  inputSampleRate: number;
  decimationStep: number;
  effectiveSampleRate: number;
  analyzedSamples: number;
  signalRms: number;
  envelopeFrames: number;
  maxNovelty: number;
  meanNovelty: number;
  noveltyFluxGatePassed: boolean;
  minLag: number;
  maxLag: number;
  bestRawLag: number;
  bestRawScore: number;
  rawBpmBeforeOctaveCheck: number;
  halfLagPeak?: { lag: number; score: number };
  doubleLagPeak?: { lag: number; score: number };
  octaveDisambiguationAction: 'none' | 'doubled' | 'halved';
  refinedSubLag: number;
  rawCalculatedBpm: number;
  finalBpm: number;
  firstBeatTime: number;
  status: 'SUCCESS' | 'SHORT_CLIP' | 'SILENCE_GATED' | 'INSUFFICIENT_FRAMES' | 'FLAT_NOVELTY_FLUX' | 'WEAK_CORRELATION_PEAK' | 'OUT_OF_BPM_RANGE' | 'ERROR';
  reason?: string;
}

export interface KeyDiagnostics {
  trackDuration: number;
  inputSampleRate: number;
  decimationStep: number;
  effectiveSampleRate: number;
  analyzedSamples: number;
  signalRms: number;
  numBlocks: number;
  chromaVector: number[];
  chromaMean: number;
  chromaStdDev: number;
  relativeStdDev: number;
  spectralFlatnessGatePassed: boolean;
  bestKey: string;
  bestScale: 'maj' | 'min';
  scale: 'maj' | 'min';
  bestCorrelation: number;
  secondBestCorrelation: number;
  correlationMargin: number;
  confidenceGatePassed: boolean;
  musicalKey: string;
  camelot: string;
  status: 'SUCCESS' | 'SHORT_CLIP' | 'SILENCE_GATED' | 'INSUFFICIENT_BLOCKS' | 'FLAT_SPECTRAL_PROFILE' | 'LOW_CORRELATION' | 'AMBIGUOUS_HARMONY' | 'ERROR';
  reason?: string;
}

let lastTempoDiagnostics: TempoDiagnostics | null = null;
let lastKeyDiagnostics: KeyDiagnostics | null = null;

export function getLastTempoDiagnostics(): TempoDiagnostics | null {
  return lastTempoDiagnostics;
}

export function getLastKeyDiagnostics(): KeyDiagnostics | null {
  return lastKeyDiagnostics;
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
export function detectBpmFromAudio(audioBuffer: AudioBuffer): { bpm: number; firstBeatTime: number; diagnostics?: TempoDiagnostics } {
  const diag: TempoDiagnostics = {
    trackDuration: audioBuffer.duration || 0,
    inputSampleRate: audioBuffer.sampleRate,
    decimationStep: 1,
    effectiveSampleRate: audioBuffer.sampleRate,
    analyzedSamples: 0,
    signalRms: 0,
    envelopeFrames: 0,
    maxNovelty: 0,
    meanNovelty: 0,
    noveltyFluxGatePassed: false,
    minLag: 0,
    maxLag: 0,
    bestRawLag: 0,
    bestRawScore: 0,
    rawBpmBeforeOctaveCheck: 0,
    octaveDisambiguationAction: 'none',
    refinedSubLag: 0,
    rawCalculatedBpm: 0,
    finalBpm: 0,
    firstBeatTime: 0,
    status: 'ERROR'
  };

  const finish = (bpm: number, firstBeatTime: number, status: TempoDiagnostics['status'], reason?: string) => {
    diag.finalBpm = bpm;
    diag.firstBeatTime = firstBeatTime;
    diag.status = status;
    diag.reason = reason;
    lastTempoDiagnostics = diag;
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[AudioAnalysis:Tempo Lifecycle]', {
        status,
        finalBpm: bpm,
        firstBeatTime,
        reason,
        inputSampleRate: diag.inputSampleRate,
        effectiveSampleRate: diag.effectiveSampleRate,
        signalRms: diag.signalRms.toFixed(6),
        maxNovelty: diag.maxNovelty.toFixed(6),
        rawBpm: diag.rawCalculatedBpm,
        octaveAction: diag.octaveDisambiguationAction
      });
    }
    return { bpm, firstBeatTime, diagnostics: diag };
  };

  try {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;

    // Minimum 1.0 second required for meaningful tempo analysis
    if (totalSamples < sampleRate * 1.0) {
      return finish(0, 0, 'SHORT_CLIP', 'Input duration under 1.0 second threshold');
    }

    // Downsample to ~11025 Hz with anti-aliasing averaging
    const targetSampleRate = 11025;
    const step = Math.max(1, Math.round(sampleRate / targetSampleRate));
    const effectiveRate = sampleRate / step;
    diag.decimationStep = step;
    diag.effectiveSampleRate = effectiveRate;

    // Use up to 60 seconds of audio
    const maxSamples = Math.min(Math.floor(totalSamples / step), Math.floor(60 * effectiveRate));
    diag.analyzedSamples = maxSamples;
    if (maxSamples < 1000) {
      return finish(0, 0, 'SHORT_CLIP', 'Fewer than 1000 decimated samples available');
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
    diag.signalRms = signalRms;

    // Gating for silence or near-silence (< -70 dBFS)
    if (signalRms < 1e-4) {
      return finish(0, 0, 'SILENCE_GATED', `Signal RMS (${signalRms.toFixed(6)}) below silence gate (< 1e-4)`);
    }

    // Low-pass filter at 220 Hz to extract kick transients
    const lowCutoff = 220;
    const alpha = Math.min(1.0, (2 * Math.PI * lowCutoff) / effectiveRate);
    const bassSignal = new Float32Array(maxSamples);
    let lpState = 0;
    for (let i = 0; i < maxSamples; i++) {
      lpState += alpha * (downsampled[i] - lpState);
      bassSignal[i] = lpState;
    }

    // Energy envelope for both full signal and bass band (hop size ~11.6ms)
    const hopSize = 128;
    const numFrames = Math.floor(maxSamples / hopSize);
    diag.envelopeFrames = numFrames;
    if (numFrames < 50) {
      return finish(0, 0, 'INSUFFICIENT_FRAMES', `Fewer than 50 envelope frames (${numFrames})`);
    }

    const fullEnvelope = new Float32Array(numFrames);
    const bassEnvelope = new Float32Array(numFrames);

    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSize;
      const end = Math.min(maxSamples, start + hopSize);
      let sumFull = 0;
      let sumBass = 0;
      for (let i = start; i < end; i++) {
        sumFull += Math.abs(downsampled[i]);
        sumBass += Math.abs(bassSignal[i]);
      }
      fullEnvelope[f] = sumFull / (end - start);
      bassEnvelope[f] = sumBass / (end - start);
    }

    // Onset novelty flux: captures full-spectrum percussive transients with bass kick enhancement
    const novelty = new Float32Array(numFrames);
    let maxNovelty = 0;
    let sumNovelty = 0;

    for (let f = 1; f < numFrames; f++) {
      const diffFull = Math.max(0, fullEnvelope[f] - fullEnvelope[f - 1]);
      const diffBass = Math.max(0, bassEnvelope[f] - bassEnvelope[f - 1]);
      const val = diffFull + 0.6 * diffBass;
      novelty[f] = val;
      if (val > maxNovelty) maxNovelty = val;
      sumNovelty += val;
    }
    diag.maxNovelty = maxNovelty;
    const meanNovelty = sumNovelty / numFrames;
    diag.meanNovelty = meanNovelty;

    // If novelty flux is flat or lacks dynamic transient contrast (drone, sustained tone, or ambient noise)
    const relativeNovelty = maxNovelty / (signalRms + 1e-6);
    if (maxNovelty < 1e-4 || meanNovelty < 1e-5 || relativeNovelty < 0.06) {
      return finish(0, 0, 'FLAT_NOVELTY_FLUX', `Novelty flux flat (max: ${maxNovelty.toFixed(6)}, rel: ${relativeNovelty.toFixed(4)})`);
    }

    // Require at least 3 distinct recurring onset pulses (prevents isolated clicks or single-spike drones)
    const peakThreshold = maxNovelty * 0.25;
    let onsetCount = 0;
    for (let f = 1; f < numFrames - 1; f++) {
      if (novelty[f] > peakThreshold && novelty[f] > novelty[f - 1] && novelty[f] >= novelty[f + 1]) {
        onsetCount++;
      }
    }
    if (onsetCount < 3) {
      return finish(0, 0, 'FLAT_NOVELTY_FLUX', `Insufficient recurring onset pulses (${onsetCount} < 3) to establish tempo`);
    }

    // Mean-subtracted novelty flux for scale-invariant normalized autocorrelation
    let noveltyVariance = 0;
    const centeredNovelty = new Float32Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      const diff = novelty[f] - meanNovelty;
      centeredNovelty[f] = diff;
      noveltyVariance += diff * diff;
    }
    noveltyVariance /= numFrames;

    if (noveltyVariance < 1e-9) {
      return finish(0, 0, 'FLAT_NOVELTY_FLUX', `Novelty variance (${noveltyVariance.toExponential(4)}) below dynamic rhythmic threshold`);
    }
    diag.noveltyFluxGatePassed = true;

    // Autocorrelation over range 60 - 200 BPM
    const fps = effectiveRate / hopSize;
    const minBpm = 60;
    const maxBpm = 200;
    const minLag = Math.max(1, Math.floor((60 / maxBpm) * fps));
    const maxLag = Math.min(numFrames - 2, Math.ceil((60 / minBpm) * fps));
    diag.minLag = minLag;
    diag.maxLag = maxLag;

    // Normalized autocorrelation across tempo candidate lags
    const corrScores = new Float32Array(maxLag + 1);
    let bestLag = minLag;
    let maxScore = -1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < numFrames - lag; i++) {
        sum += centeredNovelty[i] * centeredNovelty[i + lag];
        count++;
      }
      const rawCorr = count > 0 ? (sum / count) / noveltyVariance : 0;
      corrScores[lag] = rawCorr;

      if (rawCorr > maxScore) {
        maxScore = rawCorr;
        bestLag = lag;
      }
    }

    diag.bestRawLag = bestLag;
    diag.bestRawScore = maxScore;
    diag.rawBpmBeforeOctaveCheck = Math.round(((60 * fps) / bestLag) * 100) / 100;

    // Dimensionless scale-invariant threshold:
    // Periodic beats in music produce normalized correlation >= 0.12. White noise produces < 0.09.
    if (maxScore < 0.12) {
      return finish(0, 0, 'WEAK_CORRELATION_PEAK', `Normalized correlation peak (${maxScore.toFixed(4)}) below minimum rhythmic threshold 0.12`);
    }

    // Octave disambiguation: check half-tempo and double-tempo harmonics with local neighborhood search
    const findLocalPeak = (scores: Float32Array, targetLag: number) => {
      let best = targetLag;
      let max = -1;
      for (let l = targetLag - 1; l <= targetLag + 1; l++) {
        if (l >= minLag && l <= maxLag && scores[l] > max) {
          max = scores[l];
          best = l;
        }
      }
      return { lag: best, score: max };
    };

    let finalLag = bestLag;
    const halfTarget = Math.round(bestLag / 2);
    const halfPeak = findLocalPeak(corrScores, halfTarget);
    diag.halfLagPeak = halfPeak;

    if (halfPeak.lag >= minLag && halfPeak.score > maxScore * 0.60) {
      // Half lag corresponds to double tempo. Favor standard dance range (85 - 175 BPM).
      const currentBpm = (60 * fps) / bestLag;
      const doubleBpm = (60 * fps) / halfPeak.lag;
      if (currentBpm < 85 && doubleBpm <= 175) {
        finalLag = halfPeak.lag;
        diag.octaveDisambiguationAction = 'doubled';
      }
    } else {
      const doubleTarget = bestLag * 2;
      const doublePeak = findLocalPeak(corrScores, doubleTarget);
      diag.doubleLagPeak = doublePeak;
      if (doublePeak.lag <= maxLag && doublePeak.score > maxScore * 0.65) {
        // Double lag corresponds to half tempo.
        const currentBpm = (60 * fps) / bestLag;
        const halfBpm = (60 * fps) / doublePeak.lag;
        if (currentBpm > 165 && halfBpm >= 75) {
          finalLag = doublePeak.lag;
          diag.octaveDisambiguationAction = 'halved';
        }
      }
    }

    // Parabolic sub-lag interpolation around best lag for sub-sample accuracy
    let refinedLag = finalLag;
    if (finalLag > minLag && finalLag < maxLag) {
      const y0 = corrScores[finalLag - 1];
      const y1 = corrScores[finalLag];
      const y2 = corrScores[finalLag + 1];
      const denom = y0 - 2 * y1 + y2;
      if (Math.abs(denom) > 1e-12) {
        const delta = (y0 - y2) / (2 * denom);
        if (Math.abs(delta) < 1) {
          refinedLag = finalLag + delta;
        }
      }
    }
    diag.refinedSubLag = refinedLag;

    const rawBpm = (60 * fps) / refinedLag;
    diag.rawCalculatedBpm = Math.round(rawBpm * 100) / 100;
    const finalBpm = Math.round(rawBpm * 100) / 100;

    // Rekordbox Beatgrid Downbeat Alignment:
    // Finds the first prominent kick drum / downbeat onset phase that aligns with the beat period
    let firstBeatTime = 0.0;
    let peakNovelty = 0;
    const searchLimit = Math.min(novelty.length, Math.ceil(refinedLag * 2));
    for (let i = 0; i < searchLimit; i++) {
      if (novelty[i] > peakNovelty) {
        peakNovelty = novelty[i];
        firstBeatTime = (i * hopSize) / effectiveRate;
      }
    }
    const cleanFirstBeat = Math.max(0, Math.min(2.0, firstBeatTime));

    if (finalBpm < 50 || finalBpm > 220) {
      return finish(0, cleanFirstBeat, 'OUT_OF_BPM_RANGE', `Calculated BPM (${finalBpm}) outside valid window 50-220`);
    }

    return finish(finalBpm, cleanFirstBeat, 'SUCCESS', 'BPM detected successfully');
  } catch (err) {
    console.warn('Error in detectBpmFromAudio:', err);
    return finish(0, 0, 'ERROR', String(err));
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
  diagnostics?: KeyDiagnostics;
} {
  const diag: KeyDiagnostics = {
    trackDuration: audioBuffer.duration || 0,
    inputSampleRate: audioBuffer.sampleRate,
    decimationStep: 1,
    effectiveSampleRate: audioBuffer.sampleRate,
    analyzedSamples: 0,
    signalRms: 0,
    numBlocks: 0,
    chromaVector: [],
    chromaMean: 0,
    chromaStdDev: 0,
    relativeStdDev: 0,
    spectralFlatnessGatePassed: false,
    bestKey: 'Unknown',
    bestScale: 'min',
    scale: 'min',
    bestCorrelation: -1,
    secondBestCorrelation: -1,
    correlationMargin: 0,
    confidenceGatePassed: false,
    musicalKey: 'Unknown',
    camelot: '—',
    status: 'ERROR'
  };

  const finish = (
    musicalKey: string,
    camelot: string,
    scale: 'maj' | 'min',
    displayKey: string,
    status: KeyDiagnostics['status'],
    reason?: string
  ) => {
    diag.musicalKey = musicalKey;
    diag.camelot = camelot;
    diag.scale = scale;
    diag.status = status;
    diag.reason = reason;
    lastKeyDiagnostics = diag;
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[AudioAnalysis:Key Lifecycle]', {
        status,
        musicalKey,
        camelot,
        reason,
        inputSampleRate: diag.inputSampleRate,
        effectiveSampleRate: diag.effectiveSampleRate,
        signalRms: diag.signalRms.toFixed(6),
        relativeStdDev: diag.relativeStdDev.toFixed(4),
        bestCorrelation: diag.bestCorrelation.toFixed(4),
        margin: diag.correlationMargin.toFixed(4)
      });
    }
    return { musicalKey, camelot, scale, displayKey, diagnostics: diag };
  };

  const UNKNOWN_RESULT = (status: KeyDiagnostics['status'], reason: string) =>
    finish('Unknown', '—', 'min', 'Unknown', status, reason);

  try {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;

    // Minimum 0.5s duration needed
    if (totalSamples < sampleRate * 0.5) {
      return UNKNOWN_RESULT('SHORT_CLIP', 'Input duration under 0.5 second threshold');
    }

    // Downsample to ~11025 Hz with anti-aliasing boxcar averaging
    // Notes C2 (65.4 Hz) to B5 (987.7 Hz) are well below the 5512.5 Hz Nyquist limit.
    const targetRate = 11025;
    const step = Math.max(1, Math.round(sampleRate / targetRate));
    const effectiveRate = sampleRate / step;
    diag.decimationStep = step;
    diag.effectiveSampleRate = effectiveRate;

    const samplesToAnalyze = Math.min(
      Math.floor(totalSamples / step),
      Math.floor(effectiveRate * 40) // Analyze up to 40 seconds
    );
    diag.analyzedSamples = samplesToAnalyze;

    const blockSize = 2048;
    const numBlocks = Math.floor(samplesToAnalyze / blockSize);
    diag.numBlocks = numBlocks;
    if (numBlocks < 2) {
      return UNKNOWN_RESULT('INSUFFICIENT_BLOCKS', `Fewer than 2 blocks of 2048 samples (${numBlocks})`);
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
    diag.signalRms = totalRms;

    // Gating for silence or near-silence (< -70 dBFS)
    if (totalRms < 1e-4) {
      return UNKNOWN_RESULT('SILENCE_GATED', `RMS level (${totalRms.toFixed(6)}) below silence gate (< 1e-4)`);
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
      return UNKNOWN_RESULT('SILENCE_GATED', 'Zero chroma energy accumulated');
    }

    const chromaMean = chromaSum / 12;
    let chromaVar = 0;
    for (let i = 0; i < 12; i++) {
      const diff = chroma[i] - chromaMean;
      chromaVar += diff * diff;
    }
    const chromaStdDev = Math.sqrt(chromaVar / 12);
    const relativeStdDev = chromaStdDev / chromaMean;
    diag.chromaMean = chromaMean;
    diag.chromaStdDev = chromaStdDev;
    diag.relativeStdDev = relativeStdDev;

    // In white/pink noise or broadband percussion, energy across note bins is flat (relativeStdDev < 0.30)
    if (relativeStdDev < 0.30) {
      return UNKNOWN_RESULT('FLAT_SPECTRAL_PROFILE', `Chroma profile too flat (relativeStdDev: ${relativeStdDev.toFixed(4)} < 0.30), indicating noise or percussion`);
    }
    diag.spectralFlatnessGatePassed = true;

    // Normalize chroma vector
    const chromaMax = Math.max(...chroma);
    if (chromaMax > 0) {
      for (let i = 0; i < 12; i++) {
        chroma[i] /= chromaMax;
      }
    }
    diag.chromaVector = Array.from(chroma);

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

    diag.bestKey = bestKey;
    diag.bestScale = bestScale;
    diag.bestCorrelation = bestCorrelation;
    diag.secondBestCorrelation = secondBestCorrelation;
    diag.correlationMargin = bestCorrelation - secondBestCorrelation;

    // Strict confidence gating:
    // 1. Minimum correlation threshold: must be >= 0.50
    if (bestCorrelation < 0.50) {
      return UNKNOWN_RESULT('LOW_CORRELATION', `Best correlation (${bestCorrelation.toFixed(4)}) below minimum threshold 0.50`);
    }

    // 2. Margin over second-best: must be >= 0.03 to avoid ambiguous harmony
    if ((bestCorrelation - secondBestCorrelation) < 0.03 || !bestKey) {
      return UNKNOWN_RESULT('AMBIGUOUS_HARMONY', `Correlation margin (${(bestCorrelation - secondBestCorrelation).toFixed(4)}) below 0.03 ambiguity threshold`);
    }
    diag.confidenceGatePassed = true;

    const keyName = bestScale === 'min' ? `${bestKey} min` : `${bestKey} maj`;
    const shortKey = bestScale === 'min' ? `${bestKey}m` : bestKey;
    const camelot = CAMELOT_MAP[keyName];

    if (!camelot) {
      return UNKNOWN_RESULT('ERROR', `Missing Camelot mapping for key "${keyName}"`);
    }

    return finish(shortKey, camelot, bestScale, `${shortKey} (${camelot})`, 'SUCCESS', 'Key detected successfully');
  } catch (err) {
    console.warn('Error in detectKeyFromAudio:', err);
    return finish('Unknown', '—', 'min', 'Unknown', 'ERROR', String(err));
  }
}

