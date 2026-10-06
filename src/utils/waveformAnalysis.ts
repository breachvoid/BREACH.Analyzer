/** Display-only envelope analysis. Never sum signed channels before measuring. */
export interface WaveformFilterState { low: number[]; mid: number[] }
export function createWaveformFilterState(channelCount: number): WaveformFilterState {
  return { low: Array(channelCount).fill(0), mid: Array(channelCount).fill(0) };
}

/** Peak is the largest channel peak; RMS and band colors use mean channel energy. */
export function analyzeWaveformSlice(
  channels: readonly Float32Array[], sampleRate: number, start: number, end: number,
  state: WaveformFilterState = createWaveformFilterState(channels.length)
) {
  const lowAlpha = Math.min(1, 2 * Math.PI * 250 / sampleRate);
  const midAlpha = Math.min(1, 2 * Math.PI * 3500 / sampleRate);
  let peak = 0, power = 0, lowPower = 0, midPower = 0, highPower = 0, count = 0;
  for (let c = 0; c < channels.length; c++) {
    let low = state.low[c] || 0, mid = state.mid[c] || 0;
    for (let i = Math.max(0, start); i < Math.min(end, channels[c].length); i++) {
      const raw = channels[c][i];
      peak = Math.max(peak, Math.abs(raw));
      power += raw * raw;
      low += lowAlpha * (raw - low);
      mid += midAlpha * (raw - mid);
      lowPower += low * low;
      midPower += (mid - low) * (mid - low);
      highPower += (raw - mid) * (raw - mid);
      count++;
    }
    state.low[c] = low; state.mid[c] = mid;
  }
  const rms = (sum: number) => Math.sqrt(sum / Math.max(1, count));
  return { peak: Math.min(1, peak), rms: Math.min(1, rms(power)),
    lowEnergy: Math.min(1, rms(lowPower) * 2.8),
    midEnergy: Math.min(1, rms(midPower) * 3.2),
    highEnergy: Math.min(1, rms(highPower) * 4.5) };
}
