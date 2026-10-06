/** @license SPDX-License-Identifier: Apache-2.0 */

export type BitrateKind = 'PCM' | 'frame' | 'declared average' | 'file estimate';
export interface ParsedAudioMetadata {
  // Zero means unavailable, never an assumed native rate or channel count.
  sampleRate: number;
  channels: number;
  bitDepth?: number;
  bitrate: number;
  bitrateKind?: BitrateKind;
  codec: string;
  isVBR?: boolean;
}

const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const formatHint = (name: string): string => {
  const ext = name.split(/[?#]/, 1)[0].match(/\.([a-z0-9]+)$/i)?.[1].toUpperCase();
  return ext && ['WAV', 'FLAC', 'MP3', 'M4A', 'MP4', 'AAC', 'OGG', 'OPUS', 'AIFF', 'AIF', 'WEBM'].includes(ext) ? ext : '';
};
export function unknownAudioMetadata(name = '', fileSize?: number, duration?: number): ParsedAudioMetadata {
  const format = formatHint(name);
  const estimate = Number.isFinite(fileSize) && fileSize! > 0 && Number.isFinite(duration) && duration! > 0
    ? Math.round(fileSize! * 8 / duration! / 1000) : 0;
  return { sampleRate: 0, channels: 0, bitrate: estimate,
    bitrateKind: estimate > 0 ? 'file estimate' : undefined,
    codec: format ? `Unknown (${format})` : 'Unknown' };
}

/** Compare canonical media-element URLs without treating a missing URL as an association. */
export function isAudioMetadataForUrl(sourceUrl: string | undefined, url: string): boolean {
  if (!sourceUrl || !url) return false;
  if (sourceUrl === url) return true;
  try { return sourceUrl === new URL(url, globalThis.location?.href).href; } catch { return false; }
}

interface Atom { type: string; start: number; data: number; end: number }
const fourCC = (v: DataView, p: number): string => String.fromCharCode(...[0, 1, 2, 3].map(i => v.getUint8(p + i)));
// A malformed child ends this sibling list. Never scan arbitrary payload for atom names.
function atoms(v: DataView, start: number, end: number): Atom[] {
  const result: Atom[] = [];
  for (let p = start; p + 8 <= end && result.length < 1024;) {
    let size = v.getUint32(p); let header = 8;
    if (size === 1) {
      if (p + 16 > end) break;
      size = v.getUint32(p + 8) * 4294967296 + v.getUint32(p + 12); header = 16;
    } else if (size === 0) size = end - p;
    if (!Number.isSafeInteger(size) || size < header || size > end - p) break;
    result.push({ type: fourCC(v, p + 4), start: p, data: p + header, end: p + size });
    p += size;
  }
  return result;
}
const child = (v: DataView, a: Atom, type: string): Atom | undefined => atoms(v, a.data, a.end).find(b => b.type === type);

interface Descriptor { tag: number; data: number; end: number }
function descriptors(v: DataView, start: number, end: number): Descriptor[] {
  const out: Descriptor[] = [];
  for (let p = start; p < end && out.length < 128;) {
    const tag = v.getUint8(p++); let size = 0; let done = false;
    for (let i = 0; i < 4 && p < end; i++) {
      const b = v.getUint8(p++); size = size * 128 + (b & 127);
      if (!(b & 128)) { done = true; break; }
    }
    if (!done || size > end - p) break;
    out.push({ tag, data: p, end: p + size }); p += size;
  }
  return out;
}
function aacDescription(v: DataView, esds: Atom): {rate: number; channels: number; bitrate: number} | undefined {
  if (esds.data + 4 > esds.end) return;
  const es = descriptors(v, esds.data + 4, esds.end).find(d => d.tag === 3);
  if (!es || es.data + 3 > es.end) return;
  const flags = v.getUint8(es.data + 2); let p = es.data + 3;
  if (flags & 128) p += 2;
  if (flags & 64) { if (p >= es.end) return; p += 1 + v.getUint8(p); }
  if (flags & 32) p += 2;
  const dec = descriptors(v, p, es.end).find(d => d.tag === 4);
  if (!dec || dec.data + 13 > dec.end || v.getUint8(dec.data) !== 0x40 || ((v.getUint8(dec.data + 1) >> 2) & 63) !== 5) return;
  const asc = descriptors(v, dec.data + 13, dec.end).find(d => d.tag === 5);
  if (!asc) return;
  let bit = asc.data * 8;
  const read = (n: number): number | undefined => {
    if (bit + n > asc.end * 8) return;
    let value = 0;
    for (let i = 0; i < n; i++, bit++) value = value * 2 + ((v.getUint8(bit >> 3) >> (7 - (bit & 7))) & 1);
    return value;
  };
  const objectType = (): number | undefined => { const t = read(5); return t === 31 ? (() => { const x = read(6); return x === undefined ? undefined : 32 + x; })() : t; };
  const frequency = (): number | undefined => { const i = read(4); return i === 15 ? read(24) : i === undefined ? undefined : [96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350][i]; };
  let type = objectType(); let rate = frequency(); const channelConfig = read(4);
  const explicitPS = type === 29;
  const explicitSBR = type === 5 || type === 29;
  if (explicitSBR) { rate = frequency(); type = objectType(); }
  // Conservatively support AAC Main/LC, including explicit HE-AAC signaling; other object types stay unknown.
  if (type === undefined || ![1,2].includes(type) || !rate || channelConfig === undefined) return;
  let channels = [0,1,2,3,4,5,6,8][channelConfig] || 0;
  if (explicitPS && channels === 1) channels = 2;
  // General Audio config for AAC Main/LC, then optional explicit sync extension.
  if (read(1) === undefined) return;
  const dependsOnCore = read(1); if (dependsOnCore === undefined) return;
  if (dependsOnCore && read(14) === undefined) return;
  if (read(1) === undefined) return;
  if (!explicitSBR && channels > 0 && bit + 16 <= asc.end * 8) {
    if (read(11) === 0x2b7 && objectType() === 5) {
      const sbr = read(1); if (sbr === undefined) return;
      if (sbr) { const outputRate = frequency(); if (!outputRate) return; rate = outputRate; }
      if (bit + 12 <= asc.end * 8 && read(11) === 0x548 && read(1) === 1 && channels === 1) channels = 2;
    }
  }
  return { rate, channels, bitrate: Math.round(v.getUint32(dec.data + 9) / 1000) };
}
function parseMp4(v: DataView, roots: Atom[], fallback: ParsedAudioMetadata, name: string): ParsedAudioMetadata {
  const container = formatHint(name) === 'M4A' ? 'M4A' : 'MP4';
  const unknown = { ...fallback, codec: `Unknown (${container})` };
  const moov = roots.find(a => a.type === 'moov'); if (!moov) return unknown;
  const audio: ParsedAudioMetadata[] = [];
  for (const trak of atoms(v, moov.data, moov.end).filter(a => a.type === 'trak')) {
    const mdia = child(v, trak, 'mdia'); if (!mdia) continue;
    const hdlr = child(v, mdia, 'hdlr');
    if (!hdlr || hdlr.data + 12 > hdlr.end || fourCC(v, hdlr.data + 8) !== 'soun') continue;
    const minf = child(v, mdia, 'minf'); const stbl = minf && child(v, minf, 'stbl'); const stsd = stbl && child(v, stbl, 'stsd');
    if (!stsd || stsd.data + 8 > stsd.end || v.getUint32(stsd.data + 4) !== 1) { audio.push(unknown); continue; }
    const entries = atoms(v, stsd.data + 8, stsd.end);
    if (entries.length !== 1) { audio.push(unknown); continue; }
    const e = entries[0]; const p = e.data;
    if (p + 28 > e.end) { audio.push(unknown); continue; }
    const version = v.getUint16(p + 8);
    const extra = version === 0 ? 0 : version === 1 ? 16 : -1;
    if (extra < 0 || p + 28 + extra > e.end) { audio.push(unknown); continue; }
    const children = atoms(v, p + 28 + extra, e.end);
    if (e.type === 'mp4a') {
      const esds = children.find(a => a.type === 'esds'); const info = esds && aacDescription(v, esds);
      audio.push(info ? { ...unknown, codec: `AAC (${container})`, sampleRate: info.rate, channels: info.channels,
        bitrate: info.bitrate || unknown.bitrate, bitrateKind: info.bitrate > 0 ? 'declared average' : unknown.bitrateKind } : unknown);
    } else if (e.type === 'alac') {
      const config = children.find(a => a.type === 'alac');
      if (!config || config.data + 28 !== config.end || v.getUint8(config.data + 8) !== 0) { audio.push(unknown); continue; }
      const c = config.data + 4; const rate = v.getUint32(c + 20); const channels = v.getUint8(c + 9); const depth = v.getUint8(c + 5);
      audio.push(rate > 0 && channels > 0 && channels <= 8 && [16,20,24,32].includes(depth)
        ? { ...unknown, codec: `ALAC (${container})`, sampleRate: rate, channels, bitDepth: depth } : unknown);
    } else audio.push(unknown);
  }
  // Multiple audio tracks are ambiguous without knowing which track the browser selected.
  return audio.length === 1 ? audio[0] : unknown;
}

export function parseAudioMetadata(buffer: ArrayBuffer, fileSize?: number, duration?: number, originalName = ''): ParsedAudioMetadata {
  const fallback = unknownAudioMetadata(originalName, fileSize, duration);
  const v = new DataView(buffer); const length = v.byteLength;
  if (length < 4) return fallback;
  const signature = fourCC(v, 0);
  if ((signature === 'RIFF' || signature === 'RIFX') && length >= 12 && fourCC(v, 8) === 'WAVE') {
    const unknown = { ...fallback, codec: 'Unknown (WAV)' }; const le = signature === 'RIFF';
    for (let p = 12, count = 0; p + 8 <= length && count++ < 1024;) {
      const size = v.getUint32(p + 4, le);
      if (fourCC(v, p) === 'fmt ') {
        if (size < 16 || size > length - p - 8) return unknown;
        let tag = v.getUint16(p + 8, le); const channels = v.getUint16(p + 10, le); const rate = v.getUint32(p + 12, le); const depth = v.getUint16(p + 22, le);
        if (tag === 0xfffe && size >= 40 && v.getUint16(p + 24, le) >= 22) {
          // Accept only the standard PCM/float subformat GUID, not arbitrary compressed tags.
          const guid = Array.from(new Uint8Array(buffer, p + 32, 16));
          const tail = le ? [0,0,0,0,16,0,128,0,0,170,0,56,155,113] : [0,0,0,0,0,16,128,0,0,170,0,56,155,113];
          if (guid.slice(2).every((b,i) => b === tail[i])) tag = v.getUint16(p + 32, le);
        }
        if (![1,3].includes(tag) || !channels || !rate || !depth) return unknown;
        return { sampleRate: rate, channels, bitDepth: depth, bitrate: Math.round(rate * channels * depth / 1000), bitrateKind: 'PCM', codec: `${tag === 3 ? 'IEEE Float' : 'Linear PCM'} ${depth}-bit (WAV)`, isVBR: false };
      }
      if (size > length - p - 8) break;
      p += 8 + size + (size % 2);
    }
    return unknown;
  }
  if (signature === 'fLaC') {
    const unknown = { ...fallback, codec: 'Unknown (FLAC)' };
    if (length < 42 || (v.getUint8(4) & 127) !== 0 || ((v.getUint8(5) << 16) | (v.getUint8(6) << 8) | v.getUint8(7)) !== 34) return unknown;
    const b20 = v.getUint8(20); const rate = (v.getUint8(18) << 12) | (v.getUint8(19) << 4) | (b20 >> 4);
    const channels = ((b20 >> 1) & 7) + 1; const depth = (((b20 & 1) << 4) | (v.getUint8(21) >> 4)) + 1;
    return rate ? { ...unknown, sampleRate: rate, channels, bitDepth: depth, codec: `FLAC Lossless ${depth}-bit` } : unknown;
  }
  const roots = atoms(v, 0, length);
  // Recognize an ftyp header even when a truncated later atom cannot be traversed.
  const isMp4 = length >= 16 && fourCC(v, 4) === 'ftyp';
  const hint = formatHint(originalName);
  if (isMp4 || hint === 'M4A' || hint === 'MP4') return parseMp4(v, roots, fallback, originalName);
  // Do not scan compressed containers or known non-MP3 files for incidental sync patterns.
  if (signature === 'OggS' || signature === '\u001aE\u00df\u00a3' || (hint && hint !== 'MP3')) return fallback;
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  if (length >= 10 && signature.slice(0,3) === 'ID3') {
    if ([6,7,8,9].some(i => bytes[i] & 128) || bytes[3] < 2 || bytes[3] > 4) return fallback;
    offset = 10 + bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9] + (bytes[3] === 4 && (bytes[5] & 16) ? 10 : 0);
  }
  const frame = (p: number) => {
    if (p + 4 > length || bytes[p] !== 255 || (bytes[p+1] & 224) !== 224) return;
    const version = (bytes[p+1] >> 3) & 3; const layer = (bytes[p+1] >> 1) & 3; const bi = bytes[p+2] >> 4; const si = (bytes[p+2] >> 2) & 3;
    if (version === 1 || layer !== 1 || !bi || bi === 15 || si === 3 || (bytes[p+3] & 3) === 2) return;
    const rate = [44100,48000,32000][si] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bi];
    return { version, rate, bitrate, channels: bytes[p+3] >> 6 === 3 ? 1 : 2, size: Math.floor((version === 3 ? 144000 : 72000) * bitrate / rate) + ((bytes[p+2] >> 1) & 1) };
  };
  let headerVBR: boolean | undefined;
  for (let p = offset; p < Math.min(length - 4, offset + 8192); p++) {
    const a = frame(p); if (!a) continue;
    const b = frame(p + a.size); const c = b && frame(p + a.size + b.size);
    if (!b || !c || p + a.size + b.size + c.size > length || [b,c].some(f => f.version !== a.version || f.rate !== a.rate || f.channels !== a.channels)) continue;
    const sideInfo = a.version === 3 ? (a.channels === 1 ? 17 : 32) : (a.channels === 1 ? 9 : 17);
    const markerOffset = p + 4 + ((bytes[p+1] & 1) ? 0 : 2) + sideInfo;
    const marker = markerOffset + 4 <= p + a.size ? fourCC(v, markerOffset) : '';
    if (marker === 'Info' || marker === 'Xing') {
      headerVBR = marker === 'Xing';
      // This seek/header frame may use a different bitrate; inspect actual audio frames instead.
      p += a.size - 1; continue;
    }
    const variable = headerVBR === true || (headerVBR !== false && (a.bitrate !== b.bitrate || a.bitrate !== c.bitrate));
    return { sampleRate: a.rate, channels: a.channels, bitrate: variable && fallback.bitrate ? fallback.bitrate : a.bitrate,
      bitrateKind: variable && fallback.bitrate ? 'file estimate' : 'frame', codec: `MPEG-${a.version === 3 ? '1' : a.version === 2 ? '2' : '2.5'} Layer 3 (MP3)`, isVBR: variable ? true : headerVBR };
  }
  return fallback;
}

/** Read bounded metadata only. Local MP4 atom headers let us skip mdat to reach a tail moov. */
export async function readAudioFileMetadata(url: string, file: File | undefined, duration?: number): Promise<ParsedAudioMetadata> {
  const name = file?.name || url;
  let buffer: ArrayBuffer; let size = file?.size;
  if (file) buffer = await file.slice(0, MAX_METADATA_BYTES).arrayBuffer();
  else {
    const response = await fetch(url, { headers: { Range: `bytes=0-${MAX_METADATA_BYTES - 1}` } });
    if (!response.ok) throw new Error(`Metadata fetch failed: ${response.status}`);
    const total = response.status === 206 ? response.headers.get('Content-Range')?.match(/\/(\d+)$/)?.[1] : response.headers.get('Content-Length');
    const reportedSize = total ? Number(total) : 0;
    if (Number.isSafeInteger(reportedSize) && reportedSize > 0) size = reportedSize;
    // Servers may ignore Range. Bound the actual stream and cancel the remaining body.
    if (!response.body) return unknownAudioMetadata(name, size, duration);
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (length < MAX_METADATA_BYTES) {
        const result = await reader.read(); if (result.done) break;
        const chunk = result.value.subarray(0, MAX_METADATA_BYTES - length);
        chunks.push(chunk); length += chunk.byteLength;
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    buffer = bytes.buffer;
  }
  let parsed = parseAudioMetadata(buffer, size, duration, name);
  if (!file || buffer.byteLength < 16 || fourCC(new DataView(buffer), 4) !== 'ftyp') return parsed;
  // The atom can be at EOF behind GBs of media. Read headers, not all intervening bytes.
  let readBytes = buffer.byteLength;
  for (let p = 0, count = 0; p + 8 <= file.size && count++ < 512;) {
    const header = await file.slice(p, p + 16).arrayBuffer(); readBytes += header.byteLength;
    if (header.byteLength < 8) break;
    const v = new DataView(header); let atomSize = v.getUint32(0); const type = fourCC(v,4); const headerSize = atomSize === 1 ? 16 : 8;
    if (atomSize === 1) { if (header.byteLength < 16) break; atomSize = v.getUint32(8) * 4294967296 + v.getUint32(12); }
    if (atomSize === 0) atomSize = file.size - p;
    if (!Number.isSafeInteger(atomSize) || atomSize < headerSize || atomSize > file.size - p) break;
    if (type === 'moov') {
      if (p + atomSize <= buffer.byteLength) return parsed;
      if (atomSize > MAX_METADATA_BYTES || readBytes + atomSize > MAX_METADATA_BYTES * 2 + 8192) break;
      const moov = await file.slice(p, p + atomSize).arrayBuffer();
      const view = new DataView(moov);
      parsed = parseMp4(view, atoms(view,0,view.byteLength), unknownAudioMetadata(name,size,duration),name);
      break;
    }
    p += atomSize;
  }
  return parsed;
}
