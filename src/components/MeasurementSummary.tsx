import React, { useState } from 'react';
import { audioAnalyzer } from '../audioEngine';

export function MeasurementSummary({ targetLoudness }: { targetLoudness: number }) {
  const [summaryText, setSummaryText] = useState('');
  const exportSummary = () => {
    const meta = audioAnalyzer.getMetadata(), metrics = audioAnalyzer.getMetrics();
    const report = { exportedAt: new Date().toISOString(), measurement: audioAnalyzer.getMeasurementInfo(),
      format: { sampleRate: meta.sampleRate, channels: meta.trackChannelCount, codec: meta.codec,
        layout: (meta.trackChannelCount || 0) > 2 ? 'Unsupported file layout' : meta.trackChannelCount === 1 ? 'Mono' : meta.trackChannelCount === 2 ? 'Stereo' : 'Unknown' },
      metrics: {
        momentaryLUFS: metrics.momentary > -120 ? metrics.momentary : null,
        shortTermLUFS: metrics.shortTerm > -120 ? metrics.shortTerm : null,
        integratedLUFS: metrics.integrated > -120 ? metrics.integrated : null,
        lraLU: (metrics.measuredSeconds || 0) >= 3 && metrics.integrated > -120 ? metrics.lra : null,
        maxTruePeakDBTP: metrics.maxPeak > -120 ? metrics.maxPeak : null,
        maxMomentaryLUFS: metrics.maxMomentary > -120 ? metrics.maxMomentary : null,
        maxShortTermLUFS: metrics.maxShortTerm > -120 ? metrics.maxShortTerm : null,
        liveBlockCrestDB: metrics.peakLeft > -120 || metrics.peakRight > -120 ? metrics.crestFactor : null,
        phaseCorrelation: metrics.phaseCorrelationValid ? metrics.phaseCorrelation : null
      }, targetLUFS: targetLoudness, targetDifferenceLU: metrics.integrated > -120 ? metrics.integrated - targetLoudness : null,
      truePeakHeadroomTo0dBTP: metrics.maxPeak > -120 ? -metrics.maxPeak : null,
      lraProvisional: (metrics.measuredSeconds || 0) < 60,
      note: 'Includes only the audio measured during playback, not a full-file scan. Matching a loudness reference does not confirm delivery compliance.' };
    setSummaryText(JSON.stringify(report, null, 2));
  };

  return <div className="contents" id="player-measurement-export">
    <div className="flex justify-end self-start mt-2" ><button type="button" onClick={exportSummary} className="border border-[#4a4a4a] bg-[#121212] px-3 py-2 text-xs text-[#B8B8B8] hover:border-white hover:text-white">Export summary</button></div>
      {summaryText && <section role="dialog" aria-label="Measurement summary" className="col-span-full p-3 bg-[#121212] border border-[#4a4a4a]">
        <div className="flex flex-wrap gap-3 items-center text-xs mb-2">
          <span className="text-[#F2F2F2]">Measurement summary · copy or download JSON</span>
          <a className="text-[#ff4444] underline" download="BREACH-measurement.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(summaryText)}`}>Download JSON</a>
          <button type="button" onClick={() => setSummaryText('')} className="border border-[#4a4a4a] px-2 py-1">Close summary</button>
        </div>
        <textarea aria-label="Measurement summary JSON" readOnly value={summaryText} className="w-full h-52 bg-black text-[#B8B8B8] text-[11px] font-mono p-2 border border-[#4a4a4a]" />
      </section>}
  </div>;
}
