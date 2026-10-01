/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { AudioSourceType, GeneratorSignalType, LoudnessMetrics } from './types';
import { AudioFileRegistry, fetchPartialArrayBuffer, getAudioFileSize } from './utils';
import { parseAudioMetadata } from './utils/audioMetadata';

export class AudioAnalyzerEngine {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | OscillatorNode | AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserLeft: AnalyserNode | null = null;
  private analyserRight: AnalyserNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private loudnessAnalyser: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;
  private dummyGain: GainNode | null = null;
  private preAnalysisGain: GainNode | null = null;
  private workletRegistrationPromises = new WeakMap<AudioContext, Promise<void>>();

  // Filter nodes for K-weighting (ITU-R BS.1770)

  // Media streams and elements
  private micStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private mediaNodesCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
  private loadRequestId: number = 0;
  
  // Custom synth nodes (ambient drone)
  private synthNodes: {
    osc1: OscillatorNode;
    osc2: OscillatorNode;
    lfo: OscillatorNode;
    lfoGain: GainNode;
    filter: BiquadFilterNode;
    voiceGain: GainNode;
  }[] = [];

  // Generator properties
  private generatorGain: GainNode | null = null;
  private generatorOsc: OscillatorNode | null = null;
  private generatorNoiseBufferSource: AudioBufferSourceNode | null = null;
  private generatorTimer: number | null = null;

  // Loudness tracking buffers
  private bufSize = 2048;
  private momentaryHistory: number[] = []; // powers over 400ms
  private shortTermHistory: number[] = [];  // powers over 3s
  private shortTermLUFSHistory: number[] = []; // historical short-term LUFS values for LRA
  private gatingBlocks: number[] = [];      // 400ms powers collected for Integrated Loudness

  // Real EBU R128 overlapping structures
  private rawBufferHistory: { power: number; samples: number }[] = [];
  private samplesSinceLastGating = 0;
  private _blockCount = 0;
  
  // Loudness statistics (resettable)
  private maxMomentary = -120;
  private maxShortTerm = -120;
  private maxPeak = -120;
  private maxPeakLeft = -120;
  private maxPeakRight = -120;
  private smoothedPhaseCorrelation = 1.0;
  private currentMetrics: LoudnessMetrics;

  // Listeners for updates
  private metricsListeners: ((metrics: LoudnessMetrics) => void)[] = [];
  private stateChangeListeners: ((isActive: boolean) => void)[] = [];

  // Metadata properties indicating active input sampleRate, buffer size, bitrate, and format/codec
  private activeMetadata = {
    sampleRate: 48000,
    bufferSize: 2048,
    bitrate: 2304,
    codec: 'Synth Signal',
    channelCount: 2 as number | undefined,
    trackChannelCount: undefined as number | undefined,
    splitterInputChannelCount: undefined as number | undefined,
    bitDepth: undefined as number | undefined,
    isVBR: false as boolean | undefined
  };
  private metadataListeners: ((meta: typeof this.activeMetadata) => void)[] = [];

  public getMetadata() {
    return this.activeMetadata;
  }

  public registerMetadataListener(callback: (meta: typeof this.activeMetadata) => void) {
    this.metadataListeners.push(callback);
    callback(this.activeMetadata); // immediate initial call
    return () => {
      this.metadataListeners = this.metadataListeners.filter(l => l !== callback);
    };
  }

  public updateMetadata(meta: Partial<typeof this.activeMetadata>) {
    this.activeMetadata = { ...this.activeMetadata, ...meta };
    this.metadataListeners.forEach(l => l(this.activeMetadata));
  }

  // Controls
  private currentSourceType: AudioSourceType = AudioSourceType.GENERATOR;
  private currentGenType: GeneratorSignalType = GeneratorSignalType.SINE;
  private generatorFrequency = 440;
  private sourceActive = false;
  private masterVolume = 0.5;
  private outputMuted = false;
  private outputBypassed = false;

  constructor() {
    this.currentMetrics = this.getEmptyMetrics();
  }

  private getEmptyMetrics(): LoudnessMetrics {
    return {
      momentary: -120,
      shortTerm: -120,
      integrated: -120,
      lra: 0,
      maxMomentary: -120,
      maxShortTerm: -120,
      peakLeft: -120,
      peakRight: -120,
      maxPeak: -120,
      crestFactor: 0,
      phaseCorrelation: 0,
      phaseCorrelationValid: false
    };
  }

  public registerMetricsListener(callback: (metrics: LoudnessMetrics) => void) {
    this.metricsListeners.push(callback);
    return () => {
      this.metricsListeners = this.metricsListeners.filter(l => l !== callback);
    };
  }

  public registerStateListener(callback: (isActive: boolean) => void) {
    this.stateChangeListeners.push(callback);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter(l => l !== callback);
    };
  }

  private notifyState() {
    this.stateChangeListeners.forEach(l => l(this.sourceActive));
  }

  public initContext(): AudioContext {
    if (!this.audioContext) {
      // Create audio context
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
    }
    return this.audioContext;
  }

  public getContext(): AudioContext | null {
    return this.audioContext;
  }

  public getAudioElement(): HTMLAudioElement | null {
    return this.audioElement;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public getStereoAnalysers(): { left: AnalyserNode | null; right: AnalyserNode | null } {
    return { left: this.analyserLeft, right: this.analyserRight };
  }

  public getSourceType(): AudioSourceType {
    return this.currentSourceType;
  }

  public isSourceActive(): boolean {
    return this.sourceActive;
  }

  public getVolume(): number {
    return this.masterVolume;
  }

  public isMuted(): boolean {
    return this.outputMuted;
  }

  public isBypassed(): boolean {
    return this.outputBypassed;
  }

  public setVolume(vol: number) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(this.outputMuted ? 0 : this.masterVolume, this.audioContext!.currentTime);
    }
  }

  public setMuted(muted: boolean) {
    this.outputMuted = muted;
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(muted ? 0 : this.masterVolume, this.audioContext!.currentTime);
    }
  }

  public setBypassed(bypassed: boolean) {
    this.outputBypassed = bypassed;
    this.connectOutput();
  }

  private connectOutput() {
    if (this.gainNode && this.audioContext) {
      try {
        this.gainNode.disconnect(this.audioContext.destination);
      } catch (e) {}
      if (!this.outputBypassed) {
        try {
          this.gainNode.connect(this.audioContext.destination);
        } catch (e) {
          console.warn('Failed to connect output gainNode:', e);
        }
      }
    }
  }

  /**
   * Reset the integrated metrics (Integrated LUFS, Max Momentary, Max Short term, Max Peak)
   */
  public resetMetrics() {
    this.maxMomentary = -120;
    this.maxShortTerm = -120;
    this.maxPeak = -120;
    this.maxPeakLeft = -120;
    this.maxPeakRight = -120;
    this.gatingBlocks = [];
    this.shortTermLUFSHistory = [];
    this.rawBufferHistory = [];
    this.samplesSinceLastGating = 0;
    this._blockCount = 0;
    this.currentMetrics = this.getEmptyMetrics();
    
    if (this.loudnessAnalyser) {
      this.loudnessAnalyser.port.postMessage({ type: 'RESET' });
    } else {
      this.metricsListeners.forEach(l => l(this.currentMetrics));
    }
  }

  /**
   * Pause playback without destroying the audio pipeline or resetting accumulated metrics
   */
  public pause() {
    if (this.audioElement) {
      this.audioElement.pause();
    }
    this.sourceActive = false;
    this.notifyState();
  }

  /**
   * Handles user seeking: flushes sliding-window buffers to prevent splice transients
   * and resets continuous measurement accumulation to prevent mixing disjoint audio segments.
   */
  public handleSeek() {
    this.momentaryHistory = [];
    this.shortTermHistory = [];
    this.gatingBlocks = [];
    if (this.loudnessAnalyser) {
      this.loudnessAnalyser.port.postMessage({ type: 'SEEK' });
    }
  }

  /**
   * Start a specified source stream
   */
  public async startSource(sourceType: AudioSourceType, options?: { element?: HTMLAudioElement; generatorType?: GeneratorSignalType; freq?: number; deviceId?: string }) {
    this.initContext();
    if (this.audioContext!.state === 'suspended') {
      await this.audioContext!.resume();
    }

    // If resuming playback on the already active audio element with a healthy pipeline,
    // preserve the AudioWorklet and accumulated ITU-R BS.1770 / EBU R128 metrics!
    if (
      sourceType === AudioSourceType.AUDIO_FILE &&
      options?.element &&
      this.currentSourceType === AudioSourceType.AUDIO_FILE &&
      this.audioElement === options.element &&
      this.sourceNode &&
      this.loudnessAnalyser
    ) {
      this.sourceActive = true;
      this.notifyState();
      return;
    }

    // Stop current active nodes
    this.stopCurrent();

    this.currentSourceType = sourceType;
    this.sourceActive = true;

    try {
      // Ensure AudioWorklet is registered before building pipeline
      await this.ensureWorkletRegistered(this.audioContext!);

      // Build main analyzer pipeline
      this.buildPipeline();

      switch (sourceType) {
        case AudioSourceType.MICROPHONE:
          await this.setupMicrophone(options?.deviceId);
          const micSettings = this.micStream?.getAudioTracks()[0]?.getSettings();
          this.updateMetadata({
            sampleRate: this.audioContext?.sampleRate || 48000,
            bufferSize: this.bufSize,
            bitrate: 1411,
            codec: 'Raw Stream',
            channelCount: micSettings?.channelCount ?? 1,
            trackChannelCount: micSettings?.channelCount ?? 1,
            splitterInputChannelCount: this.preAnalysisGain?.channelCount ?? 2
          });
          break;
        case AudioSourceType.SYSTEM_CAPTURE:
          await this.setupSystemCapture();
          const pSettings = this.screenStream?.getAudioTracks()[0]?.getSettings();
          this.updateMetadata({
            sampleRate: this.audioContext?.sampleRate || 48000,
            bufferSize: this.bufSize,
            bitrate: 1411,
            codec: 'System Capture',
            channelCount: pSettings?.channelCount ?? 1,
            trackChannelCount: pSettings?.channelCount ?? 1,
            splitterInputChannelCount: this.preAnalysisGain?.channelCount ?? 2
          });
          break;
        case AudioSourceType.AUDIO_FILE:
          if (options?.element) {
            this.setupAudioElement(options.element);
          } else {
            throw new Error('No audio element provided for file playback');
          }
          break;
        case AudioSourceType.GENERATOR:
          const genType = options?.generatorType || this.currentGenType;
          const freq = options?.freq !== undefined ? options.freq : this.generatorFrequency;
          this.setupGenerator(genType, freq);
          this.updateMetadata({
            sampleRate: this.audioContext?.sampleRate || 48000,
            bufferSize: this.bufSize,
            bitrate: 2304,
            codec: 'Synth Signal',
            trackChannelCount: 2, // The noise/osc generators are configured as stereo pipelines (e.g., gain nodes with 2 outputs)
            splitterInputChannelCount: this.preAnalysisGain?.channelCount ?? 2
          });
          break;
      }

      this.notifyState();
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const isFeaturePolicyError = errMsg.includes('display-capture') || errMsg.includes('permissions policy') || errMsg.includes('disallowed');
      if (isFeaturePolicyError) {
        console.warn('System capture blocked by sandbox permissions policy in this preview environment:', err);
      } else {
        console.error('Failed to start source:', err);
      }
      this.stopCurrent();
      throw err;
    }
  }

  /**
   * Stop analyzing and playing
   */
  public stop() {
    this.stopCurrent();
    this.notifyState();
  }

  private stopCurrent() {
    this.sourceActive = false;

    // Disconnect synth drone
    this.stopDroneSynth();

    // Stop generator oscillators or buffer sources
    if (this.generatorOsc) {
      try {
        this.generatorOsc.stop();
      } catch (e) {}
      this.generatorOsc.disconnect();
      this.generatorOsc = null;
    }
    if (this.generatorNoiseBufferSource) {
      try {
        this.generatorNoiseBufferSource.stop();
      } catch (e) {}
      this.generatorNoiseBufferSource.disconnect();
      this.generatorNoiseBufferSource = null;
    }
    if (this.generatorGain) {
      try {
        this.generatorGain.disconnect();
      } catch (e) {}
      this.generatorGain = null;
    }
    if (this.generatorTimer) {
      window.clearInterval(this.generatorTimer);
      this.generatorTimer = null;
    }

    // Stop microphone stream
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => {
        track.onended = null;
        track.stop();
      });
      this.micStream = null;
    }

    // Stop screen/tab capture stream
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => {
        track.onended = null;
        track.stop();
      });
      this.screenStream = null;
    }

    // Pause audio element if active
    if (this.audioElement) {
      this.audioElement.pause();
    }

    // Disconnect source node
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {}
      this.sourceNode = null;
    }

    // Clean up analysis blocks
    if (this.loudnessAnalyser) {
      this.loudnessAnalyser.port.onmessage = null;
      try {
        this.loudnessAnalyser.disconnect();
      } catch (e) {}
      this.loudnessAnalyser = null;
    }
    if (this.dummyGain) {
      try {
        this.dummyGain.disconnect();
      } catch (e) {}
      this.dummyGain = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch (e) {}
      this.analyser = null;
    }
    if (this.analyserLeft) {
      try {
        this.analyserLeft.disconnect();
      } catch (e) {}
      this.analyserLeft = null;
    }
    if (this.analyserRight) {
      try {
        this.analyserRight.disconnect();
      } catch (e) {}
      this.analyserRight = null;
    }
    if (this.splitter) {
      try {
        this.splitter.disconnect();
      } catch (e) {}
      this.splitter = null;
    }
    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch (e) {}
      this.gainNode = null;
    }
    if (this.preAnalysisGain) {
      try {
        this.preAnalysisGain.disconnect();
      } catch (e) {}
      this.preAnalysisGain = null;
    }
  }

  private async ensureWorkletRegistered(ctx: AudioContext): Promise<void> {
    if (!ctx.audioWorklet) {
      console.warn('AudioWorklet is not supported or accessible in this environment.');
      return;
    }
    if (this.workletRegistrationPromises.has(ctx)) {
      return this.workletRegistrationPromises.get(ctx)!;
    }

    const promise = (async () => {
      const workletCode = `
class LoudnessProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mSize = Math.round(sampleRate * 0.4);
    this.sSize = Math.round(sampleRate * 3);
    this.hop = Math.round(sampleRate * 0.1);
    this.powerRing = new Float64Array(this.sSize);
    // BS.1770 Annex 2: four-phase interpolation, continuous across render quanta.
    this.tp = [
      [0.001708984375,0.010986328125,-0.0196533203125,0.033203125,-0.0594482421875,0.1373291015625,0.97216796875,-0.102294921875,0.047607421875,-0.026611328125,0.014892578125,-0.00830078125],
      [-0.0291748046875,0.029296875,-0.0517578125,0.089111328125,-0.16650390625,0.465087890625,0.77978515625,-0.2003173828125,0.1015625,-0.0582275390625,0.0330810546875,-0.0189208984375],
      [-0.0189208984375,0.0330810546875,-0.0582275390625,0.1015625,-0.2003173828125,0.77978515625,0.465087890625,-0.16650390625,0.089111328125,-0.0517578125,0.029296875,-0.0291748046875],
      [-0.00830078125,0.014892578125,-0.026611328125,0.047607421875,-0.102294921875,0.97216796875,0.1373291015625,-0.0594482421875,0.033203125,-0.0196533203125,0.010986328125,0.001708984375]
    ];
    // Equivalent analogue response, adapted to the context sample rate.
    const shelfK = Math.tan(Math.PI * 1681.974450955533 / sampleRate);
    const vh = Math.pow(10, 3.999843853973347 / 20);
    const vb = Math.pow(vh, 0.4996667741545416);
    const q = 0.7071752369554196;
    const a0 = 1 + shelfK / q + shelfK * shelfK;
    this.shelf = [(vh + vb * shelfK / q + shelfK * shelfK) / a0,
      2 * (shelfK * shelfK - vh) / a0,
      (vh - vb * shelfK / q + shelfK * shelfK) / a0,
      2 * (shelfK * shelfK - 1) / a0,
      (1 - shelfK / q + shelfK * shelfK) / a0];
    const hpK = Math.tan(Math.PI * 38.13547087602444 / sampleRate);
    const hpQ = 0.5003270373238773;
    const hpA0 = 1 + hpK / hpQ + hpK * hpK;
    this.highpass = [1, -2, 1, 2 * (hpK * hpK - 1) / hpA0,
      (1 - hpK / hpQ + hpK * hpK) / hpA0];
    this.channels = [];
    this.resetMetrics();
    this.port.onmessage = event => {
      if (event.data.type === 'RESET') this.resetMetrics();
      if (event.data.type === 'SEEK') this.handleSeek();
    };
  }

  handleSeek() {
    this.powerRing.fill(0);
    this.position = 0;
    this.samples = 0;
    this.samplesSinceMessage = 0;
    this.mSum = 0;
    this.sSum = 0;
    this.maxM = 0;
    this.maxS = 0;
    this.sLL = 0;
    this.sRR = 0;
    this.sLR = 0;
    for (let c = 0; c < this.channels.length; c++) {
      this.channels[c].shelf.fill(0);
      this.channels[c].hp.fill(0);
      this.channels[c].history.fill(0);
      this.channels[c].position = 0;
      this.channels[c].squareSum = 0;
      this.channels[c].framePeak = 0;
    }
    this.gateCounts.fill(0);
    this.gatePowers.fill(0);
    this.lraCounts.fill(0);
    this.lraPowers.fill(0);
    this.integrated = -120;
    this.lra = 0;
  }

  resetMetrics() {
    this.powerRing.fill(0);
    this.position = 0;
    this.samples = 0;
    this.samplesSinceMessage = 0;
    this.mSum = 0;
    this.sSum = 0;
    this.maxM = 0;
    this.maxS = 0;
    this.maxPeak = 0;
    this.integrated = -120;
    this.lra = 0;
    this.sLL = 0;
    this.sRR = 0;
    this.sLR = 0;
    this.alpha = 1 - Math.exp(-1 / (0.25 * sampleRate));
    // Counts AND exact power sums avoid reconstructing loudness from bin centres.
    this.gateCounts = new Uint32Array(14001);
    this.gatePowers = new Float64Array(14001);
    this.lraCounts = new Uint32Array(14001);
    this.lraPowers = new Float64Array(14001);
    this.channels = [];
  }

  loudness(power) { return power > 1e-12 ? -0.691 + 10 * Math.log10(power) : -120; }
  db(amplitude) { return amplitude > 1e-6 ? 20 * Math.log10(amplitude) : -120; }
  bin(power) { return Math.max(0, Math.min(14000, Math.floor((this.loudness(power) + 120) * 100))); }

  addPower(power, counts, powers) {
    if (this.loudness(power) < -70) return;
    const index = this.bin(power);
    counts[index]++;
    powers[index] += power;
  }

  gated(counts, powers, relativeGate) {
    let count = 0, sum = 0;
    for (let i = 5000; i < counts.length; i++) { count += counts[i]; sum += powers[i]; }
    if (!count) return { loudness: -120, start: 5000, count: 0 };
    const threshold = Math.max(-70, this.loudness(sum / count) + relativeGate);
    const start = Math.ceil((threshold + 120) * 100);
    count = 0; sum = 0;
    for (let i = start; i < counts.length; i++) { count += counts[i]; sum += powers[i]; }
    return { loudness: count ? this.loudness(sum / count) : -120, start, count };
  }

  updateStatistics() {
    this.integrated = this.gated(this.gateCounts, this.gatePowers, -10).loudness;
    const range = this.gated(this.lraCounts, this.lraPowers, -20);
    if (range.count) {
      let cumulative = 0, low = null, high = null;
      for (let i = range.start; i < this.lraCounts.length; i++) {
        cumulative += this.lraCounts[i];
        if (low === null && cumulative >= Math.max(1, Math.ceil(range.count * 0.1))) low = i;
        if (cumulative >= Math.max(1, Math.ceil(range.count * 0.95))) { high = i; break; }
      }
      this.lra = low !== null && high !== null ? (high - low) / 100 : 0;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const count = input.length;
    while (this.channels.length < count) {
      this.channels.push({ shelf: new Float64Array(2), hp: new Float64Array(2),
        history: new Float64Array(12), position: 0, peak: 0, framePeak: 0, squareSum: 0 });
    }
    const b = this.shelf, h = this.highpass;
    let statisticsUpdated = false;
    for (let i = 0; i < input[0].length; i++) {
      let power = 0;
      for (let c = 0; c < count; c++) {
        const channel = this.channels[c], x = input[c][i];
        const shelf = b[0] * x + channel.shelf[0];
        channel.shelf[0] = b[1] * x - b[3] * shelf + channel.shelf[1];
        channel.shelf[1] = b[2] * x - b[4] * shelf;
        const weighted = h[0] * shelf + channel.hp[0];
        channel.hp[0] = h[1] * shelf - h[3] * weighted + channel.hp[1];
        channel.hp[1] = h[2] * shelf - h[4] * weighted;
        // Native WAV/Web Audio order: L R C [LFE] Ls Rs.
        const weight = count === 6 && c === 3 ? 0 : (count === 5 && c >= 3) || (count === 6 && c >= 4) ? 1.41 : 1;
        power += weight * weighted * weighted;
        channel.squareSum += x * x;
        channel.framePeak = Math.max(channel.framePeak, Math.abs(x));
        let peak = Math.abs(x);
        channel.history[channel.position] = x;
        for (let phase = 0; phase < 4; phase++) {
          let interpolated = 0;
          for (let tap = 0; tap < 12; tap++) {
            interpolated += this.tp[phase][tap] * channel.history[(channel.position - tap + 12) % 12];
          }
          peak = Math.max(peak, Math.abs(interpolated));
        }
        channel.position = (channel.position + 1) % 12;
        channel.peak = Math.max(channel.peak, peak);
        this.maxPeak = Math.max(this.maxPeak, peak);
      }
      const left = input[0][i], right = count === 1 ? left : input[1][i];
      this.sLL += this.alpha * (left * left - this.sLL);
      this.sRR += this.alpha * (right * right - this.sRR);
      this.sLR += this.alpha * (left * right - this.sLR);
      const delayedM = (this.position - this.mSize + this.sSize) % this.sSize;
      this.mSum += power - this.powerRing[delayedM];
      this.sSum += power - this.powerRing[this.position];
      this.powerRing[this.position] = power;
      this.position = (this.position + 1) % this.sSize;
      this.samples++;
      if (this.samples >= this.mSize) this.maxM = Math.max(this.maxM, this.mSum / this.mSize);
      if (this.samples >= this.sSize) this.maxS = Math.max(this.maxS, this.sSum / this.sSize);
      if (this.samples >= this.mSize && (this.samples - this.mSize) % this.hop === 0) {
        this.addPower(Math.max(0, this.mSum / this.mSize), this.gateCounts, this.gatePowers);
        if (this.samples >= this.sSize) this.addPower(Math.max(0, this.sSum / this.sSize), this.lraCounts, this.lraPowers);
        this.updateStatistics();
        statisticsUpdated = true;
      }
    }
    this.samplesSinceMessage += input[0].length;
    // Keep display traffic near the original rate; always publish completed gating blocks.
    if (this.samplesSinceMessage < 2048 && !statisticsUpdated) return true;
    const validPhase = count > 1 && this.sLL > 1e-12 && this.sRR > 1e-12;
    let crest = 0;
    for (let c = 0; c < count; c++) {
      const channel = this.channels[c];
      if (channel.squareSum > 1e-12) crest = Math.max(crest,
        this.db(channel.framePeak) - 10 * Math.log10(channel.squareSum / this.samplesSinceMessage));
      channel.squareSum = 0; channel.framePeak = 0;
    }
    this.samplesSinceMessage = 0;
    this.port.postMessage({ type: 'METRICS', metrics: {
      momentary: this.samples >= this.mSize ? this.loudness(Math.max(0, this.mSum / this.mSize)) : -120,
      shortTerm: this.samples >= this.sSize ? this.loudness(Math.max(0, this.sSum / this.sSize)) : -120,
      integrated: this.integrated, lra: this.lra,
      maxMomentary: this.loudness(this.maxM), maxShortTerm: this.loudness(this.maxS),
      peakLeft: this.db(this.channels[0].peak), peakRight: count > 1 ? this.db(this.channels[1].peak) : -120,
      maxPeak: this.db(this.maxPeak), crestFactor: crest,
      phaseCorrelation: validPhase ? Math.max(-1, Math.min(1, this.sLR / Math.sqrt(this.sLL * this.sRR))) : 0,
      phaseCorrelationValid: validPhase
    }});
    return true;
  }
}
registerProcessor('loudness-processor', LoudnessProcessor);
`;

      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      try {
        await ctx.audioWorklet.addModule(workletUrl);
      } catch (err) {
        console.error('Failed to register AudioWorklet loudness-processor:', err);
        this.workletRegistrationPromises.delete(ctx);
        throw err;
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
    })();

    this.workletRegistrationPromises.set(ctx, promise);
    return promise;
  }

  /**
   * Creates the processing nodes (FFT Analyser, gain control, K-weighting Filters, Metric calculations)
   */
  private buildPipeline() {
    const ctx = this.audioContext!;

    // 1. Unity measurement bus retains native channels, including mono and surround.
    this.preAnalysisGain = ctx.createGain();
    this.preAnalysisGain.gain.setValueAtTime(1.0, ctx.currentTime);
    this.preAnalysisGain.channelCount = 2;
    this.preAnalysisGain.channelCountMode = 'max';
    this.preAnalysisGain.channelInterpretation = 'discrete';

    // Core analyser (for standard spectrum displays, spectrograms, waveforms)
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;

    // Stereo analysers for Lissajous Vector Scope Phase Correlation
    this.analyserLeft = ctx.createAnalyser();
    this.analyserLeft.fftSize = 1024; // Good default size for Phase analysis
    this.analyserLeft.smoothingTimeConstant = 0.4;
    this.analyserRight = ctx.createAnalyser();
    this.analyserRight.fftSize = 1024;
    this.analyserRight.smoothingTimeConstant = 0.4;

    this.splitter = ctx.createChannelSplitter(2);
    this.splitter.connect(this.analyserLeft, 0, 0);
    this.splitter.connect(this.analyserRight, 1, 0);

    // Connect preAnalysisGain to spectrum and vector scope splitters
    this.preAnalysisGain.connect(this.analyser);
    this.preAnalysisGain.connect(this.splitter);

    // 2. Playback volume control
    this.gainNode = ctx.createGain();
    const isMic = this.currentSourceType === AudioSourceType.MICROPHONE;
    this.gainNode.gain.setValueAtTime(isMic || this.outputMuted ? 0 : this.masterVolume, ctx.currentTime);
    this.preAnalysisGain.connect(this.gainNode);

    // Preserve native channels; calibrated K-weighting runs per channel in the worklet.
    if (ctx.audioWorklet) {
      try {
        this.loudnessAnalyser = new AudioWorkletNode(ctx, 'loudness-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });
        this.loudnessAnalyser.channelCount = 2;
        this.loudnessAnalyser.channelCountMode = 'max';
        this.loudnessAnalyser.channelInterpretation = 'discrete';
        this.preAnalysisGain.connect(this.loudnessAnalyser, 0, 0);
        
        // We route AudioWorklet's output directly to dummy destination (needs connection to tick in certain engines)
        this.dummyGain = ctx.createGain();
        this.dummyGain.gain.setValueAtTime(0, ctx.currentTime);
        this.loudnessAnalyser.connect(this.dummyGain);
        this.dummyGain.connect(ctx.destination);

        // Bind buffer metrics computational loop callback
        this.loudnessAnalyser.port.onmessage = (event) => {
          if (this.sourceActive && event.data.type === 'METRICS') {
            const metrics = event.data.metrics;
            this.currentMetrics = metrics;
            
            // Trap maximums locally for visual elements on resets
            this.maxMomentary = metrics.maxMomentary;
            this.maxShortTerm = metrics.maxShortTerm;
            this.maxPeak = metrics.maxPeak;
            this.maxPeakLeft = metrics.peakLeft;
            this.maxPeakRight = metrics.peakRight;

            this.metricsListeners.forEach(l => l(this.currentMetrics));
          }
        };
      } catch (err) {
        console.error('Failed to create AudioWorkletNode (loudness-processor):', err);
        this.loudnessAnalyser = null;
      }
    } else {
      console.warn('AudioWorklet is unsupported or blocked in this environment (e.g. non-secure sandbox or iframe).');
    }
  }

  /**
   * Captures microphone stream and hooks it up to pipeline
   */
  private async setupMicrophone(deviceId?: string) {
    const ctx = this.audioContext!;
    
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    });

    this.sourceNode = ctx.createMediaStreamSource(this.micStream);
    
    // Connect to central routing node for robust visualizer and upmixing support
    this.sourceNode.connect(this.preAnalysisGain!);
    this.connectOutput();
  }

  /**
   * Captures screen/tab audio output stream and hooks it up to pipeline
   */
  private async setupSystemCapture() {
    const ctx = this.audioContext!;
    
    // Request screen/tab media with audio channel enabled and stereo options
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: 1,
        height: 1,
        frameRate: 1
      },
      audio: {
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      } as any
    });

    const audioTracks = this.screenStream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
      throw new Error('No audio track detected. When choosing capture tab/screen, make sure to check the "Share audio" checkbox.');
    }

    // Isolate pure audio stream
    const audioOnlyStream = new MediaStream(audioTracks);

    this.sourceNode = ctx.createMediaStreamSource(audioOnlyStream);
    
    // Connect to central routing node for robust visualizer and upmixing support
    this.sourceNode.connect(this.preAnalysisGain!);
    this.connectOutput();

    // Stop and reset when browser sharing banner stops
    audioTracks[0].onended = () => {
      this.stop();
    };
  }

  /**
   * Connects HTML5 audio tag to pipeline for file rendering
   */
  private setupAudioElement(elem: HTMLAudioElement) {
    const ctx = this.audioContext!;
    this.audioElement = elem;

    // Standard media element source (cached to avoid 'already connected' error)
    let mediaNode = this.mediaNodesCache.get(elem);
    if (!mediaNode) {
      mediaNode = ctx.createMediaElementSource(elem);
      this.mediaNodesCache.set(elem, mediaNode);
    }
    this.sourceNode = mediaNode;

    // Connect to central routing node for robust visualizer and upmixing support
    this.sourceNode.connect(this.preAnalysisGain!);
    this.connectOutput();

    // Reset accumulated metrics for a new source/track change
    this.resetMetrics();

    // Initial estimation properties
    let estSampleRate = 44100;
    let estBitrate = 320;
    let estCodec = 'MPEG Layer-3 (MP3)';
    
    // Support either src element directly or parent references
    const currentUrl = elem.src || '';
    const urlLower = currentUrl.toLowerCase();
    if (urlLower.endsWith('.wav')) {
      estCodec = 'Linear PCM (WAV)';
      estSampleRate = 44100;
      estBitrate = 1411;
    } else if (urlLower.endsWith('.flac')) {
      estCodec = 'FLAC Audio (Lossless)';
      estSampleRate = 44100;
      estBitrate = 700;
    } else if (urlLower.endsWith('.m4a') || urlLower.endsWith('.aac') || urlLower.endsWith('.mp4')) {
      estCodec = 'AAC Audio (M4A)';
      estSampleRate = 44100;
      estBitrate = 256;
    } else if (urlLower.endsWith('.ogg')) {
      estCodec = 'Ogg Vorbis (OGG)';
      estSampleRate = 44100;
      estBitrate = 192;
    }

    this.updateMetadata({
      sampleRate: estSampleRate,
      bufferSize: this.bufSize,
      bitrate: estBitrate,
      codec: estCodec
    });

    if (currentUrl) {
      const reqId = ++this.loadRequestId;
      const fetchAndDecode = async () => {
        try {
          const arrayBuffer = await fetchPartialArrayBuffer(currentUrl, 3 * 1024 * 1024);
          if (reqId !== this.loadRequestId) return;

          const registeredFile = AudioFileRegistry.get(currentUrl);
          const fileSize = await getAudioFileSize(currentUrl, registeredFile);
          const duration = elem.duration || 1;

          // Parse native file metadata directly from binary header
          const parsed = parseAudioMetadata(arrayBuffer, fileSize, duration, estCodec);
          if (reqId !== this.loadRequestId) return;

          // Decode small portion to inspect decoded channels if needed
          let channelCount = parsed.channels;
          try {
            const decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
            if (reqId !== this.loadRequestId) return;
            if (decodedBuffer && decodedBuffer.numberOfChannels) {
              channelCount = decodedBuffer.numberOfChannels;
            }
          } catch (e) {}

          if (reqId !== this.loadRequestId) return;

          this.updateMetadata({
            sampleRate: parsed.sampleRate,
            bitrate: parsed.bitrate,
            codec: parsed.codec,
            bitDepth: parsed.bitDepth,
            isVBR: parsed.isVBR,
            bufferSize: this.bufSize,
            trackChannelCount: channelCount,
            splitterInputChannelCount: this.preAnalysisGain?.channelCount ?? 2
          });
        } catch (err) {
          console.warn('Asynchronous engine background decode failed, maintained estimations:', err);
        }
      };
      
      fetchAndDecode();
    }

    // Ensure state starts playing
    elem.play().catch(err => console.log('Audio autoplay prevented, wait for action:', err));
  }

  /**
   * Sets up our robust code-based signal generator
   */
  private setupGenerator(type: GeneratorSignalType, freq: number) {
    const ctx = this.audioContext!;
    this.currentGenType = type;
    this.generatorFrequency = freq;

    // Prepare node to analyze and play
    const genGain = ctx.createGain();
    genGain.gain.setValueAtTime(1.0, ctx.currentTime);
    this.generatorGain = genGain;

    if (type === GeneratorSignalType.WHITE_NOISE || type === GeneratorSignalType.PINK_NOISE) {
      this.setupNoiseGenerator(type, genGain);
    } else if (type === GeneratorSignalType.SINE_SWEEP) {
      this.setupSweepGenerator(genGain);
    } else if (type === GeneratorSignalType.AMBIENT_DRONE) {
      // Direct drone synthesizer setup
      this.setupDroneSynth(genGain);
    } else {
      // Standard oscillators: SINE, SQUARE, SAWTOOTH, TRIANGLE
      const osc = ctx.createOscillator();
      osc.type = type as OscillatorType;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      
      this.generatorOsc = osc;
      osc.connect(genGain);
      osc.start();
    }

    // Connect to central routing node for robust visualizer and upmixing support
    genGain.connect(this.preAnalysisGain!);
    this.connectOutput();
  }

  /**
   * Generate static buffer with high precision White or Pink Noise
   */
  private setupNoiseGenerator(type: GeneratorSignalType, destination: AudioNode) {
    const ctx = this.audioContext!;
    const bufferSize = ctx.sampleRate * 2; // 2 seconds looping buffer
    const noiseBuffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate);

    for (let c = 0; c < 2; c++) {
      const data = noiseBuffer.getChannelData(c);
      if (type === GeneratorSignalType.WHITE_NOISE) {
        // White noise is pure random
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
      } else {
        // Pink noise ( Kellet Voss-McCartney algorithm for close -3dB/oct density)
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
          b6 = white * 0.115926;
          data[i] = pink * 0.11; // scale to prevent clipping
        }
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    this.generatorNoiseBufferSource = source;
    source.connect(destination);
    source.start();
  }

  /**
   * Sweeps frequency recursively from 20 Hz to 20,000 Hz in logarithmic curves
   */
  private setupSweepGenerator(destination: AudioNode) {
    const ctx = this.audioContext!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    
    const startFreq = 20;
    const endFreq = 20000;
    const duration = 8; // 8 seconds sweep

    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);

    this.generatorOsc = osc;
    osc.connect(destination);
    osc.start();

    // Loop the sweep
    this.generatorTimer = window.setInterval(() => {
      if (!this.sourceActive) return;
      try {
        osc.frequency.cancelScheduledValues(ctx.currentTime);
        osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);
      } catch (e) {}
    }, duration * 1000);
  }

  /**
   * Sets up our programmatically synthesized Space Drone (Ambient Synthesizer)
   * This is extremely satisfying as a built-in music test signal, completely royalty-free and robust!
   */
  private setupDroneSynth(destination: AudioNode) {
    const ctx = this.audioContext!;
    this.synthNodes = [];

    // Combine 3 space oscillators tuned to minor triads for lush rich sound
    const chords = [110, 130.81, 164.81]; // A2, C3, E3 (Am chords)
    
    chords.forEach((baseFreq, index) => {
      // 1. Fundamental Sawtooth chord oscillator
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(baseFreq, ctx.currentTime);

      // 2. Detuned Sub Sine oscillator
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(baseFreq * 0.99 + (index * 0.5), ctx.currentTime);

      // 3. Multi-modulating lowpass filter
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, ctx.currentTime);
      filter.Q.setValueAtTime(8, ctx.currentTime);

      // 4. LFO to slowly modulate filter cutoff for sweeping "space" wind sound
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.05 + index * 0.03, ctx.currentTime); // very slow 20-second cycles

      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(150 + index * 50, ctx.currentTime); // sweep bounds

      // Inter-connections
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      const voiceGain = ctx.createGain();
      voiceGain.gain.setValueAtTime(0.12, ctx.currentTime); // gentle volume

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(voiceGain);
      voiceGain.connect(destination);

      // Play
      osc1.start();
      osc2.start();
      lfo.start();

      this.synthNodes.push({ osc1, osc2, lfo, lfoGain, filter, voiceGain });
    });
  }

  private stopDroneSynth() {
    this.synthNodes.forEach(({ osc1, osc2, lfo, lfoGain, filter, voiceGain }) => {
      try {
        osc1.stop();
        osc2.stop();
        lfo.stop();
      } catch (e) {}
      osc1.disconnect();
      osc2.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      filter.disconnect();
      voiceGain.disconnect();
    });
    this.synthNodes = [];
  }

  /**
   * Process K-weighted and unweighted signals to update loudness states in real-time
   */
  public getMetrics(): LoudnessMetrics {
    return this.currentMetrics;
  }

  /**
   * Complete AudioContext lifecycle cleanup system to prevent memory leaks and close resources
   */
  public async destroy() {
    this.stopCurrent();

    // 1. Clear all history tracking arrays immediately to drop references
    this.momentaryHistory = [];
    this.shortTermHistory = [];
    this.shortTermLUFSHistory = [];
    this.gatingBlocks = [];
    this.rawBufferHistory = [];

    // 2. Clear callbacks to ensure no closure references are retained
    this.metricsListeners = [];
    this.stateChangeListeners = [];
    this.metadataListeners = [];

    // 3. Clear the MediaElement node WeakMap reference
    this.mediaNodesCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
    this.workletRegistrationPromises = new WeakMap<AudioContext, Promise<void>>();

    // 4. Safely close and cleanup the AudioContext
    if (this.audioContext) {
      try {
        if (this.audioContext.state !== 'closed') {
          await this.audioContext.close();
        }
      } catch (err) {
        console.warn('Error closing AudioContext during engine destroy:', err);
      }
      this.audioContext = null;
    }
  }
}

// Single instance sharing across components
export const audioAnalyzer = new AudioAnalyzerEngine();

// Custom React Hook to listen and reactive respond to active audio stream metadata updates
export function useStreamMetadata() {
  const [meta, setMeta] = useState(() => audioAnalyzer.getMetadata());
  useEffect(() => {
    return audioAnalyzer.registerMetadataListener((newMeta) => {
      setMeta(newMeta);
    });
  }, []);
  return meta;
}

/**
 * Reusable React Hook for subscribing to real-time loudness and audio metrics.
 *
 * PERFORMANCE WARNING:
 * When used without a callback function, returning reactive state updates at 10-60Hz
 * will cause frequent main-thread re-renders across consumers and children.
 *
 * RECOMMENDED APPROACH:
 * Pass a stable callback function to receive values directly without triggering React re-renders.
 */
export function useAudioMetrics(callback?: (metrics: LoudnessMetrics) => void) {
  const [metrics, setMetrics] = useState<LoudnessMetrics>(() => audioAnalyzer.getMetrics());
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return audioAnalyzer.registerMetricsListener((newMetrics) => {
      if (callbackRef.current) {
        callbackRef.current(newMetrics);
      } else {
        setMetrics(newMetrics);
      }
    });
  }, []);

  return callback ? null : metrics;
}

/**
 * Reusable React Hook for querying and subscribing to low-frequency analyzer engine active/paused state changes.
 * Only triggers renders when the active state toggles (highly performant).
 */
export function useAnalyzerState() {
  const [isActive, setIsActive] = useState(() => audioAnalyzer.isSourceActive());
  useEffect(() => {
    return audioAnalyzer.registerStateListener((active) => {
      setIsActive(active);
    });
  }, []);
  return isActive;
}

/**
 * Reusable React Hook for consuming playback parameters from active HTMLAudioElement.
 * This dynamically switches listeners when the target player source shifts.
 */
export function usePlaybackTelemetry() {
  const [playbackState, setPlaybackState] = useState(() => {
    const elem = audioAnalyzer.getAudioElement();
    return {
      currentTime: elem ? elem.currentTime : 0,
      duration: elem ? elem.duration || 0 : 0,
      isPaused: elem ? elem.paused : true,
      playbackRate: elem ? elem.playbackRate : 1.0,
      isPlaying: audioAnalyzer.isSourceActive()
    };
  });

  useEffect(() => {
    let activeElem: HTMLAudioElement | null = null;

    const updateTelemetry = () => {
      const elem = audioAnalyzer.getAudioElement();
      if (!elem) {
        setPlaybackState({
          currentTime: 0,
          duration: 0,
          isPaused: true,
          playbackRate: 1.0,
          isPlaying: audioAnalyzer.isSourceActive()
        });
        return;
      }

      setPlaybackState({
        currentTime: elem.currentTime,
        duration: elem.duration || 0,
        isPaused: elem.paused,
        playbackRate: elem.playbackRate,
        isPlaying: audioAnalyzer.isSourceActive()
      });
    };

    // Low-frequency subscriptions to track source transitions & active states
    const unsubState = audioAnalyzer.registerStateListener(updateTelemetry);
    const unsubMeta = audioAnalyzer.registerMetadataListener(updateTelemetry);

    // Dynamic subscription handler to bind element listeners
    const intervalId = setInterval(() => {
      const elem = audioAnalyzer.getAudioElement();
      if (elem !== activeElem) {
        if (activeElem) {
          activeElem.removeEventListener('timeupdate', updateTelemetry);
          activeElem.removeEventListener('durationchange', updateTelemetry);
          activeElem.removeEventListener('play', updateTelemetry);
          activeElem.removeEventListener('pause', updateTelemetry);
          activeElem.removeEventListener('ratechange', updateTelemetry);
        }
        activeElem = elem;
        if (elem) {
          elem.addEventListener('timeupdate', updateTelemetry);
          elem.addEventListener('durationchange', updateTelemetry);
          elem.addEventListener('play', updateTelemetry);
          elem.addEventListener('pause', updateTelemetry);
          elem.addEventListener('ratechange', updateTelemetry);
          updateTelemetry();
        }
      }
    }, 200);

    return () => {
      unsubState();
      unsubMeta();
      clearInterval(intervalId);
      if (activeElem) {
        activeElem.removeEventListener('timeupdate', updateTelemetry);
        activeElem.removeEventListener('durationchange', updateTelemetry);
        activeElem.removeEventListener('play', updateTelemetry);
        activeElem.removeEventListener('pause', updateTelemetry);
        activeElem.removeEventListener('ratechange', updateTelemetry);
      }
    };
  }, []);

  return playbackState;
}
