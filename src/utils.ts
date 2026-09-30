/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Note list for MIDI/Frequency conversions
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Convert a frequency in Hz to its closest musical note name and detune amount
 */
export function frequencyToNote(freq: number): string {
  if (freq <= 16.35) return 'Sub-audible'; // C0 boundary
  const h = 12 * Math.log2(freq / 440) + 69;
  const midiNote = Math.round(h);
  const detune = Math.round((h - midiNote) * 100);
  
  if (midiNote < 0 || midiNote > 127) return 'Out of bounds';
  
  const noteIndex = midiNote % 12;
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = NOTE_NAMES[noteIndex];
  
  const detuneSign = detune >= 0 ? '+' : '';
  const detuneStr = detune !== 0 ? ` (${detuneSign}${detune}¢)` : '';
  
  return `${noteName}${octave}${detuneStr}`;
}

/**
 * Maps dual decibel values to relative physical screen positions for visual grids
 */
export function dbToPercent(db: number, minDecibels: number, maxDecibels: number): number {
  const clamped = Math.min(maxDecibels, Math.max(minDecibels, db));
  return ((clamped - minDecibels) / (maxDecibels - minDecibels)) * 100;
}

/**
 * Formats decibels to safe textual representations
 */
export function formatDB(db: number, precision = 1): string {
  if (db === undefined || db <= -120) return '-∞ dB';
  return `${db.toFixed(precision)} dB`;
}

/**
 * Formats LUFS values for aesthetic readability
 */
export function formatLUFS(lufs: number, precision = 1): string {
  if (lufs === undefined || lufs <= -99) return '-∞ LUFS';
  return `${lufs.toFixed(precision)} LUFS`;
}

/**
 * Generates custom color palettes for both standard canvas lines and spectrogram sweeps
 */
export interface StudioPalette {
  primary: string;
  secondary: string;
  accent: string;
  bgDark: string;
  gridColor: string;
  gradientColors: string[]; // for multi-step canvas draw
  getSpectrogramColor: (amplitude: number) => string; // 0.0 to 1.0 (representing energy)
  textColor: string; // Color for grids and metadata texts
}

export const COLOR_PALETTES: Record<string, StudioPalette> = {
  'void-scientific': {
    primary: '#FFFFFF', // Pure White for clean scientific frequency bars/curves
    secondary: '#B20000', // Brand Red
    accent: '#FF3333', // Highlight Red for peaks & active markers
    bgDark: '#000000', // Pure pitch black instrument canvas
    gridColor: 'rgba(255, 255, 255, 0.06)', // Subdued precision grid
    gradientColors: ['#000000', '#2B0000', '#B20000', '#FF3333', '#FFFFFF'],
    getSpectrogramColor: (amp) => {
      // Monochromatic Red Gradient: Black -> Deep Crimson -> Red -> White
      if (amp <= 0.02) return 'rgba(0,0,0,1)';
      if (amp < 0.35) {
        const pct = amp / 0.35;
        const r = Math.round(pct * 43);
        return `rgb(${r}, 0, 0)`;
      }
      if (amp < 0.70) {
        const pct = (amp - 0.35) / 0.35;
        const r = Math.round(43 + pct * (178 - 43));
        return `rgb(${r}, 0, 0)`;
      }
      if (amp < 0.90) {
        const pct = (amp - 0.70) / 0.20;
        const r = Math.round(178 + pct * (255 - 178));
        const g = Math.round(pct * 51);
        const b = Math.round(pct * 51);
        return `rgb(${r}, ${g}, ${b})`;
      }
      const pct = Math.min(1, (amp - 0.90) / 0.10);
      const r = 255;
      const g = Math.round(51 + pct * (255 - 51));
      const b = Math.round(51 + pct * (255 - 51));
      return `rgb(${r}, ${g}, ${b})`;
    },
    textColor: 'rgba(255, 255, 255, 0.65)'
  },
  'pioneer-rgb': {
    primary: '#22C55E', // Mids / Vocals: Electric Green
    secondary: '#EAB308', // Higher dB transition: Yellow
    accent: '#EF4444', // Peak dB: Red
    bgDark: '#000000',
    gridColor: 'rgba(255, 255, 255, 0.07)',
    gradientColors: ['#0A2610', '#15803D', '#22C55E', '#EAB308', '#EF4444'],
    getSpectrogramColor: (amp) => {
      // Rekordbox dB logic: Vague green at bottom -> Green -> Transition to Yellow -> Red at higher dB
      if (amp <= 0.02) return 'rgba(0,0,0,1)';
      if (amp < 0.28) {
        // Vague green at bottom (low dB)
        const pct = amp / 0.28;
        const g = Math.round(25 + pct * 95);
        return `rgb(8, ${g}, 14)`;
      }
      if (amp < 0.62) {
        // Solid vibrant green
        const pct = (amp - 0.28) / 0.34;
        const r = Math.round(pct * 160);
        const g = Math.round(120 + pct * 100);
        const b = Math.round(pct * 15);
        return `rgb(${r}, ${g}, ${b})`;
      }
      if (amp < 0.85) {
        // Transition to yellow
        const pct = (amp - 0.62) / 0.23;
        const r = Math.round(160 + pct * 95);
        const g = Math.round(220 - pct * 30);
        const b = Math.round(15 * (1 - pct));
        return `rgb(${r}, ${g}, ${b})`;
      }
      // Red at higher dB (peaks)
      const pct = Math.min(1, (amp - 0.85) / 0.15);
      const r = 255;
      const g = Math.round(190 * (1 - pct));
      const b = Math.round(pct * 25);
      return `rgb(${r}, ${g}, ${b})`;
    },
    textColor: '#22C55E' // Rekordbox RGB signature Green
  },
  'breach-cinematic': {
    primary: '#B20000', // Dark Red brand primary
    secondary: '#1A1A1A', // Charcoal secondary
    accent: '#FFFFFF', // High-contrast White
    bgDark: '#000000', // Pitch Black canvas
    gridColor: 'rgba(255, 255, 255, 0.05)', // Extremely subtle high-contrast micro grid
    gradientColors: ['#000000', '#1A1A1A', '#4A0000', '#B20000', '#FFFFFF'],
    getSpectrogramColor: (amp) => {
      if (amp <= 0.02) return 'rgba(0, 0, 0, 1)'; // Space black negative space
      if (amp < 0.25) {
        // Noise floor: Black to subtle Charcoal with extreme low-energy dampening
        const pct = amp / 0.25;
        const gray = Math.round(pct * 26); // go to #1A1A1A (decimal 26)
        return `rgb(${gray}, ${gray}, ${gray})`;
      }
      if (amp < 0.6) {
        // Charcoal to Cinematic Deep Wine Red (#4A0000, r=74)
        const pct = (amp - 0.25) / 0.35;
        const r = Math.round(26 + pct * (74 - 26));
        const g = Math.round(26 - pct * 26);
        const b = Math.round(26 - pct * 26);
        return `rgb(${r}, ${g}, ${b})`;
      }
      if (amp < 0.85) {
        // Deep Wine Red to brand primary Dark Red (#B20000, r=178)
        const pct = (amp - 0.6) / 0.25;
        const r = Math.round(74 + pct * (178 - 74));
        return `rgb(${r}, 0, 0)`;
      }
      if (amp < 0.96) {
        // Sparingly applied peak warning highlight: Dark Red to Rose Glowing Core
        const pct = (amp - 0.85) / 0.11;
        const r = Math.round(178 + pct * (255 - 178));
        const g = Math.round(pct * 120);
        const b = Math.round(pct * 120);
        return `rgb(${r}, ${g}, ${b})`;
      }
      // Fragmented Light / Digital Overdrive: Hot White
      const pct = (amp - 0.96) / 0.04;
      const g = Math.round(120 + pct * 135);
      const b = Math.round(120 + pct * 135);
      return `rgb(255, ${g}, ${b})`;
    },
    textColor: '#A0A0A0', // Light Gray supporting text
  },
  'classic-spectrogram': {
    primary: '#38bdf8', // sky-400
    secondary: '#1e3a8a', // dark blue
    accent: '#f43f5e', // rose-500
    bgDark: '#000000', // Pitch Black canvas
    gridColor: 'rgba(255, 255, 255, 0.08)',
    gradientColors: ['#040620', '#172554', '#1e40af', '#3b82f6', '#06b6d4', '#10b981', '#fbbf24', '#ef4444', '#ffffff'],
    getSpectrogramColor: (amp) => {
      // Industry-standard Rainbow Jet / Magma / Thermal hybrid
      // Highly responsive progression matching scientific visualizer tools
      if (amp <= 0.02) return 'rgba(0, 0, 0, 1)'; // Space black negative space
      if (amp < 0.2) {
        // Space to Pure Deep Navy Blue (no purple/violet)
        const r = 0;
        const g = Math.round((amp / 0.2) * 20);
        const b = Math.round((amp / 0.2) * 110);
        return `rgb(${r}, ${g}, ${b})`;
      }
      if (amp < 0.4) {
        // Deep Navy Blue to Rich Teal
        const pct = (amp - 0.2) / 0.2;
        const r = 0;
        const g = Math.round(20 + pct * 150);
        const b = Math.round(110 + pct * 73);
        return `rgb(${r}, ${g}, ${b})`;
      }
      if (amp < 0.6) {
        // Teal to Vibrant Green
        const pct = (amp - 0.4) / 0.2;
        const r = Math.round(pct * 34);
        const g = Math.round(170 + pct * 30);
        const b = Math.round(183 - pct * 140);
        return `rgb(${r}, ${g}, ${b})`;
      }
      if (amp < 0.8) {
        // Green to Bright Yellow/Orange
        const pct = (amp - 0.6) / 0.2;
        const r = Math.round(34 + pct * 221);
        const g = Math.round(200 - pct * 40);
        const b = Math.round(43 - pct * 43);
        return `rgb(${r}, ${g}, ${b})`;
      }
      if (amp < 0.95) {
        // Orange to Fiery Red
        const pct = (amp - 0.8) / 0.15;
        const r = 255;
        const g = Math.round(160 - pct * 130);
        const b = Math.round(pct * 30);
        return `rgb(${r}, ${g}, ${b})`;
      }
      // Hot white peak highlight
      const pct = (amp - 0.95) / 0.05;
      const g = Math.round(30 + pct * 225);
      const b = Math.round(30 + pct * 225);
      return `rgb(255, ${g}, ${b})`;
    },
    textColor: '#ffffff'
  },
  'crimson-red': {
    primary: '#B20000',
    secondary: '#330000',
    accent: '#FF0000',
    bgDark: '#000000',
    gridColor: 'rgba(178, 0, 0, 0.15)',
    gradientColors: ['#1A0000', '#4A0000', '#800000', '#B20000', '#FF0000'],
    getSpectrogramColor: (amp) => {
      if (amp < 0.1) return `rgba(0, 0, 0, ${amp * 10})`;
      if (amp < 0.4) return `rgba(128, 0, 0, ${amp})`;
      if (amp < 0.75) return `rgba(178, 0, 0, ${amp})`;
      return `rgba(255, 0, 0, ${amp})`;
    },
    textColor: '#B20000'
  },
  'neon-cyan': {
    primary: '#06b6d4', // cyan-500
    secondary: '#3b82f6', // blue-500
    accent: '#f43f5e', // rose-500
    bgDark: '#000000',
    gridColor: 'rgba(6, 182, 212, 0.12)',
    gradientColors: ['#06b6d4', '#4ade80', '#eab308', '#ef4444'],
    getSpectrogramColor: (amp) => {
      if (amp < 0.1) return `rgba(0, 0, 0, ${amp * 10})`;
      if (amp < 0.4) return `rgba(5, 70, 117, ${amp})`;
      if (amp < 0.7) return `rgba(6, 182, 212, ${amp})`;
      if (amp < 0.9) return `rgba(74, 222, 128, ${amp})`;
      return `rgba(239, 68, 68, ${amp})`;
    },
    textColor: '#a5f3fc'
  },
  'synthwave': {
    primary: '#ec4899', // pink-500
    secondary: '#8b5cf6', // violet-500
    accent: '#06b6d4', // cyan-500
    bgDark: '#000000',
    gridColor: 'rgba(236, 72, 153, 0.1)',
    gradientColors: ['#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e'],
    getSpectrogramColor: (amp) => {
      if (amp < 0.1) return `rgba(0, 0, 0, ${amp * 10})`;
      if (amp < 0.4) return `rgba(139, 92, 246, ${amp})`;
      if (amp < 0.85) return `rgba(236, 72, 153, ${amp})`;
      return `rgba(244, 63, 94, ${amp})`;
    },
    textColor: '#fdbcfc'
  },
  'emerald-gold': {
    primary: '#10b981', // emerald-500
    secondary: '#f59e0b', // amber-500
    accent: '#ef4444', // red-500
    bgDark: '#000000',
    gridColor: 'rgba(16, 185, 129, 0.1)',
    gradientColors: ['#10b981', '#14b8a6', '#f59e0b', '#eef2f6'],
    getSpectrogramColor: (amp) => {
      if (amp < 0.1) return `rgba(0, 0, 0, ${amp * 10})`;
      if (amp < 0.4) return `rgba(6, 95, 70, ${amp})`;
      if (amp < 0.7) return `rgba(16, 185, 129, ${amp})`;
      if (amp < 0.9) return `rgba(245, 158, 11, ${amp})`;
      return `rgba(239, 68, 68, ${amp})`;
    },
    textColor: '#a7f3d0'
  },
  'dracula': {
    primary: '#bd93f9', // purple
    secondary: '#ff79c6', // pink
    accent: '#ff5555', // red
    bgDark: '#000000',
    gridColor: 'rgba(189, 147, 249, 0.15)',
    gradientColors: ['#bd93f9', '#ff79c6', '#8be9fd', '#50fa7b'],
    getSpectrogramColor: (amp) => {
      if (amp < 0.1) return `rgba(0, 0, 0, ${amp * 10})`;
      if (amp < 0.5) return `rgba(189, 147, 249, ${amp})`;
      if (amp < 0.85) return `rgba(255, 121, 198, ${amp})`;
      return `rgba(255, 85, 85, ${amp})`;
    },
    textColor: '#e8dcff'
  },
  'amber-glow': {
    primary: '#f59e0b', // amber
    secondary: '#ea580c', // orange
    accent: '#fbbf24', // yellow
    bgDark: '#000000',
    gridColor: 'rgba(245, 158, 11, 0.12)',
    gradientColors: ['#ea580c', '#f59e0b', '#fbbf24', '#fffbeb'],
    getSpectrogramColor: (amp) => {
      if (amp < 0.1) return `rgba(0, 0, 0, ${amp * 10})`;
      if (amp < 0.4) return `rgba(120, 53, 4, ${amp})`;
      if (amp < 0.75) return `rgba(245, 158, 11, ${amp})`;
      return `rgba(251, 191, 36, ${amp})`;
    },
    textColor: '#fef3c7'
  },
  'monochrome-slate': {
    primary: '#D1D5DB',
    secondary: '#4B5563',
    accent: '#F3F4F6',
    bgDark: '#000000',
    gridColor: 'rgba(255, 255, 255, 0.08)',
    gradientColors: ['#0A0B0D', '#374151', '#6B7280', '#9CA3AF', '#E5E7EB', '#FFFFFF'],
    getSpectrogramColor: (amp) => {
      if (amp < 0.05) return 'rgba(0, 0, 0, 1)';
      const val = Math.round(13 + amp * (255 - 13));
      return `rgb(${val}, ${val}, ${val})`;
    },
    textColor: '#D1D5DB'
  }
};

/**
 * Resolves a palette by name, returning either a predefined StudioPalette or a dynamically
 * constructed one for the 'custom' theme using the user's custom hex colors.
 */
export function resolvePalette(
  colorPalette: string,
  customColors?: { primary: string; secondary: string; accent: string; tertiary?: string; bgDark?: string }
): StudioPalette {
  if (colorPalette === 'custom') {
    const primary = customColors?.primary || '#B20000';
    const secondary = customColors?.secondary || '#1A0000';
    const accent = customColors?.accent || '#FFFFFF';
    const tertiary = customColors?.tertiary || '#FF3333'; // Red mid-high transition
    const bgDark = '#000000'; // pitch dark background is hardcoded for maximum layout contrast
    
    // Parse primary for a fallback grid color
    const cleanPrimary = primary.replace('#', '');
    const gr = parseInt(cleanPrimary.substring(0, 2), 16) || 178;
    const gg = parseInt(cleanPrimary.substring(2, 4), 16) || 0;
    const gb = parseInt(cleanPrimary.substring(4, 6), 16) || 0;

    return {
      primary,
      secondary,
      accent,
      bgDark,
      gridColor: `rgba(${gr}, ${gg}, ${gb}, 0.12)`,
      gradientColors: [bgDark, secondary, primary, tertiary, accent],
      textColor: accent,
      getSpectrogramColor: (amp) => {
        if (amp <= 0.02) return bgDark;
        
        const hexToRgb = (hexStr: string) => {
          const clean = hexStr.replace('#', '');
          const r = parseInt(clean.substring(0, 2), 16) || 0;
          const g = parseInt(clean.substring(2, 4), 16) || 0;
          const b = parseInt(clean.substring(4, 6), 16) || 0;
          return { r, g, b };
        };

        const cBg = hexToRgb(bgDark);
        const cSec = hexToRgb(secondary);
        const cPri = hexToRgb(primary);
        const cTer = hexToRgb(tertiary);
        const cAcc = hexToRgb(accent);

        if (amp < 0.2) {
          const pct = amp / 0.2;
          const r = Math.round(cBg.r + pct * (cSec.r - cBg.r));
          const g = Math.round(cBg.g + pct * (cSec.g - cBg.g));
          const b = Math.round(cBg.b + pct * (cSec.b - cBg.b));
          return `rgb(${r}, ${g}, ${b})`;
        } else if (amp < 0.5) {
          const pct = (amp - 0.2) / 0.3;
          const r = Math.round(cSec.r + pct * (cPri.r - cSec.r));
          const g = Math.round(cSec.g + pct * (cPri.g - cSec.g));
          const b = Math.round(cSec.b + pct * (cPri.b - cSec.b));
          return `rgb(${r}, ${g}, ${b})`;
        } else if (amp < 0.8) {
          const pct = (amp - 0.5) / 0.3;
          const r = Math.round(cPri.r + pct * (cTer.r - cPri.r));
          const g = Math.round(cPri.g + pct * (cTer.g - cPri.g));
          const b = Math.round(cPri.b + pct * (cTer.b - cPri.b));
          return `rgb(${r}, ${g}, ${b})`;
        } else if (amp < 0.95) {
          const pct = (amp - 0.8) / 0.15;
          const r = Math.round(cTer.r + pct * (cAcc.r - cTer.r));
          const g = Math.round(cTer.g + pct * (cAcc.g - cTer.g));
          const b = Math.round(cTer.b + pct * (cAcc.b - cTer.b));
          return `rgb(${r}, ${g}, ${b})`;
        } else {
          const pct = (amp - 0.95) / 0.05;
          const r = Math.round(cAcc.r + pct * (255 - cAcc.r));
          const g = Math.round(cAcc.g + pct * (255 - cAcc.g));
          const b = Math.round(cAcc.b + pct * (255 - cAcc.b));
          return `rgb(${r}, ${g}, ${b})`;
        }
      }
    };
  }
  
  return COLOR_PALETTES[colorPalette] || COLOR_PALETTES['pioneer-rgb'] || COLOR_PALETTES['void-scientific'];
}

/**
 * Registry to hold reference to original File objects uploaded/dragged by users.
 * Slicing File objects directly bypasses expensive fetching or loading full files into memory.
 */
export class AudioFileRegistry {
  private static files = new Map<string, File>();

  public static register(url: string, file: File): void {
    this.files.set(url, file);
  }

  public static get(url: string): File | undefined {
    return this.files.get(url);
  }

  public static revoke(url: string): void {
    this.files.delete(url);
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      // Ignore
    }
  }

  public static clear(): void {
    this.files.clear();
  }
}

/**
 * Reads up to maxBytes from/local or remote file url. 
 * Prevents full heap allocations for vast files.
 */
export async function fetchPartialArrayBuffer(url: string, maxBytes: number): Promise<ArrayBuffer> {
  const registeredFile = AudioFileRegistry.get(url);
  if (registeredFile) {
    const sliceBlob = registeredFile.slice(0, maxBytes);
    return await sliceBlob.arrayBuffer();
  }

  // Try HTTP Range header first
  try {
    const rangeResp = await fetch(url, {
      headers: { Range: `bytes=0-${maxBytes - 1}` }
    });
    if (rangeResp.ok || rangeResp.status === 206) {
      return await rangeResp.arrayBuffer();
    }
  } catch (e) {
    console.warn("Partial range fetch bypassed (CORS or server restriction):", e);
  }

  // Fallback to progressive stream reading (cancels download once threshold reached)
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch: ${resp.status} ${resp.statusText}`);
  }
  
  if (!resp.body) {
    const fullBlob = await resp.blob();
    return await fullBlob.arrayBuffer();
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalBytes += value.length;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch (e) {
      // Ignore reader cancellation details
    }
  }

  // Merge bytes up to limit
  const combined = new Uint8Array(Math.min(totalBytes, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= combined.length) break;
    const toCopy = Math.min(chunk.length, combined.length - offset);
    combined.set(chunk.subarray(0, toCopy), offset);
    offset += toCopy;
  }
  return combined.buffer;
}

/**
 * Fetch a specific slice of bytes from a local or remote file URL.
 */
export async function fetchSlice(url: string, start: number, end: number, registeredFile?: File): Promise<ArrayBuffer> {
  if (registeredFile) {
    const blob = registeredFile.slice(start, end);
    return await blob.arrayBuffer();
  }
  
  // Try HTTP range
  try {
    const resp = await fetch(url, {
      headers: { Range: `bytes=${start}-${end - 1}` }
    });
    if (resp.ok || resp.status === 206) {
      return await resp.arrayBuffer();
    }
  } catch (e) {
    console.warn("Partial fetch slice failed:", e);
  }

  throw new Error("Slice fetch aborted: Server does not support Range requests or CORS restrictions apply.");
}

/**
 * Retrieve exact content length / file size of local or remote track.
 */
export async function getAudioFileSize(url: string, registeredFile?: File): Promise<number> {
  if (registeredFile) {
    return registeredFile.size;
  }
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    const cl = resp.headers.get('Content-Length');
    if (cl) return parseInt(cl, 10);
  } catch (e) {
    // HEAD request CORS/methods issue
  }
  
  try {
    const resp = await fetch(url);
    const cl = resp.headers.get('Content-Length');
    if (cl) return parseInt(cl, 10);
  } catch (e) {}
  
  return 20 * 1024 * 1024; // Default estimate of 20MB
}

