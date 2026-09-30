/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { AudioSourceType, GeneratorSignalType, LoudnessMetrics } from './types';
import { AudioFileRegistry, fetchPartialArrayBuffer, getAudioFileSize } from './utils';

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
  private kStage1Filter: BiquadFilterNode | null = null; // High-shelving pre-filter
  private kStage2Filter: BiquadFilterNode | null = null; // RLB high-pass filter

  // Media streams and elements
  private micStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private mediaNodesCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
  
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
    splitterInputChannelCount: undefined as number | undefined
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
      phaseCorrelation: 1.0
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
   * Start a specified source stream
   */
  public async startSource(sourceType: AudioSourceType, options?: { element?: HTMLAudioElement; generatorType?: GeneratorSignalType; freq?: number; deviceId?: string }) {
    this.initContext();
    if (this.audioContext!.state === 'suspended') {
      await this.audioContext!.resume();
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
    if (this.kStage2Filter) {
      try {
        this.kStage2Filter.disconnect();
      } catch (e) {}
      this.kStage2Filter = null;
    }
    if (this.kStage1Filter) {
      try {
        this.kStage1Filter.disconnect();
      } catch (e) {}
      this.kStage1Filter = null;
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
    this.bufSize = 2048;
    this.bufferL = new Float32Array(this.bufSize);
    this.bufferR = new Float32Array(this.bufSize);
    this.unweightedBufferL = new Float32Array(this.bufSize);
    this.unweightedBufferR = new Float32Array(this.bufSize);
    this.writeIndex = 0;
    
    // Ring buffer allocations for momentary metrics
    const bufferDurationMs = (this.bufSize / sampleRate) * 1000;
    this.maxMomentaryBlocks = Math.round(400 / bufferDurationMs);
    this.maxShortTermBlocks = Math.round(3000 / bufferDurationMs);
    
    this.momentaryHistoryRing = new Float32Array(this.maxMomentaryBlocks);
    this.momentaryRingWrite = 0;
    this.momentaryRingCount = 0;

    this.shortTermHistoryRing = new Float32Array(this.maxShortTermBlocks);
    this.shortTermRingWrite = 0;
    this.shortTermRingCount = 0;

    // Gating structures (Histogram based to prevent O(N) loops and memory pressure)
    this.MIN_LUFS = -120;
    this.MAX_LUFS = 20;
    this.BINS_PER_DB = 10;
    this.NUM_BINS = (this.MAX_LUFS - this.MIN_LUFS) * this.BINS_PER_DB + 1;

    this.gatingBlocksHistogram = new Uint32Array(this.NUM_BINS);
    this.gatingBlocksCount = 0;

    this.shortTermLUFSHistogram = new Uint32Array(this.NUM_BINS);
    this.shortTermLUFSCount = 0;

    this.rawBufferPowerRing = new Float32Array(2048);
    this.rawBufferPowerWrite = 0;
    this.rawBufferPowerCount = 0;
    this.samplesSinceLastGating = 0;
    this._blockCount = 0;

    this.maxMomentary = -120;
    this.maxShortTerm = -120;
    this.maxPeak = -120;
    this.maxPeakLeft = -120;
    this.maxPeakRight = -120;
    
    // Broadcast-Grade Phase Correlation Parameters (250ms integration window)
    const correlationIntegrationSec = 0.250; 
    this.correlationAlpha = 1.0 - Math.exp(-1.0 / (correlationIntegrationSec * sampleRate));
    this.sLR = 0.0;
    this.sLL = 1e-12;
    this.sRR = 1e-12;
    this.smoothedPhaseCorrelation = 1.0;
    
    this.integratedLUFS = -120;
    this.lra = 0;
    this.lraUpdateTicks = 0;

    this.port.onmessage = (event) => {
      if (event.data.type === 'RESET') {
        this.resetMetrics();
      }
    };
  }

  resetMetrics() {
    this.maxMomentary = -120;
    this.maxShortTerm = -120;
    this.maxPeak = -120;
    this.maxPeakLeft = -120;
    this.maxPeakRight = -120;
    this.writeIndex = 0;
    
    this.sLR = 0.0;
    this.sLL = 1e-12;
    this.sRR = 1e-12;
    this.smoothedPhaseCorrelation = 1.0;
    
    this.integratedLUFS = -120;
    this.lra = 0;
    this.lraUpdateTicks = 0;

    this.gatingBlocksCount = 0;
    this.gatingBlocksHistogram.fill(0);

    this.shortTermLUFSCount = 0;
    this.shortTermLUFSHistogram.fill(0);

    this.rawBufferPowerWrite = 0;
    this.rawBufferPowerCount = 0;
    this.rawBufferPowerRing.fill(0);
    this.samplesSinceLastGating = 0;
    this._blockCount = 0;

    this.momentaryRingWrite = 0;
    this.momentaryRingCount = 0;
    this.momentaryHistoryRing.fill(0);

    this.shortTermRingWrite = 0;
    this.shortTermRingCount = 0;
    this.shortTermHistoryRing.fill(0);
    
    this.port.postMessage({
      type: 'METRICS',
      metrics: {
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
        phaseCorrelation: 1.0
      }
    });
  }

  calculateLoudness(numChannels) {
    // --- PHASE 1: Real Sub-sample True Peak Tracking on UNWEIGHTED signals ---
    let blockPeakLeft = 1e-12;
    let blockPeakRight = 1e-12;

    const rawDataL = this.unweightedBufferL;
    const rawDataR = numChannels >= 2 ? this.unweightedBufferR : rawDataL;

    for (let i = 0; i < rawDataL.length; i++) {
      const s = rawDataL[i];
      const absVal = Math.abs(s);
      let peakEst = absVal;
      
      // Hermite-Quadratic Parabolic true peak interpolator
      if (i > 0 && i < rawDataL.length - 1) {
        const prev = Math.abs(rawDataL[i - 1]);
        const next = Math.abs(rawDataL[i + 1]);
        if (absVal > prev && absVal > next) {
          const denom = 2 * (prev - 2 * absVal + next);
          if (Math.abs(denom) > 1e-6) {
            const peakOffset = (prev - next) / denom;
            const val = absVal - (prev - next) * peakOffset / 4;
            if (val > peakEst) peakEst = val;
          }
        }
      }
      if (peakEst > blockPeakLeft) blockPeakLeft = peakEst;
    }
    
    if (numChannels >= 2) {
      for (let i = 0; i < rawDataR.length; i++) {
        const s = rawDataR[i];
        const absVal = Math.abs(s);
        let peakEst = absVal;
        
        // Hermite-Quadratic Parabolic true peak interpolator
        if (i > 0 && i < rawDataR.length - 1) {
          const prev = Math.abs(rawDataR[i - 1]);
          const next = Math.abs(rawDataR[i + 1]);
          if (absVal > prev && absVal > next) {
            const denom = 2 * (prev - 2 * absVal + next);
            if (Math.abs(denom) > 1e-6) {
              const peakOffset = (prev - next) / denom;
              const val = absVal - (prev - next) * peakOffset / 4;
              if (val > peakEst) peakEst = val;
            }
          }
        }
        if (peakEst > blockPeakRight) blockPeakRight = peakEst;
      }
    } else {
      blockPeakRight = blockPeakLeft;
    }

    const peakDBL = 20 * Math.log10(blockPeakLeft);
    const peakDBR = 20 * Math.log10(blockPeakRight);
    const blockMaxPeak = Math.max(peakDBL, peakDBR);

    // Update historical peaks
    this.maxPeakLeft = Math.max(this.maxPeakLeft, peakDBL);
    this.maxPeakRight = Math.max(this.maxPeakRight, peakDBR);
    this.maxPeak = Math.max(this.maxPeak, blockMaxPeak);

    // --- PHASE 2: Loudness Formulation (ITU-R BS.1770) on K-WEIGHTED signals ---
    let totalMeanSquarePower = 0;
    
    // Left Channel
    let sumOfSquaresL = 0;
    for (let i = 0; i < this.bufferL.length; i++) {
      const s = this.bufferL[i];
      sumOfSquaresL += s * s;
    }
    totalMeanSquarePower += sumOfSquaresL / this.bufferL.length;

    // Right Channel
    if (numChannels >= 2) {
      let sumOfSquaresR = 0;
      for (let i = 0; i < this.bufferR.length; i++) {
        const s = this.bufferR[i];
        sumOfSquaresR += s * s;
      }
      totalMeanSquarePower += sumOfSquaresR / this.bufferR.length;
    } else {
      totalMeanSquarePower += sumOfSquaresL / this.bufferL.length;
    }

    // ITU-R BS.1770 specifies summing the weighted channel energies.
    const normalizedPower = totalMeanSquarePower;

    // Momentary Ring Buffer Update
    this.momentaryHistoryRing[this.momentaryRingWrite] = normalizedPower;
    this.momentaryRingWrite = (this.momentaryRingWrite + 1) % this.maxMomentaryBlocks;
    if (this.momentaryRingCount < this.maxMomentaryBlocks) {
      this.momentaryRingCount++;
    }

    // Short Term Ring Buffer Update
    this.shortTermHistoryRing[this.shortTermRingWrite] = normalizedPower;
    this.shortTermRingWrite = (this.shortTermRingWrite + 1) % this.maxShortTermBlocks;
    if (this.shortTermRingCount < this.maxShortTermBlocks) {
      this.shortTermRingCount++;
    }

    // Compute averages
    let sumMomentary = 0;
    for (let i = 0; i < this.momentaryRingCount; i++) {
      sumMomentary += this.momentaryHistoryRing[i];
    }
    const avgMomentaryPower = sumMomentary / Math.max(1, this.momentaryRingCount);

    let sumShortTerm = 0;
    for (let i = 0; i < this.shortTermRingCount; i++) {
      sumShortTerm += this.shortTermHistoryRing[i];
    }
    const avgShortTermPower = sumShortTerm / Math.max(1, this.shortTermRingCount);

    const momentaryLUFS = -0.691 + (10 * Math.log10(avgMomentaryPower + 1e-12));
    const shortTermLUFS = -0.691 + (10 * Math.log10(avgShortTermPower + 1e-12));

    if (momentaryLUFS > this.maxMomentary) {
      this.maxMomentary = momentaryLUFS;
    }
    if (shortTermLUFS > this.maxShortTerm) {
      this.maxShortTerm = shortTermLUFS;
    }

    this._blockCount++;

    const maxSamples400ms = Math.round(0.4 * sampleRate);
    const maxRawBlocks = Math.ceil(maxSamples400ms / this.bufSize);
    
    this.rawBufferPowerRing[this.rawBufferPowerWrite] = normalizedPower;
    this.rawBufferPowerWrite = (this.rawBufferPowerWrite + 1) % 2048;
    if (this.rawBufferPowerCount < 2048) {
      this.rawBufferPowerCount++;
    }

    this.samplesSinceLastGating += this.bufSize;
    const samplesPer100ms = Math.round(0.1 * sampleRate);

    let gatingBlockAdded = false;
    if (this.samplesSinceLastGating >= samplesPer100ms) {
      this.samplesSinceLastGating -= samplesPer100ms;

      const limit = Math.min(this.rawBufferPowerCount, maxRawBlocks);
      let powerSum = 0;
      for (let i = 0; i < limit; i++) {
        const idx = (this.rawBufferPowerWrite - 1 - i + 2048) % 2048;
        powerSum += this.rawBufferPowerRing[idx];
      }
      const true400msPower = limit > 0 ? (powerSum / limit) : 0;

      if (true400msPower > 1e-10) {
        gatingBlockAdded = true;
        // Compute block loudness in LUFS
        const blockLUFS = -0.691 + (10 * Math.log10(true400msPower + 1e-12));
        
        // Add to gating blocks histogram
        const binIndex = Math.round((blockLUFS - this.MIN_LUFS) * this.BINS_PER_DB);
        const safeBinIndex = Math.max(0, Math.min(this.NUM_BINS - 1, binIndex));
        this.gatingBlocksHistogram[safeBinIndex]++;
        this.gatingBlocksCount++;

        if (shortTermLUFS > -120) {
          // Add to short term LUFS histogram
          const stBinIndex = Math.round((shortTermLUFS - this.MIN_LUFS) * this.BINS_PER_DB);
          const safeStBinIndex = Math.max(0, Math.min(this.NUM_BINS - 1, stBinIndex));
          this.shortTermLUFSHistogram[safeStBinIndex]++;
          this.shortTermLUFSCount++;
        }
      }
    }

    if (gatingBlockAdded) {
      // --- PHASE 3: Integrated Loudness Calculation (EBU R128 Dual Gate - Histogram based) ---
      // Absolute Gate Threshold: -70 LUFS.
      // -70 LUFS bin index: Math.round((-70 - this.MIN_LUFS) * this.BINS_PER_DB) = 500
      const absThresholdBinIndex = 500;
      
      let absoluteGatedCount = 0;
      let absoluteGatedSum = 0;
      for (let bin = absThresholdBinIndex + 1; bin < this.NUM_BINS; bin++) {
        const count = this.gatingBlocksHistogram[bin];
        if (count > 0) {
          const lufs = this.MIN_LUFS + bin / this.BINS_PER_DB;
          const power = Math.pow(10, (lufs + 0.691) / 10);
          absoluteGatedSum += count * power;
          absoluteGatedCount += count;
        }
      }

      if (absoluteGatedCount > 0) {
        const avgPowerAbs = absoluteGatedSum / absoluteGatedCount;
        const absLUFS = -0.691 + (10 * Math.log10(avgPowerAbs + 1e-12));

        const relativeThresholdLUFS = absLUFS - 10;
        
        // Rel threshold bin mapping
        const relThresholdBinIndex = Math.max(
          absThresholdBinIndex + 1,
          Math.ceil((relativeThresholdLUFS - this.MIN_LUFS) * this.BINS_PER_DB)
        );

        let finalCount = 0;
        let finalSum = 0;
        for (let bin = relThresholdBinIndex; bin < this.NUM_BINS; bin++) {
          const count = this.gatingBlocksHistogram[bin];
          if (count > 0) {
            const lufs = this.MIN_LUFS + bin / this.BINS_PER_DB;
            const power = Math.pow(10, (lufs + 0.691) / 10);
            finalSum += count * power;
            finalCount += count;
          }
        }

        if (finalCount > 0) {
          const avgFinalPower = finalSum / finalCount;
          this.integratedLUFS = -0.691 + (10 * Math.log10(avgFinalPower + 1e-12));
        } else {
          this.integratedLUFS = absLUFS;
        }
      }

      // --- PHASE 4: Loudness Range (LRA) according to EBU Tech 3342 (Histogram based) ---
      this.lraUpdateTicks++;
      // Only recalculate LRA once every 5 gating updates (~500ms) to prevent audio thread performance drop
      if (this.lraUpdateTicks >= 5 || this.lra === 0) {
        this.lraUpdateTicks = 0;
        
        if (this.shortTermLUFSCount >= 20) {
          // 1. Absolute Gate: -70 LUFS (bin index 500)
          let sumPowers = 0;
          let absGatedCount = 0;
          for (let bin = absThresholdBinIndex + 1; bin < this.NUM_BINS; bin++) {
            const count = this.shortTermLUFSHistogram[bin];
            if (count > 0) {
              const lufs = this.MIN_LUFS + bin / this.BINS_PER_DB;
              const power = Math.pow(10, (lufs + 0.691) / 10);
              sumPowers += count * power;
              absGatedCount += count;
            }
          }

          if (absGatedCount >= 20) {
            const avgPowerAndDb = -0.691 + 10 * Math.log10(sumPowers / absGatedCount);
            const relGateThreshold = avgPowerAndDb - 20;

            const relGateThresholdBinIndex = Math.max(
              absThresholdBinIndex + 1,
              Math.ceil((relGateThreshold - this.MIN_LUFS) * this.BINS_PER_DB)
            );

            // Count ST blocks above relative threshold
            let finalCount = 0;
            for (let bin = relGateThresholdBinIndex; bin < this.NUM_BINS; bin++) {
              finalCount += this.shortTermLUFSHistogram[bin];
            }

            if (finalCount >= 20) {
              const idx10 = Math.floor(finalCount * 0.10);
              const idx95 = Math.floor(finalCount * 0.95);

              let cumulativeCount = 0;
              let lufs10 = -120;
              let lufs95 = -120;
              let found10 = false;

              for (let bin = relGateThresholdBinIndex; bin < this.NUM_BINS; bin++) {
                const count = this.shortTermLUFSHistogram[bin];
                if (count > 0) {
                  cumulativeCount += count;
                  if (!found10 && cumulativeCount >= idx10) {
                    lufs10 = this.MIN_LUFS + bin / this.BINS_PER_DB;
                    found10 = true;
                  }
                  if (cumulativeCount >= idx95) {
                    lufs95 = this.MIN_LUFS + bin / this.BINS_PER_DB;
                    break;
                  }
                }
              }

              this.lra = Math.max(0, lufs95 - lufs10);
            }
          }
        }
      }
    }

    // --- PHASE 5: Unweighted Decibel metrics / Crest is Peak to RMS ---
    let totalUnweightedMSPower = 0;
    for (let c = 0; c < numChannels; c++) {
      const data = c === 0 ? rawDataL : rawDataR;
      let sumOfSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const s = data[i];
        sumOfSquares += s * s;
      }
      totalUnweightedMSPower += sumOfSquares / data.length;
    }
    const rmsdB = 10 * Math.log10(totalUnweightedMSPower + 1e-12);
    const crestFactor = Math.max(0, blockMaxPeak - rmsdB);

    // --- PHASE 6: Phase Correlation on UNWEIGHTED signals ---
    let phaseCorrelation = 1.0;
    const denom = Math.sqrt(this.sLL * this.sRR);
    if (denom > 1e-12) {
      phaseCorrelation = this.sLR / denom;
    }
    // Display smoothing EMA (e.g., 100-150ms visual ballast)
    const displayAlpha = 0.35;
    this.smoothedPhaseCorrelation = this.smoothedPhaseCorrelation * (1 - displayAlpha) + phaseCorrelation * displayAlpha;
    const finalPhaseCo = Math.max(-1.0, Math.min(1.0, this.smoothedPhaseCorrelation));

    const currentMetrics = {
      momentary: Math.max(-120, momentaryLUFS),
      shortTerm: Math.max(-120, shortTermLUFS),
      integrated: Math.max(-120, this.integratedLUFS),
      lra: Math.max(0, this.lra),
      maxMomentary: Math.max(-120, this.maxMomentary),
      maxShortTerm: Math.max(-120, this.maxShortTerm),
      peakLeft: Math.max(-120, peakDBL),
      peakRight: Math.max(-120, peakDBR),
      maxPeak: Math.max(-120, this.maxPeak),
      crestFactor: Math.max(0, crestFactor),
      phaseCorrelation: finalPhaseCo
    };

    this.port.postMessage({
      type: 'METRICS',
      metrics: currentMetrics
    });
  }

  process(inputs, outputs, parameters) {
    const inputUnweighted = inputs[0];
    const inputKWeighted = inputs[1];
    
    // Check active unweighted signal array
    if (!inputUnweighted || inputUnweighted.length === 0) return true;
    const inputK = (inputKWeighted && inputKWeighted.length > 0) ? inputKWeighted : inputUnweighted;

    const numChannels = inputUnweighted.length;
    const inputChannelL = inputUnweighted[0];
    const inputChannelR = numChannels >= 2 ? inputUnweighted[1] : inputChannelL;

    const inputChannelLK = inputK[0];
    const inputChannelRK = inputK.length >= 2 ? inputK[1] : inputChannelLK;

    const length = inputChannelL.length;
    for (let i = 0; i < length; i++) {
      this.bufferL[this.writeIndex] = inputChannelLK[i];
      if (numChannels >= 2) {
        this.bufferR[this.writeIndex] = inputChannelRK[i];
      } else {
        this.bufferR[this.writeIndex] = inputChannelLK[i];
      }
      
      this.unweightedBufferL[this.writeIndex] = inputChannelL[i];
      if (numChannels >= 2) {
        this.unweightedBufferR[this.writeIndex] = inputChannelR[i];
      } else {
        this.unweightedBufferR[this.writeIndex] = inputChannelL[i];
      }

      // Sample-by-sample 250ms exponential integration of correlation product and energy terms
      const lVal = inputChannelL[i];
      const rVal = numChannels >= 2 ? inputChannelR[i] : lVal;
      const cAlpha = this.correlationAlpha;
      this.sLR = this.sLR * (1.0 - cAlpha) + (lVal * rVal) * cAlpha;
      this.sLL = this.sLL * (1.0 - cAlpha) + (lVal * lVal) * cAlpha;
      this.sRR = this.sRR * (1.0 - cAlpha) + (rVal * rVal) * cAlpha;
      
      this.writeIndex++;

      if (this.writeIndex === this.bufSize) {
        this.writeIndex = 0;
        this.calculateLoudness(numChannels);
      }
    }

    for (let c = 0; c < numChannels; c++) {
      if (outputs[0] && outputs[0][c] && inputs[0] && inputs[0][c]) {
        outputs[0][c].set(inputs[0][c]);
      }
    }

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

    // 1. Central upmixing gain node to handle mono-to-stereo conversion elegantly and safely
    this.preAnalysisGain = ctx.createGain();
    this.preAnalysisGain.gain.setValueAtTime(1.0, ctx.currentTime);
    this.preAnalysisGain.channelCount = 2;
    this.preAnalysisGain.channelCountMode = 'explicit';
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

    // 3. ITU-R BS.1770 K-Weighting Filter Stage 1: High-shelving pre-filter
    // Curve raises high frequencies about 4dB above ~1.68kHz representing acoustic effects of human head
    this.kStage1Filter = ctx.createBiquadFilter();
    this.kStage1Filter.type = 'highshelf';
    this.kStage1Filter.frequency.setValueAtTime(1681.97445095553, ctx.currentTime);
    this.kStage1Filter.gain.setValueAtTime(3.99981075489184, ctx.currentTime);
    this.kStage1Filter.Q.setValueAtTime(0.707175236955733, ctx.currentTime);

    // Filter Stage 2: RLB High-pass filter of 12dB/octave to roll off low frequencies below 38.1Hz
    this.kStage2Filter = ctx.createBiquadFilter();
    this.kStage2Filter.type = 'highpass';
    this.kStage2Filter.frequency.setValueAtTime(38.1354708761398, ctx.currentTime);
    this.kStage2Filter.Q.setValueAtTime(0.500327037332213, ctx.currentTime);

    // Wire filters in series and connect upstream input
    this.kStage1Filter.connect(this.kStage2Filter);
    this.preAnalysisGain.connect(this.kStage1Filter);

    // 4. Loudness calculation node: processes audio frames to calculate real-time RMS powers
    // We process stereophonic (or monophonic) buffers inside AudioWorkletNode with 2 inputs:
    // Input 0: Unweighted signal (for True Peak and Phase Correlation tracking)
    // Input 1: K-Weighted signal (for BS.1770 LUFS and LRA calculations)
    if (ctx.audioWorklet) {
      try {
        this.loudnessAnalyser = new AudioWorkletNode(ctx, 'loudness-processor', {
          numberOfInputs: 2,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });
        this.loudnessAnalyser.channelCount = 2;
        this.loudnessAnalyser.channelCountMode = 'explicit';
        this.loudnessAnalyser.channelInterpretation = 'speakers';
        this.kStage2Filter.connect(this.loudnessAnalyser, 0, 1);
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
      const fetchAndDecode = async () => {
        try {
          const arrayBuffer = await fetchPartialArrayBuffer(currentUrl, 3 * 1024 * 1024);
          // Decode the 3MB portion directly
          const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
          const actualSampleRate = decodedBuffer.sampleRate;
          const duration = elem.duration || decodedBuffer.duration || 1;

          const fileSize = await getAudioFileSize(currentUrl, AudioFileRegistry.get(currentUrl));
          const actualBitrate = Math.round((fileSize * 8 / duration) / 1000);

          let actualCodec = estCodec;
          const registeredFile = AudioFileRegistry.get(currentUrl);
          const blobType = registeredFile ? registeredFile.type : '';
          if (blobType.includes('mpeg') || blobType.includes('mp3')) {
            actualCodec = 'MPEG Layer-3 (MP3)';
          } else if (blobType.includes('wav') || blobType.includes('wave')) {
            actualCodec = 'Linear PCM (WAV)';
          } else if (blobType.includes('ogg')) {
            actualCodec = 'Ogg Vorbis (OGG)';
          } else if (blobType.includes('flac')) {
            actualCodec = 'FLAC Audio (Lossless)';
          } else if (blobType.includes('aac') || blobType.includes('m4a') || blobType.includes('mp4')) {
            actualCodec = 'AAC Audio (M4A)';
          }

          this.updateMetadata({
            sampleRate: actualSampleRate,
            bitrate: actualBitrate > 0 ? actualBitrate : estBitrate,
            codec: actualCodec,
            bufferSize: this.bufSize,
            trackChannelCount: decodedBuffer.numberOfChannels,
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
