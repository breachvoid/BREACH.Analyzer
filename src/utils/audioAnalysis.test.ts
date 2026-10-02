import { describe, it, expect } from 'vitest';
import {
  detectBpmFromAudio,
  detectKeyFromAudio,
  getLastTempoDiagnostics,
  getLastKeyDiagnostics
} from './audioAnalysis';

// Helper to create an AudioBuffer fixture with synthetic audio
function createAudioBuffer(sampleRate: number, durationSec: number, generator: (time: number, index: number) => number): AudioBuffer {
  const length = Math.floor(sampleRate * durationSec);
  const channelData = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    channelData[i] = generator(i / sampleRate, i);
  }

  return {
    sampleRate,
    length,
    duration: durationSec,
    numberOfChannels: 1,
    getChannelData: () => channelData,
    copyFromChannel: () => {},
    copyToChannel: () => {}
  } as unknown as AudioBuffer;
}

// Helper to synthesize a chord fixture
function createChordBuffer(sampleRate: number, durationSec: number, frequencies: number[]): AudioBuffer {
  return createAudioBuffer(sampleRate, durationSec, (t) => {
    let sum = 0;
    for (const f of frequencies) {
      sum += Math.sin(2 * Math.PI * f * t);
    }
    return (sum / frequencies.length) * 0.7;
  });
}

// Helper to synthesize a rhythmic click / beat train fixture
function createRhythmicBeatBuffer(sampleRate: number, durationSec: number, bpm: number): AudioBuffer {
  const beatInterval = 60 / bpm;
  return createAudioBuffer(sampleRate, durationSec, (t) => {
    const beatTime = t % beatInterval;
    if (beatTime < 0.05) {
      // 50ms transient burst with exponential decay
      const decay = Math.exp(-beatTime * 80);
      return Math.sin(2 * Math.PI * 150 * beatTime) * decay * 0.8;
    }
    return 0;
  });
}

describe('Musical Key Detection (Goertzel Algorithm & Chromagram)', () => {
  it('correctly detects C Major chord at 44.1 kHz, 48 kHz, and 96 kHz', () => {
    // C Major triad: C4 (261.63 Hz), E4 (329.63 Hz), G4 (392.00 Hz)
    const freqs = [261.63, 329.63, 392.00];

    for (const sr of [44100, 48000, 96000]) {
      const buffer = createChordBuffer(sr, 3.0, freqs);
      const res = detectKeyFromAudio(buffer);

      expect(res.musicalKey).toBe('C');
      expect(res.scale).toBe('maj');
      expect(res.camelot).toBe('8B');
      expect(res.diagnostics).toBeDefined();
      expect(res.diagnostics?.status).toBe('SUCCESS');
      expect(res.diagnostics?.confidenceGatePassed).toBe(true);
      expect(res.diagnostics?.inputSampleRate).toBe(sr);
      expect(res.diagnostics?.effectiveSampleRate).toBeGreaterThan(0);
    }
  });

  it('correctly detects A Minor chord at 44.1 kHz and 48 kHz', () => {
    // A Minor triad: A3 (220.00 Hz), C4 (261.63 Hz), E4 (329.63 Hz)
    const freqs = [220.00, 261.63, 329.63];

    for (const sr of [44100, 48000]) {
      const buffer = createChordBuffer(sr, 3.0, freqs);
      const res = detectKeyFromAudio(buffer);

      expect(res.musicalKey).toBe('Am');
      expect(res.scale).toBe('min');
      expect(res.camelot).toBe('8A');
      expect(res.diagnostics?.status).toBe('SUCCESS');
    }
  });

  it('correctly detects D Major chord (10B)', () => {
    // D Major triad: D4 (293.66 Hz), F#4 (369.99 Hz), A4 (440.00 Hz)
    const freqs = [293.66, 369.99, 440.00];
    const buffer = createChordBuffer(44100, 3.0, freqs);
    const res = detectKeyFromAudio(buffer);

    expect(res.musicalKey).toBe('D');
    expect(res.scale).toBe('maj');
    expect(res.camelot).toBe('10B');
  });

  it('correctly detects E Minor chord (9A)', () => {
    // E Minor triad: E3 (164.81 Hz), G3 (196.00 Hz), B3 (246.94 Hz)
    const freqs = [164.81, 196.00, 246.94];
    const buffer = createChordBuffer(48000, 3.0, freqs);
    const res = detectKeyFromAudio(buffer);

    expect(res.musicalKey).toBe('Em');
    expect(res.scale).toBe('min');
    expect(res.camelot).toBe('9A');
  });

  it('gates silence to Unknown and — Camelot without crashing or inventing a key', () => {
    const silentBuffer = createAudioBuffer(44100, 2.0, () => 0);
    const res = detectKeyFromAudio(silentBuffer);

    expect(res.musicalKey).toBe('Unknown');
    expect(res.camelot).toBe('—');
    expect(res.diagnostics?.status).toBe('SILENCE_GATED');
  });

  it('gates broadband white noise to Unknown via spectral flatness check', () => {
    // Uniform broadband white noise has flat distribution across note bins
    const noiseBuffer = createAudioBuffer(44100, 3.0, () => (Math.random() * 2 - 1) * 0.5);
    const res = detectKeyFromAudio(noiseBuffer);

    expect(res.musicalKey).toBe('Unknown');
    expect(res.camelot).toBe('—');
    expect(res.diagnostics?.status).toBe('FLAT_SPECTRAL_PROFILE');
  });

  it('rejects clips shorter than 0.5 seconds as SHORT_CLIP', () => {
    const shortBuffer = createAudioBuffer(44100, 0.3, () => Math.sin(2 * Math.PI * 440 * 0.1));
    const res = detectKeyFromAudio(shortBuffer);

    expect(res.musicalKey).toBe('Unknown');
    expect(res.camelot).toBe('—');
    expect(res.diagnostics?.status).toBe('SHORT_CLIP');
  });

  it('records diagnostic metrics in getLastKeyDiagnostics()', () => {
    const buffer = createChordBuffer(44100, 2.0, [261.63, 329.63, 392.00]);
    detectKeyFromAudio(buffer);

    const diag = getLastKeyDiagnostics();
    expect(diag).toBeDefined();
    expect(diag?.inputSampleRate).toBe(44100);
    expect(diag?.numBlocks).toBeGreaterThan(0);
    expect(diag?.chromaVector.length).toBe(12);
  });
});

describe('BPM & Tempo Detection (Onset Extraction & Autocorrelation)', () => {
  it('accurately detects standard tempos at 44.1 kHz, 48 kHz, and 96 kHz', () => {
    const testTempos = [120, 128, 140];
    const sampleRates = [44100, 48000, 96000];

    for (const bpm of testTempos) {
      for (const sr of sampleRates) {
        const buffer = createRhythmicBeatBuffer(sr, 5.0, bpm);
        const res = detectBpmFromAudio(buffer);

        expect(Math.abs(res.bpm - bpm)).toBeLessThanOrEqual(1.0);
        expect(res.diagnostics).toBeDefined();
        expect(res.diagnostics?.status).toBe('SUCCESS');
        expect(res.diagnostics?.noveltyFluxGatePassed).toBe(true);
        expect(res.diagnostics?.inputSampleRate).toBe(sr);
      }
    }
  });

  it('preserves half-tempo material (70 BPM) without octave doubling', () => {
    const buffer = createRhythmicBeatBuffer(44100, 6.0, 70);
    const res = detectBpmFromAudio(buffer);

    // Should detect ~70 BPM rather than doubling to 140 BPM
    expect(Math.abs(res.bpm - 70)).toBeLessThanOrEqual(1.5);
    expect(res.diagnostics?.status).toBe('SUCCESS');
  });

  it('gates silence to 0 BPM with SILENCE_GATED status', () => {
    const silentBuffer = createAudioBuffer(44100, 3.0, () => 0);
    const res = detectBpmFromAudio(silentBuffer);

    expect(res.bpm).toBe(0);
    expect(res.firstBeatTime).toBe(0);
    expect(res.diagnostics?.status).toBe('SILENCE_GATED');
  });

  it('gates continuous unmodulated tone / drone or noise to 0 BPM', () => {
    // Continuous 440 Hz sine wave has no periodic rhythmic beat pattern
    const droneBuffer = createAudioBuffer(44100, 3.0, (t) => Math.sin(2 * Math.PI * 440 * t) * 0.5);
    const res = detectBpmFromAudio(droneBuffer);

    expect(res.bpm).toBe(0);
    expect(res.diagnostics?.status === 'FLAT_NOVELTY_FLUX' || res.diagnostics?.status === 'WEAK_CORRELATION_PEAK').toBe(true);
  });

  it('rejects clips shorter than 1.0 second as SHORT_CLIP', () => {
    const shortBuffer = createAudioBuffer(44100, 0.8, () => Math.random());
    const res = detectBpmFromAudio(shortBuffer);

    expect(res.bpm).toBe(0);
    expect(res.diagnostics?.status).toBe('SHORT_CLIP');
  });

  it('records diagnostic tracking in getLastTempoDiagnostics()', () => {
    const buffer = createRhythmicBeatBuffer(44100, 4.0, 124);
    detectBpmFromAudio(buffer);

    const diag = getLastTempoDiagnostics();
    expect(diag).toBeDefined();
    expect(diag?.inputSampleRate).toBe(44100);
    expect(diag?.envelopeFrames).toBeGreaterThan(0);
    expect(diag?.maxNovelty).toBeGreaterThan(0);
    expect(diag?.status).toBe('SUCCESS');
  });
});
