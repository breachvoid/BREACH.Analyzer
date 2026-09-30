/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Generates a 16-bit PCM Stereo WAV Blob of a 124.0 BPM groove for the audio calibration reference track
export function generateDemoTrackWavBlob(): Blob {
  const sampleRate = 44100;
  const bpm = 124.0;
  const beatSec = 60 / bpm;
  const numBars = 16;
  const numBeats = numBars * 4;
  const totalDuration = numBeats * beatSec;
  const numFrames = Math.floor(totalDuration * sampleRate);

  const leftChannel = new Float32Array(numFrames);
  const rightChannel = new Float32Array(numFrames);

  // Bass notes frequencies (Funk groove in F minor: F1=43.65, Ab1=51.91, Bb1=58.27, C2=65.41)
  const bassNotes = [43.65, 43.65, 51.91, 58.27, 43.65, 65.41, 58.27, 51.91];

  for (let i = 0; i < numFrames; i++) {
    const t = i / sampleRate;
    const currentBeat = (t / beatSec) % numBeats;
    const beatFraction = currentBeat % 1.0;
    const barBeat = currentBeat % 4.0;

    let sampleL = 0;
    let sampleR = 0;

    // 1. Kick Drum on every beat (0.0, 1.0, 2.0, 3.0)
    if (beatFraction < 0.28) {
      const kickT = beatFraction * beatSec;
      const kickFreq = 110 * Math.exp(-kickT * 32) + 48;
      const kickEnv = Math.exp(-kickT * 14);
      const kick = Math.sin(2 * Math.PI * kickFreq * kickT) * kickEnv * 0.7;
      sampleL += kick;
      sampleR += kick;
    }

    // 2. Snare / Clap on beats 2 and 4 (barBeat around 1.0 and 3.0)
    const snareOffset1 = Math.abs(barBeat - 1.0);
    const snareOffset2 = Math.abs(barBeat - 3.0);
    const minSnareOffset = Math.min(snareOffset1, snareOffset2);
    if (minSnareOffset < 0.22) {
      const snareT = minSnareOffset * beatSec;
      const noise = (Math.random() * 2 - 1) * Math.exp(-snareT * 18);
      const tone = Math.sin(2 * Math.PI * 185 * snareT) * Math.exp(-snareT * 25);
      const snare = (noise * 0.5 + tone * 0.35) * 0.55;
      sampleL += snare * 0.9;
      sampleR += snare * 1.1;
    }

    // 3. Hi-Hats on 8th notes (beatFraction around 0.0 and 0.5)
    const hatOffset = (currentBeat * 2) % 1.0;
    if (hatOffset < 0.1) {
      const hatT = (hatOffset / 2) * beatSec;
      const hatNoise = (Math.random() * 2 - 1) * Math.exp(-hatT * 60) * 0.18;
      sampleL += hatNoise * 1.2;
      sampleR += hatNoise * 0.8;
    }

    // 4. Funky Bass Synth
    const noteIdx = Math.floor(currentBeat * 2) % bassNotes.length;
    const noteFreq = bassNotes[noteIdx];
    const bassPhase = (currentBeat * 2) % 1.0;
    const bassEnv = Math.exp(-bassPhase * 4.5);
    const bass = (Math.sin(2 * Math.PI * noteFreq * t) + 0.3 * Math.sin(4 * Math.PI * noteFreq * t)) * bassEnv * 0.4;
    sampleL += bass;
    sampleR += bass;

    // 5. Stereo Pad / Chord Stabs (Stereo width for Goniometer)
    const padChord = Math.sin(2 * Math.PI * 261.63 * t) * 0.08 + Math.sin(2 * Math.PI * 349.23 * t) * 0.07;
    sampleL += padChord * (0.6 + 0.3 * Math.sin(t * 1.5));
    sampleR += padChord * (0.6 - 0.3 * Math.sin(t * 1.5));

    leftChannel[i] = Math.max(-0.95, Math.min(0.95, sampleL));
    rightChannel[i] = Math.max(-0.95, Math.min(0.95, sampleR));
  }

  // Create 16-bit PCM WAV File Header
  const numChannels = 2;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Write WAV RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write interleaved PCM samples
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const sL = Math.max(-1, Math.min(1, leftChannel[i]));
    const sR = Math.max(-1, Math.min(1, rightChannel[i]));
    view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
    offset += 2;
    view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
