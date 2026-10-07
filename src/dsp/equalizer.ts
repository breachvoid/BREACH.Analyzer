export type EqualizerMode = 'A' | 'B';
export interface EqualizerBand { frequency: number; gain: number; q: number }
export interface EqualizerSettings {
  mode: EqualizerMode;
  low: EqualizerBand;
  mid: EqualizerBand;
  high: EqualizerBand;
  outputGain: number;
}
export type EqualizerUpdate = Partial<Pick<EqualizerSettings, 'mode' | 'outputGain'>> & {
  low?: Partial<EqualizerBand>; mid?: Partial<EqualizerBand>; high?: Partial<EqualizerBand>;
};
export const EQ_SETTLE_MS = 50;
export const DEFAULT_EQUALIZER: EqualizerSettings = {
  mode: 'A', low: { frequency: 80, gain: 0, q: 0.707 },
  mid: { frequency: 450, gain: 0, q: 1 }, high: { frequency: 8000, gain: 0, q: 0.707 }, outputGain: 0
};
const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback;
export function updateEqualizer(current: EqualizerSettings, patch: EqualizerUpdate): EqualizerSettings {
  const band = (key: 'low' | 'mid' | 'high') => ({
    frequency: clamp(patch[key]?.frequency, current[key].frequency, 20, 20000),
    gain: clamp(patch[key]?.gain, current[key].gain, -12, 12),
    q: clamp(patch[key]?.q, current[key].q, 0.2, 12)
  });
  return { mode: patch.mode === 'A' || patch.mode === 'B' ? patch.mode : current.mode,
    low: band('low'), mid: band('mid'), high: band('high'),
    outputGain: clamp(patch.outputGain, current.outputGain, -24, 12) };
}
function setFilter(filter: BiquadFilterNode, band: EqualizerBand, now: number, smooth: boolean) {
  const values: [AudioParam, number][] = [[filter.frequency, Math.min(band.frequency, filter.context.sampleRate * 0.45)], [filter.gain, band.gain], [filter.Q, band.q]];
  for (const [param, value] of values) {
    param.cancelScheduledValues(now);
    if (smooth) param.setTargetAtTime(value, now, 0.005);
    else { param.value = value; param.setValueAtTime(value, now); }
  }
}
/** Parallel dry/EQ paths share one source. A is exact unity, independent of B trim. */
export class EqualizerProcessor {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private trim: GainNode;
  private filters: BiquadFilterNode[];
  constructor(private ctx: BaseAudioContext, settings: EqualizerSettings) {
    this.input = ctx.createGain(); this.output = ctx.createGain();
    this.dry = ctx.createGain(); this.wet = ctx.createGain(); this.trim = ctx.createGain();
    this.filters = ['lowshelf', 'peaking', 'highshelf'].map(type => {
      const filter = ctx.createBiquadFilter(); filter.type = type as BiquadFilterType; return filter;
    });
    for (const node of [this.input, this.output, this.dry, this.wet, this.trim, ...this.filters]) {
      node.channelCountMode = 'max'; node.channelInterpretation = 'discrete';
    }
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.filters[0]).connect(this.filters[1]).connect(this.filters[2]).connect(this.trim).connect(this.wet).connect(this.output);
    this.apply(settings, false);
  }
  apply(settings: EqualizerSettings, smooth = true) {
    const now = this.ctx.currentTime;
    ['low', 'mid', 'high'].forEach((key, i) => setFilter(this.filters[i], settings[key as 'low' | 'mid' | 'high'], now, smooth));
    this.trim.gain.cancelScheduledValues(now);
    const trim = 10 ** (settings.outputGain / 20);
    if (smooth) this.trim.gain.setTargetAtTime(trim, now, 0.005);
    else this.trim.gain.setValueAtTime(trim, now);
    // Complementary linear ramps avoid a +3 dB bump for correlated dry/wet audio.
    for (const [node, value] of [[this.dry, settings.mode === 'A' ? 1 : 0], [this.wet, settings.mode === 'B' ? 1 : 0]] as const) {
      if (smooth) {
        node.gain.cancelAndHoldAtTime(now);
        node.gain.linearRampToValueAtTime(value, now + 0.02);
      } else node.gain.setValueAtTime(value, now);
    }
  }
  disconnect() {
    for (const node of [this.input, this.dry, this.wet, this.trim, ...this.filters, this.output]) node.disconnect();
  }
}
/** Native biquad response, including B output gain; no approximation or speaker volume. */
export function equalizerResponse(ctx: BaseAudioContext, settings: EqualizerSettings, frequencies: Float32Array): Float32Array {
  const response = new Float32Array(frequencies.length).fill(settings.outputGain);
  const magnitude = new Float32Array(frequencies.length), phase = new Float32Array(frequencies.length);
  ['low', 'mid', 'high'].forEach((key, i) => {
    const filter = ctx.createBiquadFilter(); filter.type = (['lowshelf', 'peaking', 'highshelf'] as BiquadFilterType[])[i];
    setFilter(filter, settings[key as 'low' | 'mid' | 'high'], ctx.currentTime, false);
    filter.getFrequencyResponse(frequencies, magnitude, phase);
    for (let j = 0; j < response.length; j++) response[j] += 20 * Math.log10(Math.max(1e-10, magnitude[j]));
    filter.disconnect();
  });
  return response;
}
