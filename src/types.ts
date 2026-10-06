/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum AudioSourceType {
  MICROPHONE = 'microphone',
  AUDIO_FILE = 'audio_file',
  GENERATOR = 'generator',
  SYSTEM_CAPTURE = 'system_capture'
}

export enum GeneratorSignalType {
  SINE = 'sine',
  SQUARE = 'square',
  SAWTOOTH = 'sawtooth',
  TRIANGLE = 'triangle',
  WHITE_NOISE = 'white_noise',
  PINK_NOISE = 'pink_noise',
  SINE_SWEEP = 'sine_sweep',
  AMBIENT_DRONE = 'ambient_drone'
}

export enum VisualizerMode {
  SPECTRUM_BARS = 'spectrum_bars',
  SPECTRUM_CURVE = 'spectrum_curve',
  SPECTROGRAM = 'spectrogram',
  WAVEFORM = 'waveform',
  HEATMAP = 'heatmap'
}

export enum FrequencyScale {
  LOGARITHMIC = 'logarithmic',
  LINEAR = 'linear'
}

export const LOUDNESS_STANDARDS = {
  YOUTUBE: { label: 'YouTube', lufs: -14.0 },
  SPOTIFY: { label: 'Spotify', lufs: -14.0 },
  BROADCAST_EBU: { label: 'EBU R128', lufs: -23.0 },
  BROADCAST_ATSC: { label: 'ATSC A/85', lufs: -24.0 },
  GENERIC_MUSIC: { label: 'Pop Music / Top 40', lufs: -10.0 },
  APPLE_MUSIC: { label: 'Apple Music', lufs: -16.0 },
  TIDAL_DEEZER: { label: 'Tidal / Deezer', lufs: -14.0 },
  GENRE_JUNGLE_DNB: { label: 'Jungle / DnB', lufs: -5.0 },
  GENRE_EDM: { label: 'EDM / Club', lufs: -6.0 },
  GENRE_TECHNO_HOUSE: { label: 'Techno / House', lufs: -8.0 },
  GENRE_ROCK_METAL: { label: 'Rock / Metal', lufs: -9.0 },
  GENRE_HIPHOP_RAP: { label: 'Hip-Hop / Rap', lufs: -9.0 },
  GENRE_ACOUSTIC_INDIE: { label: 'Acoustic / Indie', lufs: -12.0 },
  GENRE_JAZZ: { label: 'Jazz / Fusion', lufs: -15.0 },
  GENRE_CLASSICAL: { label: 'Classical / Orchestral', lufs: -18.0 },
  PODCAST_AUDIOBOOK: { label: 'Podcast / Audiobook', lufs: -16.0 },
  CINEMATIC_TRAILER: { label: 'Cinematic Trailer', lufs: -13.0 },
  FILM_MIX: { label: 'Film Mix', lufs: -18.0 }
} as const;

export const LoudnessStandard = Object.fromEntries(
  Object.entries(LOUDNESS_STANDARDS).map(([key, val]) => [key, val.lufs])
) as {
  readonly [K in keyof typeof LOUDNESS_STANDARDS]: typeof LOUDNESS_STANDARDS[K]['lufs']
};

export type LoudnessStandard = typeof LoudnessStandard[keyof typeof LoudnessStandard];

export interface LoudnessMetrics {
  measuredSeconds?: number;
  momentary: number;      // 400ms window (LUFS)
  shortTerm: number;      // 3s window (LUFS)
  integrated: number;     // Gated integrated loudness (LUFS)
  lra: number;            // Loudness Range (LU)
  maxMomentary: number;   // Maximum Momentary (LUFS)
  maxShortTerm: number;   // Maximum Short-term (LUFS)
  peakLeft: number;       // True peak left channel (dBTP)
  peakRight: number;      // True peak right channel (dBTP)
  maxPeak: number;        // Max true peak across all channels (dBTP)
  crestFactor: number;    // Crest factor (dB)
  phaseCorrelationValid?: boolean; // False when either measured channel is silent
  phaseCorrelation: number; // Phase correlation status (-1 to +1)
}

export interface FrequencyMarker {
  id: string;
  frequency: number; // in Hz (e.g. 100, 1000, 2500, 8000)
  label?: string;
  color?: string;
}

export enum FFTWindowFunction {
  BLACKMAN_HARRIS = 'blackman_harris',
  HANN = 'hann',
  HAMMING = 'hamming',
  BLACKMAN = 'blackman',
  FLAT_TOP = 'flat_top',
  RECTANGULAR = 'rectangular'
}

export interface AnalyzerConfig {
  fftSize: number;
  smoothing: number;
  minDecibels: number;
  maxDecibels: number;
  frequencyScale: FrequencyScale;
  visualizerMode: VisualizerMode;
  targetLoudness: LoudnessStandard | number;
  showGrid: boolean;
  showPeakHold: boolean;
  colorPalette: 'void-scientific' | 'pioneer-rgb' | 'breach-cinematic' | 'classic-spectrogram' | 'crimson-red' | 'neon-cyan' | 'synthwave' | 'emerald-gold' | 'dracula' | 'amber-glow' | 'monochrome-slate' | 'custom';
  splitWaterfall: boolean;
  peakHoldDecay: number; // peak decay duration (ms), e.g. 500, 1000, 2000, 999999 for infinite
  waveformPalette: 'void' | 'rgb' | 'blue' | '3-band';
  fftWindow?: FFTWindowFunction; // FFT windowing function (Hann, Hamming, Blackman-Harris, etc.)
  customColors?: {
    primary: string;
    secondary: string;
    accent: string;
    tertiary?: string; // Mid-High color between dominant/primary and highlight/accent
    bgDark?: string; // Retained for type compatibility but hardcoded to black in resolver
  };
  frequencyMarkers?: FrequencyMarker[];
}

export interface DemoTrack {
  id: string;
  name: string;
  artist: string;
  url: string;
  genre: string;
}

export interface PresetItem {
  id: string;
  name: string;
  isCustom: boolean;
  config: Partial<AnalyzerConfig>;
}

// Existing file-analysis outputs shared between the waveform producer and Studio Deck display.
export interface TrackAnalysisDisplay {
  fileUrl: string;
  bpm: number;
  bpmSource: 'auto' | 'none';
  musicalKey: string;
  camelotKey: string;
  keyCorrelation: number;
}
