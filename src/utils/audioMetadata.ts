/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ParsedAudioMetadata {
  sampleRate: number;
  channels: number;
  bitDepth?: number;
  bitrate: number; // in kbps
  codec: string;
  isVBR?: boolean;
}

/**
 * Parses native audio metadata directly from file buffer headers (RIFF/WAV, FLAC, etc.)
 * before Web Audio API resampling occurs.
 */
export function parseAudioMetadata(
  buffer: ArrayBuffer,
  fileSize?: number,
  duration?: number,
  fallbackCodec = 'Audio Stream'
): ParsedAudioMetadata {
  if (!buffer || buffer.byteLength < 12) {
    return {
      sampleRate: 44100,
      channels: 2,
      bitrate: fileSize && duration && duration > 0 ? Math.round((fileSize * 8 / duration) / 1000) : 1411,
      codec: fallbackCodec
    };
  }

  const view = new DataView(buffer);

  // 1. RIFF / WAVE format inspection
  const riffHeader = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riffHeader === 'RIFF' || riffHeader === 'RIFX') {
    const isLittleEndian = riffHeader === 'RIFF';
    const waveFormat = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));

    if (waveFormat === 'WAVE') {
      let offset = 12;
      const length = Math.min(buffer.byteLength, 4096);

      while (offset + 8 <= length) {
        const chunkId = String.fromCharCode(
          view.getUint8(offset),
          view.getUint8(offset + 1),
          view.getUint8(offset + 2),
          view.getUint8(offset + 3)
        );
        const chunkSize = view.getUint32(offset + 4, isLittleEndian);

        if (chunkId === 'fmt ' && offset + 8 + 16 <= buffer.byteLength) {
          const formatTag = view.getUint16(offset + 8, isLittleEndian);
          const channels = view.getUint16(offset + 10, isLittleEndian);
          const sampleRate = view.getUint32(offset + 12, isLittleEndian);
          const byteRate = view.getUint32(offset + 16, isLittleEndian);
          const bitDepth = view.getUint16(offset + 22, isLittleEndian);

          // Calculate precise PCM bitrate in kbps: sampleRate * channels * bitDepth / 1000
          const pcmBitrate = (sampleRate && channels && bitDepth)
            ? Math.round((sampleRate * channels * bitDepth) / 1000)
            : Math.round((byteRate * 8) / 1000);

          let codecName = 'Linear PCM (WAV)';
          if (formatTag === 3) {
            codecName = `IEEE Float ${bitDepth}-bit (WAV)`;
          } else if (bitDepth > 0) {
            codecName = `Linear PCM ${bitDepth}-bit (WAV)`;
          }

          return {
            sampleRate,
            channels: Math.max(1, channels),
            bitDepth: bitDepth > 0 ? bitDepth : undefined,
            bitrate: pcmBitrate > 0 ? pcmBitrate : 1411,
            codec: codecName,
            isVBR: false
          };
        }

        offset += 8 + chunkSize + (chunkSize % 2);
      }
    }
  }

  // 2. FLAC format inspection ('fLaC' signature)
  const flacHeader = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (flacHeader === 'fLaC' && buffer.byteLength >= 26) {
    // STREAMINFO block starts at offset 4 + 4 = 8
    // Minimum block size (16 bits), max block size (16 bits), min frame (24 bits), max frame (24 bits)
    // Offset 18: sample rate (20 bits), channels (3 bits), bits per sample (5 bits), total samples (36 bits)
    const b18 = view.getUint8(18);
    const b19 = view.getUint8(19);
    const b20 = view.getUint8(20);
    const sampleRate = (b18 << 12) | (b19 << 4) | (b20 >> 4);
    const channels = ((b20 >> 1) & 0x07) + 1;
    const b21 = view.getUint8(21);
    const bitDepth = (((b20 & 0x01) << 4) | (b21 >> 4)) + 1;

    const estimatedBitrate = fileSize && duration && duration > 0
      ? Math.round((fileSize * 8 / duration) / 1000)
      : Math.round((sampleRate * channels * bitDepth * 0.55) / 1000);

    return {
      sampleRate: sampleRate > 0 ? sampleRate : 44100,
      channels,
      bitDepth,
      bitrate: estimatedBitrate > 0 ? estimatedBitrate : 800,
      codec: `FLAC Lossless ${bitDepth}-bit`,
      isVBR: true
    };
  }

  // 3. MP3 / MPEG Audio Frame Header Inspection
  const u8 = new Uint8Array(buffer);
  let mp3Offset = 0;
  // Skip ID3v2 tag if present ('ID3' header with 10 bytes + syncsafe length)
  if (u8.length >= 10 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) {
    const id3Size = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
    mp3Offset = 10 + id3Size;
  }

  const scanLimit = Math.min(u8.length - 4, mp3Offset + 8192);
  for (let i = mp3Offset; i < scanLimit; i++) {
    if (u8[i] === 0xff && (u8[i + 1] & 0xe0) === 0xe0) {
      const ver = (u8[i + 1] >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
      const layer = (u8[i + 1] >> 1) & 0x03; // 1 = Layer III
      const brIdx = (u8[i + 2] >> 4) & 0x0f;
      const srIdx = (u8[i + 2] >> 2) & 0x03;
      const chMode = (u8[i + 3] >> 6) & 0x03;

      if (ver === 3 && layer === 1 && srIdx < 3 && brIdx > 0 && brIdx < 15) {
        const srTable = [44100, 48000, 32000];
        const brTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
        const actualBitrate = brTable[brIdx];
        const actualSampleRate = srTable[srIdx];
        const channels = chMode === 3 ? 1 : 2;

        return {
          sampleRate: actualSampleRate,
          channels,
          bitrate: actualBitrate,
          codec: 'MPEG-1 Layer 3 (MP3)',
          isVBR: false
        };
      } else if (ver === 2 && layer === 1 && srIdx < 3 && brIdx > 0 && brIdx < 15) {
        // MPEG-2 Layer III
        const srTable = [22050, 24000, 16000];
        const brTable = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
        return {
          sampleRate: srTable[srIdx],
          channels: chMode === 3 ? 1 : 2,
          bitrate: brTable[brIdx],
          codec: 'MPEG-2 Layer 3 (MP3)',
          isVBR: false
        };
      }
    }
  }

  // 4. Fallback / Compressed formats without detectable frame header (AAC, OGG, WebM)
  const calcBitrate = fileSize && duration && duration > 0
    ? Math.round((fileSize * 8 / duration) / 1000)
    : 320;

  return {
    sampleRate: 44100,
    channels: 2,
    bitrate: calcBitrate,
    codec: fallbackCodec,
    isVBR: true
  };
}
