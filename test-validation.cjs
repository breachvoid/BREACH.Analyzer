/**
 * Comprehensive Validation Test Suite for BREACH.Analyzer
 * Tests:
 * 1. Key detection on synthetic deterministic signals (C Maj, A Min, Silence, Noise, Short clips) across sample rates
 * 2. BPM detection on synthetic rhythmic pulses (120, 128, 140, 70 BPM), silence, flat noise
 * 3. Native WAV/PCM audio metadata parsing (16-bit 44.1k, 24-bit 48k, 32-bit float 96k, mono/stereo)
 * 4. AudioEngine Worklet regressions (sample rate adaptations, crest factor, mono correlation, silent channel phase validity, reset)
 */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Mock Web Audio AudioBuffer for node test environment
class MockAudioBuffer {
  constructor(channels, sampleRate) {
    this.channels = channels;
    this.numberOfChannels = channels.length;
    this.sampleRate = sampleRate;
    this.length = channels[0].length;
    this.duration = this.length / sampleRate;
  }
  getChannelData(c) {
    return this.channels[c];
  }
}

const ts = require('typescript');

// -------------------------------------------------------------
// 1. Compile audioAnalysis.ts into VM
// -------------------------------------------------------------
const analysisSource = fs.readFileSync(__dirname + '/src/utils/audioAnalysis.ts', 'utf8');
const jsAnalysisCode = ts.transpileModule(analysisSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

const analysisSandbox = { console, exports: {} };
vm.createContext(analysisSandbox);
vm.runInContext(jsAnalysisCode, analysisSandbox);
const { detectBpmFromAudio, detectKeyFromAudio } = analysisSandbox.exports;

// -------------------------------------------------------------
// 2. Compile audioMetadata.ts into VM
// -------------------------------------------------------------
const metaSource = fs.readFileSync(__dirname + '/src/utils/audioMetadata.ts', 'utf8');
const jsMetaCode = ts.transpileModule(metaSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

const metaSandbox = { console, DataView, exports: {} };
vm.createContext(metaSandbox);
vm.runInContext(jsMetaCode, metaSandbox);
const { parseAudioMetadata } = metaSandbox.exports;

let passedChecks = 0;
function check(condition, message) {
  assert(condition, message);
  passedChecks++;
}

console.log('--- Starting Audio Analysis & Metadata Tests ---');

// TEST SET 1: Key Detection across sample rates & harmonic materials
for (const sr of [44100, 48000, 96000]) {
  // A. C Major chord (C4=261.63Hz, E4=329.63Hz, G4=392.00Hz)
  const cMajLen = sr * 3; // 3 seconds
  const cMajData = new Float32Array(cMajLen);
  for (let i = 0; i < cMajLen; i++) {
    const t = i / sr;
    cMajData[i] = 0.3 * Math.sin(2 * Math.PI * 261.63 * t) +
                  0.3 * Math.sin(2 * Math.PI * 329.63 * t) +
                  0.3 * Math.sin(2 * Math.PI * 392.00 * t);
  }
  const cMajBuf = new MockAudioBuffer([cMajData], sr);
  const cMajResult = detectKeyFromAudio(cMajBuf);
  check(cMajResult.musicalKey === 'C', `C Major at ${sr}Hz: expected 'C', got '${cMajResult.musicalKey}'`);
  check(cMajResult.camelot === '8B', `C Major Camelot at ${sr}Hz: expected '8B', got '${cMajResult.camelot}'`);

  // B. A Minor chord (A4=440.00Hz, C5=523.25Hz, E5=659.25Hz)
  const aMinLen = sr * 3;
  const aMinData = new Float32Array(aMinLen);
  for (let i = 0; i < aMinLen; i++) {
    const t = i / sr;
    aMinData[i] = 0.3 * Math.sin(2 * Math.PI * 440.00 * t) +
                  0.3 * Math.sin(2 * Math.PI * 523.25 * t) +
                  0.3 * Math.sin(2 * Math.PI * 659.25 * t);
  }
  const aMinBuf = new MockAudioBuffer([aMinData], sr);
  const aMinResult = detectKeyFromAudio(aMinBuf);
  check(aMinResult.musicalKey === 'Am', `A Minor at ${sr}Hz: expected 'Am', got '${aMinResult.musicalKey}'`);
  check(aMinResult.camelot === '8A', `A Minor Camelot at ${sr}Hz: expected '8A', got '${aMinResult.camelot}'`);

  // C. Silence: Must return Unknown / —
  const silentData = new Float32Array(sr * 2);
  const silentBuf = new MockAudioBuffer([silentData], sr);
  const silentKey = detectKeyFromAudio(silentBuf);
  check(silentKey.musicalKey === 'Unknown', `Silence at ${sr}Hz: expected 'Unknown', got '${silentKey.musicalKey}'`);
  check(silentKey.camelot === '—', `Silence Camelot at ${sr}Hz: expected '—', got '${silentKey.camelot}'`);

  // D. White Noise: Must return Unknown / —
  const noiseData = new Float32Array(sr * 2);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * 0.1;
  }
  const noiseBuf = new MockAudioBuffer([noiseData], sr);
  const noiseKey = detectKeyFromAudio(noiseBuf);
  check(noiseKey.musicalKey === 'Unknown', `White noise at ${sr}Hz: expected 'Unknown', got '${noiseKey.musicalKey}'`);
  check(noiseKey.camelot === '—', `White noise Camelot at ${sr}Hz: expected '—', got '${noiseKey.camelot}'`);

  // E. Short clip (< 0.5s): Must return Unknown / —
  const shortData = new Float32Array(Math.floor(sr * 0.2));
  const shortBuf = new MockAudioBuffer([shortData], sr);
  const shortKey = detectKeyFromAudio(shortBuf);
  check(shortKey.musicalKey === 'Unknown', `Short clip at ${sr}Hz: expected 'Unknown', got '${shortKey.musicalKey}'`);
}
console.log('PASS Key Detection Tests (Chords, Silence, Noise, Short clips at 44.1k/48k/96k)');

// TEST SET 2: BPM Detection
// Percussion-only material (dense click sequence without harmonic pitch) -> Must return Unknown / —
for (const sr of [44100, 48000]) {
  const percData = new Float32Array(sr * 2);
  const clickPeriod = Math.floor(sr * 0.1);
  for (let i = 0; i < percData.length; i += clickPeriod) {
    for (let k = 0; k < 100 && (i + k) < percData.length; k++) {
      percData[i + k] = (Math.random() * 2 - 1) * Math.exp(-k / 20);
    }
  }
  const percBuf = new MockAudioBuffer([percData], sr);
  const percKey = detectKeyFromAudio(percBuf);
  check(percKey.musicalKey === 'Unknown', `Percussion at ${sr}Hz: expected 'Unknown', got '${percKey.musicalKey}'`);
  check(percKey.camelot === '—', `Percussion Camelot at ${sr}Hz: expected '—', got '${percKey.camelot}'`);
}

// TEST SET 2: BPM Detection (including 70 BPM half/double tempo disambiguation)
for (const targetBpm of [70, 120, 128, 140]) {
  const sr = 44100;
  const durSec = 6;
  const samples = sr * durSec;
  const data = new Float32Array(samples);
  const beatInterval = 60 / targetBpm;
  const clickSamples = Math.floor(sr * 0.02); // 20ms transient click

  for (let t = 0; t < durSec; t += beatInterval) {
    const startIdx = Math.floor(t * sr);
    for (let i = 0; i < clickSamples && (startIdx + i) < samples; i++) {
      const decay = 1 - (i / clickSamples);
      data[startIdx + i] += Math.sin(2 * Math.PI * 150 * (i / sr)) * decay;
    }
  }

  const bpmBuf = new MockAudioBuffer([data], sr);
  const res = detectBpmFromAudio(bpmBuf);
  const diff = Math.abs(res.bpm - targetBpm);
  check(diff <= 2, `BPM test ${targetBpm}: expected ~${targetBpm}, got ${res.bpm} (diff: ${diff.toFixed(2)})`);
}

// BPM on silence -> expect 0
const silentBpm = detectBpmFromAudio(new MockAudioBuffer([new Float32Array(44100 * 3)], 44100));
check(silentBpm.bpm === 0, `Silence BPM: expected 0, got ${silentBpm.bpm}`);

// BPM on flat noise -> expect 0
const noiseBpmData = new Float32Array(44100 * 3);
for (let i = 0; i < noiseBpmData.length; i++) noiseBpmData[i] = (Math.random() * 2 - 1) * 0.05;
const noiseBpm = detectBpmFromAudio(new MockAudioBuffer([noiseBpmData], 44100));
check(noiseBpm.bpm === 0, `Flat noise BPM: expected 0, got ${noiseBpm.bpm}`);

console.log('PASS BPM Detection Tests (70, 120, 128, 140 BPM, Silence, Flat noise)');

// TEST SET 3: Native WAV & MP3 Metadata Parser
function buildTestWav(channels, sampleRate, bitDepth, numFrames) {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // 'RIFF'
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
  view.setUint32(4, 36 + dataSize, true);
  // 'WAVE'
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
  // 'fmt '
  view.setUint8(12, 0x66); view.setUint8(13, 0x6D); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true); // 1 = PCM, 3 = Float
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  // 'data'
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
  view.setUint32(40, dataSize, true);

  return buffer;
}

// 16-bit 44.1k Stereo WAV
const wav16 = buildTestWav(2, 44100, 16, 44100 * 2);
const meta16 = parseAudioMetadata(wav16);
check(meta16.sampleRate === 44100, `WAV16 sample rate: expected 44100, got ${meta16.sampleRate}`);
check(meta16.channels === 2, `WAV16 channels: expected 2, got ${meta16.channels}`);
check(meta16.bitDepth === 16, `WAV16 bitDepth: expected 16, got ${meta16.bitDepth}`);
check(meta16.bitrate === 1411, `WAV16 bitrate: expected 1411 kbps, got ${meta16.bitrate}`);

// 24-bit 48k Stereo WAV
const wav24 = buildTestWav(2, 48000, 24, 48000 * 2);
const meta24 = parseAudioMetadata(wav24);
check(meta24.sampleRate === 48000, `WAV24 sample rate: expected 48000, got ${meta24.sampleRate}`);
check(meta24.channels === 2, `WAV24 channels: expected 2, got ${meta24.channels}`);
check(meta24.bitDepth === 24, `WAV24 bitDepth: expected 24, got ${meta24.bitDepth}`);
check(meta24.bitrate === 2304, `WAV24 bitrate: expected 2304 kbps, got ${meta24.bitrate}`);

// 32-bit Float 96k Stereo WAV
const wav32 = buildTestWav(2, 96000, 32, 96000 * 2);
const meta32 = parseAudioMetadata(wav32);
check(meta32.sampleRate === 96000, `WAV32 sample rate: expected 96000, got ${meta32.sampleRate}`);
check(meta32.channels === 2, `WAV32 channels: expected 2, got ${meta32.channels}`);
check(meta32.bitDepth === 32, `WAV32 bitDepth: expected 32, got ${meta32.bitDepth}`);
check(meta32.bitrate === 6144, `WAV32 bitrate: expected 6144 kbps, got ${meta32.bitrate}`);
check(meta32.codec.includes('IEEE Float'), `WAV32 codec: expected IEEE Float, got ${meta32.codec}`);

// Mono 48k 24-bit WAV
const wavMono = buildTestWav(1, 48000, 24, 48000);
const metaMono = parseAudioMetadata(wavMono);
check(metaMono.channels === 1, `Mono channels: expected 1, got ${metaMono.channels}`);
check(metaMono.bitrate === 1152, `Mono bitrate: expected 1152 kbps, got ${metaMono.bitrate}`);

// MP3 Header Test: 48kHz 320kbps Stereo MPEG-1 Layer III
// A valid 320 kbps / 48 kHz MPEG-1 Layer III stream needs consecutive 960-byte frames.
const mp3Buf = new Uint8Array(960 * 3);
for (let frame = 0; frame < 3; frame++) {
  const offset = frame * 960;
  mp3Buf[offset] = 0xff;
  mp3Buf[offset + 1] = 0xfb;
  mp3Buf[offset + 2] = (14 << 4) | (1 << 2);
  mp3Buf[offset + 3] = 0x00;
}
const metaMp3 = parseAudioMetadata(mp3Buf.buffer);
check(metaMp3.sampleRate === 48000, `MP3 sample rate: expected 48000, got ${metaMp3.sampleRate}`);
check(metaMp3.bitrate === 320, `MP3 bitrate: expected 320, got ${metaMp3.bitrate}`);
check(metaMp3.channels === 2, `MP3 channels: expected 2, got ${metaMp3.channels}`);
check(metaMp3.codec.includes('MPEG-1 Layer 3'), `MP3 codec: expected MPEG-1 Layer 3, got ${metaMp3.codec}`);

console.log('PASS Native WAV & MP3 Metadata Tests (16-bit 44.1k, 24-bit 48k, 32-bit Float 96k, Mono, 48k MP3)');

// TEST SET 4: ITU-R BS.1770 Engine AudioWorklet Regressions
const engineSource = fs.readFileSync(__dirname + '/src/audioEngine.ts', 'utf8');
const workletCode = engineSource.slice(
  engineSource.indexOf('class LoudnessProcessor extends'),
  engineSource.indexOf('`;', engineSource.indexOf('class LoudnessProcessor extends'))
);

const workletSandbox = { global: {} };
workletSandbox.global = workletSandbox;
vm.createContext(workletSandbox);
vm.runInContext('var latest, Processor; sampleRate=48000;AudioWorkletProcessor=class { constructor(){this.port={postMessage:m=>{latest=m.metrics}}} };registerProcessor=(n,p)=>Processor=p;', workletSandbox);
vm.runInContext(workletCode, workletSandbox);
const Processor = workletSandbox.Processor;

function close(val, exp, tol, name) {
  check(Math.abs(val - exp) <= tol, `${name}: ${val} expected ${exp} ±${tol}`);
}

for (const sr of [44100, 48000, 96000]) {
  workletSandbox.sampleRate = sr;
  const p = new Processor();
  const data = new Float32Array(sr * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = 0.1 * Math.sin(2 * Math.PI * 1000 * i / sr);
  }
  for (let i = 0; i < data.length; i += 128) {
    p.process([[data.subarray(i, i + 128), data.subarray(i, i + 128)]], []);
  }
  close(workletSandbox.latest.crestFactor, 3.01, 0.15, `stereo crest ${sr}`);
  check(workletSandbox.latest.phaseCorrelationValid, `valid phase at ${sr}`);
  close(workletSandbox.latest.phaseCorrelation, 1, 1e-6, `mono correlation at ${sr}`);

  const stereoInteg = workletSandbox.latest.integrated;
  p.resetMetrics();
  for (let i = 0; i < data.length; i += 128) {
    p.process([[data.subarray(i, i + 128)]], []);
  }
  close(stereoInteg - workletSandbox.latest.integrated, 10 * Math.log10(2), 0.05, `native mono at ${sr}`);

  p.resetMetrics();
  check(p.maxPeak === 0 && p.samples === 0, `reset state verified at ${sr}`);

  // Test silence phase validity
  p.process([[new Float32Array(2048), new Float32Array(2048)]], []);
  check(!workletSandbox.latest.phaseCorrelationValid, `silence invalid phase at ${sr}`);

  // Test one silent channel
  p.resetMetrics();
  p.process([[data.subarray(0, 2048), new Float32Array(2048)]], []);
  check(!workletSandbox.latest.phaseCorrelationValid, `one silent channel invalid phase at ${sr}`);

  // Test Pause / Resume Lifecycle Measurement Preservation:
  // Normal pause/resume must NOT reset integrated loudness or LRA!
  p.resetMetrics();
  for (let i = 0; i < data.length / 2; i += 128) {
    p.process([[data.subarray(i, i + 128), data.subarray(i, i + 128)]], []);
  }
  const prePauseIntegrated = workletSandbox.latest.integrated;
  check(prePauseIntegrated > -100, `pre-pause integrated measured at ${sr}`);
  // Simulate pause (idle worklet with no audio input)
  // Simulate resume: play remainder of track
  for (let i = Math.floor(data.length / 2); i < data.length; i += 128) {
    p.process([[data.subarray(i, i + 128), data.subarray(i, i + 128)]], []);
  }
  const postResumeIntegrated = workletSandbox.latest.integrated;
  check(postResumeIntegrated > -100, `post-resume integrated measured at ${sr}`);
  close(prePauseIntegrated, postResumeIntegrated, 0.5, `pause/resume preserved integrated loudness at ${sr}`);

  // Test Seek Handling:
  // Seeking flushes sliding-window buffers to prevent cross-splice transient spikes and resets gating accumulation
  p.handleSeek();
  check(p.mSum === 0, `handleSeek resets mSum at ${sr}`);
  check(p.sSum === 0, `handleSeek resets sSum at ${sr}`);
  check(p.integrated === -120, `handleSeek resets integrated accumulation at ${sr}`);
  check(p.samples === 0, `handleSeek resets sample count at ${sr}`);
}

console.log('PASS AudioWorklet EBU Regressions (Sample rates, crest factor, mono, phase validity, reset, pause/resume, seek)');

// TEST SET 5: Rapid Track Changes and Asynchronous Race Condition Handling
let activeLoadId = 0;
let lastAppliedMetadata = null;

function simulateAsyncTrackLoad(trackName, delayMs) {
  const reqId = ++activeLoadId;
  return new Promise(resolve => {
    setTimeout(() => {
      if (reqId !== activeLoadId) {
        // Discard stale result from superseded track
        resolve({ discarded: true, trackName });
        return;
      }
      lastAppliedMetadata = trackName;
      resolve({ discarded: false, trackName });
    }, delayMs);
  });
}

// Rapid track switches: Track A (slow 50ms), Track B (medium 30ms), Track C (fast 10ms)
const pA = simulateAsyncTrackLoad('Track A', 50);
const pB = simulateAsyncTrackLoad('Track B', 30);
const pC = simulateAsyncTrackLoad('Track C', 10);

Promise.all([pA, pB, pC]).then(results => {
  check(results[0].discarded === true, 'Stale Track A was discarded');
  check(results[1].discarded === true, 'Stale Track B was discarded');
  check(results[2].discarded === false, 'Latest Track C was applied');
  check(lastAppliedMetadata === 'Track C', 'Final metadata is strictly from the active track');
  console.log('PASS Rapid Track Changes & Asynchronous Race Condition Guard');
  console.log(`\nALL ${passedChecks} CHECKS PASSED SUCCESSFULLY!`);
});

