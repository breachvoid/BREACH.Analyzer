import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { audioAnalyzer } from '../audioEngine';
import { type EqualizerSettings, type EqualizerUpdate } from '../dsp/equalizer';
import { PanelInfo } from './PanelInfo';

const db = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
const fieldClass = 'w-[58px] min-w-0 bg-[#121212] border border-[#4a4a4a] px-1 py-1 text-[10px] text-[#F2F2F2] font-mono';

function NumericField({ label, value, min, max, step = 1, onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const number = Number(draft);
    if (draft.trim() && Number.isFinite(number)) {
      const safe = Math.min(max, Math.max(min, number)); onCommit(safe); setDraft(String(safe));
    } else setDraft(String(value));
  };
  return <input aria-label={label} type="number" min={min} max={max} step={step} value={draft}
    onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(String(value)); } }}
    className={fieldClass} />;
}

export function EqualizerDeck() {
  const [settings, setSettings] = useState<EqualizerSettings>(() => audioAnalyzer.getEqualizerState());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [responseError, setResponseError] = useState('');
  useEffect(() => audioAnalyzer.registerEqualizerListener(setSettings), []);
  const update = (patch: EqualizerUpdate) => audioAnalyzer.setEqualizer(patch);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const width = canvas.clientWidth, height = 110, scale = window.devicePixelRatio || 1;
      if (width < 1) return;
      canvas.width = Math.round(width * scale); canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, width, height);
      const left = 31, right = width - 12, top = 13, bottom = height - 25;
      const y = (gain: number) => top + (24 - gain) / 60 * (bottom - top);
      ctx.font = '10px monospace'; ctx.textAlign = 'right';
      for (const gain of [-36, -24, -12, 0, 12, 24]) {
        ctx.strokeStyle = gain === 0 ? '#525252' : '#292929';
        ctx.beginPath(); ctx.moveTo(left, y(gain)); ctx.lineTo(right, y(gain)); ctx.stroke();
        ctx.fillStyle = '#B8B8B8'; ctx.fillText(String(gain), left - 5, y(gain) + 3);
      }
      const maxFrequency = Math.min(20000, (audioAnalyzer.getContext()?.sampleRate || 48000) * 0.45);
      const x = (frequency: number) => left + Math.log(frequency / 20) / Math.log(maxFrequency / 20) * (right - left);
      for (const frequency of [20, 1000, maxFrequency]) {
        ctx.strokeStyle = '#292929'; ctx.beginPath(); ctx.moveTo(x(frequency), top); ctx.lineTo(x(frequency), bottom); ctx.stroke();
        ctx.textAlign = frequency === 20 ? 'left' : frequency === maxFrequency ? 'right' : 'center';
        ctx.fillStyle = '#B8B8B8'; ctx.fillText(frequency >= 1000 ? `${Math.round(frequency / 1000)}k` : '20 Hz', x(frequency), height - 7);
      }
      try {
        const frequencies = Float32Array.from({ length: 180 }, (_, i) => 20 * (maxFrequency / 20) ** (i / 179));
        const response = audioAnalyzer.getEqualizerResponse(frequencies);
        ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
        ctx.strokeStyle = settings.mode === 'B' ? '#b20000' : '#777777'; ctx.lineWidth = 2;
        ctx.setLineDash(settings.mode === 'A' ? [4, 3] : []); ctx.beginPath();
        response.forEach((gain, i) => { if (i) ctx.lineTo(x(frequencies[i]), y(gain)); else ctx.moveTo(x(frequencies[i]), y(gain)); }); ctx.stroke();
        if (settings.mode === 'A') {
          ctx.setLineDash([]); ctx.strokeStyle = '#F2F2F2'; ctx.beginPath(); ctx.moveTo(left, y(0)); ctx.lineTo(right, y(0)); ctx.stroke();
        }
        ctx.restore(); setResponseError('');
      } catch { setResponseError('EQ response unavailable.'); }
    };
    draw();
    const observer = new ResizeObserver(draw); observer.observe(canvas);
    return () => observer.disconnect();
  }, [settings]);

  return <section id="equalizer-deck" aria-label="EQ Deck" className="min-w-0 w-full h-full flex flex-col border border-[#4a4a4a] bg-[#121212]">
    <header className="min-h-[54px] flex items-center justify-between gap-2 px-3 py-3 border-b border-[#383838]">
      <div className="flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-[#b20000]" /><h2 className="text-xs font-semibold tracking-[1.4px] text-[#F2F2F2] uppercase">EQ Deck</h2></div>
      <PanelInfo label="About the EQ">A plays the original signal. B applies these EQ settings and B output gain. Switching or editing active EQ starts a fresh measurement after a short transition. Speaker volume is separate. The file waveform stays original; live meters and spectrum follow A/B. Boosts can cause clipping; reduce B output when needed.</PanelInfo>
    </header>
    <div className="p-3 flex flex-col gap-2">
      <div role="group" aria-label="Compare original and EQ" className="grid grid-cols-2 gap-1.5">
        {(['A', 'B'] as const).map(mode => <button type="button" key={mode} id={`btn-eq-${mode.toLowerCase()}`} aria-pressed={settings.mode === mode} onClick={() => update({ mode })} className={`px-2 py-2 text-[11px] font-medium tracking-[0.6px] border transition-colors ${settings.mode === mode ? 'bg-[#b20000] border-[#b20000] text-white' : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:border-[#F2F2F2] hover:text-white'}`}>{mode} · {mode === 'A' ? 'ORIGINAL' : 'EQ'}</button>)}
      </div>
      <canvas ref={canvasRef} className="w-full h-[110px] block" role="img" aria-label={`EQ response in dB. ${settings.mode === 'A' ? 'Original is flat; dashed curve shows stored B settings.' : 'B curve includes EQ output gain.'}`} />
      {responseError && <p role="status" className="text-[11px] text-[#ff4444]">{responseError}</p>}
      {(['low', 'mid', 'high'] as const).map(key => <div key={key} className="border-t border-[#383838] pt-2">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-[#B8B8B8]">
          <span className="uppercase tracking-[0.4px]">{key === 'mid' ? 'Bell' : `${key} shelf`}</span>
          <label className="flex items-center gap-1"><NumericField label={`${key} band frequency`} value={settings[key].frequency} min={20} max={20000} onCommit={frequency => update({ [key]: { frequency } })} />Hz</label>
          {key === 'mid' && <label className="flex items-center gap-1">Q <NumericField label="mid band Q" value={settings.mid.q} min={0.2} max={12} step={0.1} onCommit={q => update({ mid: { q } })} /></label>}
          <output className="font-mono text-[#F2F2F2]">{db(settings[key].gain)}</output>
        </div>
        <input type="range" aria-label={`${key} band gain`} min={-12} max={12} step={0.5} value={settings[key].gain} onChange={e => update({ [key]: { gain: Number(e.target.value) } })} className="w-full h-4 mt-1 accent-[#b20000]" />
      </div>)}
      <label className="block border-t border-[#383838] pt-2.5"><span className="flex justify-between gap-2 text-[10px] tracking-[0.7px] text-[#B8B8B8]">B OUTPUT <output className="font-mono text-[#F2F2F2]">{db(settings.outputGain)}</output></span><input type="range" aria-label="EQ output gain" min={-24} max={12} step={0.5} value={settings.outputGain} onChange={e => update({ outputGain: Number(e.target.value) })} className="w-full h-4 mt-1 accent-[#b20000]" /></label>
    </div>
    <p aria-live="polite" className="mt-auto border-t border-[#383838] px-3 py-2.5 text-[10px] text-[#B8B8B8] font-mono">{settings.mode === 'A' ? 'A · Original / B settings stored' : 'B · EQ applied before analysis'}</p>
  </section>;
}
