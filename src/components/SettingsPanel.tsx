/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect, useRef } from 'react';
import { Sliders, Palette, Check, Trash2, Pencil, X, Settings, Volume2, Save, Waves } from 'lucide-react';
import { AnalyzerConfig, LoudnessStandard, PresetItem, VisualizerMode, FrequencyScale } from '../types';
import { usePersistentState, SafeStorage } from '../utils/storage';


interface SettingsPanelProps {
  config: AnalyzerConfig;
  setConfig: React.Dispatch<React.SetStateAction<AnalyzerConfig>>;
  targetLoudness: number;
  setTargetLoudness: React.Dispatch<React.SetStateAction<number>>;
  deck1ShowGrid?: boolean;
  setDeck1ShowGrid?: (val: boolean) => void;
  deck2ShowGrid?: boolean;
  setDeck2ShowGrid?: (val: boolean) => void;
}

const DEFAULT_PRESETS: PresetItem[] = [
  {
    id: 'breach_bars',
    name: 'Breach Bars (Vertical)',
    isCustom: false,
    config: {
      fftSize: 2048,
      smoothing: 0.75,
      visualizerMode: VisualizerMode.SPECTRUM_BARS,
      frequencyScale: FrequencyScale.LOGARITHMIC,
      colorPalette: 'pioneer-rgb',
      showGrid: true,
      showPeakHold: true
    }
  },
  {
    id: 'mastering_diagnostic',
    name: 'Mastering Spec-Curve',
    isCustom: false,
    config: {
      fftSize: 4096,
      smoothing: 0.85,
      visualizerMode: VisualizerMode.SPECTRUM_CURVE,
      frequencyScale: FrequencyScale.LOGARITHMIC,
      colorPalette: 'pioneer-rgb',
      showGrid: true,
      showPeakHold: true
    }
  },
  {
    id: 'fast_live_bars',
    name: 'Fast Live Bars',
    isCustom: false,
    config: {
      fftSize: 512,
      smoothing: 0.50,
      visualizerMode: VisualizerMode.SPECTRUM_BARS,
      frequencyScale: FrequencyScale.LOGARITHMIC,
      colorPalette: 'pioneer-rgb',
      showGrid: true,
      showPeakHold: true
    }
  },
  {
    id: 'high_res_bars',
    name: 'High-Res Bars (Vertical)',
    isCustom: false,
    config: {
      fftSize: 4096,
      smoothing: 0.80,
      visualizerMode: VisualizerMode.SPECTRUM_BARS,
      frequencyScale: FrequencyScale.LOGARITHMIC,
      colorPalette: 'pioneer-rgb',
      showGrid: true,
      showPeakHold: true
    }
  }
];

export function SettingsPanel({
  config,
  setConfig,
  targetLoudness,
  setTargetLoudness,
  deck1ShowGrid,
  setDeck1ShowGrid,
  deck2ShowGrid,
  setDeck2ShowGrid
}: SettingsPanelProps) {
  const [customPresets, setCustomPresets] = usePersistentState<PresetItem[]>(
    'breach_analyzer_presets',
    [],
    (val) => Array.isArray(val)
  );

  const presets = React.useMemo(() => {
    return [...DEFAULT_PRESETS, ...customPresets];
  }, [customPresets]);

  const [newPresetName, setNewPresetName] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState<string>('');
  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Close presets list if clicked outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsPresetDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLoadPreset = (preset: PresetItem) => {
    setConfig((prev) => ({
      ...prev,
      ...preset.config
    }));
    if (preset.config.showGrid !== undefined) {
      if (setDeck1ShowGrid) {
        setDeck1ShowGrid(preset.config.showGrid);
      }
      if (setDeck2ShowGrid) {
        setDeck2ShowGrid(preset.config.showGrid);
      }
    }
    setIsPresetDropdownOpen(false);
  };

  const handleSavePreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;
    const newPreset: PresetItem = {
      id: `custom_${Date.now()}`,
      name: newPresetName.trim(),
      isCustom: true,
      config: {
        fftSize: config.fftSize,
        smoothing: config.smoothing,
        minDecibels: config.minDecibels,
        maxDecibels: config.maxDecibels,
        frequencyScale: config.frequencyScale,
        visualizerMode: config.visualizerMode,
        targetLoudness: config.targetLoudness,
        showGrid: config.showGrid,
        showPeakHold: config.showPeakHold,
        colorPalette: config.colorPalette,
        splitWaterfall: config.splitWaterfall
      }
    };
    const updatedCustom = [...customPresets, newPreset];
    setCustomPresets(updatedCustom);
    setNewPresetName('');
    window.dispatchEvent(new CustomEvent('breach_presets_updated'));
  };

  const handleDeletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedCustom = customPresets.filter(p => p.id !== id);
    setCustomPresets(updatedCustom);
    window.dispatchEvent(new CustomEvent('breach_presets_updated'));
  };

  const handleStartRename = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPresetId(id);
    setEditingPresetName(name);
  };

  const handleSaveRename = (id: string, e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editingPresetName.trim()) return;
    const updatedCustom = customPresets.map((p) => {
      if (p.id === id) {
        return { ...p, name: editingPresetName.trim() };
      }
      return p;
    });
    setCustomPresets(updatedCustom);
    setEditingPresetId(null);
    setEditingPresetName('');
    window.dispatchEvent(new CustomEvent('breach_presets_updated'));
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPresetId(null);
    setEditingPresetName('');
  };

  const activePreset = presets.find(preset => {
    return (
      config.fftSize === preset.config.fftSize &&
      Math.abs(config.smoothing - (preset.config.smoothing ?? 0)) < 0.01 &&
      config.visualizerMode === preset.config.visualizerMode &&
      config.colorPalette === preset.config.colorPalette
    );
  }) || { name: 'Custom Setup' };

  return (
    <div className="bg-[#1a1a1a] border border-[#4a4a4a] flex flex-col select-none w-full overflow-hidden" id="settings-panel-container">
      {/* Settings Grid Content */}
      <div className="flex flex-col p-3 space-y-3 flex-grow" id="settings-panel-content">
        <div className="flex flex-col divide-y divide-[#333333]" id="settings-panel-rows">
          
          {/* Section 1: Core Tuning Row */}
          <div 
            className="flex flex-col md:flex-row md:items-center py-3 gap-3" 
            id="settings-row-core"
            title="Core Analysis Tuning: Manually calibrate FFT window resolution, temporal averaging, spectral peak decay, and frequency scaling."
          >
            {/* LHS Section Label (Subtitle on hover) */}
            <div className="w-full md:w-1/4 flex items-center gap-2 text-[#F2F2F2] font-sans text-[11px] uppercase font-semibold tracking-[1.4px] cursor-default select-none shrink-0">
              <Sliders className="w-3.5 h-3.5 text-[#b20000] rotate-90" />
              <span>Core Tuning</span>
            </div>

            {/* RHS Horizontal Controls Group */}
            <div className="flex flex-row flex-wrap items-center gap-2 flex-grow">
              {/* FFT Size Selector */}
              <div 
                className="flex items-center gap-1.5 p-1 bg-[#181818] border border-[#4a4a4a] h-7"
                title="Set the Fast Fourier Transform block size. Larger sizes offer higher bass resolution but are slower."
              >
                <span className="text-[#858585] pl-1 text-[10px] font-sans font-medium uppercase tracking-[1px]">FFT:</span>
                <select
                  id="settings-select-fft-bins"
                  value={config.fftSize}
                  onChange={(e) => setConfig({ ...config, fftSize: parseInt(e.target.value) })}
                  className="bg-transparent border-0 text-[#F2F2F2] focus:outline-none cursor-pointer font-sans text-[11px] font-medium uppercase tracking-[0.5px] pr-1"
                >
                  <option value="512" className="bg-[#181818]">512</option>
                  <option value="1024" className="bg-[#181818]">1024</option>
                  <option value="2048" className="bg-[#181818]">2048</option>
                  <option value="4096" className="bg-[#181818]">4096</option>
                  <option value="8192" className="bg-[#181818]">8192</option>
                </select>
              </div>

              {/* Averaging (Smoothing) Slider */}
              <div 
                className="flex items-center gap-2 p-1 px-2.5 bg-[#181818] border border-[#4a4a4a] h-7 min-w-[140px] flex-grow md:flex-grow-0"
                title="Control how heavily the spectrum values are averaged over time (0.1 to 0.95)."
              >
                <div className="flex items-center gap-1 text-[10px] font-sans font-medium text-[#858585] uppercase tracking-[1px]">
                  <span>Averaging:</span>
                  <span className="text-[#F2F2F2] font-semibold">{Math.round(config.smoothing * 100)}%</span>
                </div>
                <input
                  id="settings-slider-fft-smoothing"
                  type="range"
                  min="0.1"
                  max="0.95"
                  step="0.05"
                  value={config.smoothing}
                  onChange={(e) => setConfig({ ...config, smoothing: parseFloat(e.target.value) })}
                  className="w-16 md:w-20 accent-[#b20000] h-1 bg-[#333333] cursor-pointer"
                />
              </div>

              {/* Peak Decay Selector */}
              <div 
                className="flex items-center gap-1.5 p-1 bg-[#181818] border border-[#4a4a4a] h-7"
                title="Configure the persistence duration of peak indicators."
              >
                <span className="text-[#858585] pl-1 text-[10px] font-sans font-medium uppercase tracking-[1px]">Peaks:</span>
                <select
                  id="settings-select-peak-hold-decay"
                  value={!config.showPeakHold ? 'off' : (config.peakHoldDecay !== undefined ? config.peakHoldDecay : 1000)}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'off') {
                      setConfig({ ...config, showPeakHold: false });
                    } else {
                      setConfig({ ...config, showPeakHold: true, peakHoldDecay: parseInt(val) });
                    }
                  }}
                  className="bg-transparent border-0 text-[#F2F2F2] focus:outline-none cursor-pointer font-sans text-[11px] font-medium uppercase tracking-[0.5px] pr-1"
                >
                  <option value="off" className="bg-[#181818]">Disabled</option>
                  <option value="500" className="bg-[#181818]">500ms</option>
                  <option value="1000" className="bg-[#181818]">1s Hold</option>
                  <option value="2000" className="bg-[#181818]">2s Hold</option>
                  <option value="999999" className="bg-[#181818]">Infinite</option>
                </select>
              </div>

              {/* Scale Selection */}
              {config.visualizerMode !== VisualizerMode.WAVEFORM && (
                <div 
                  className="flex items-center gap-1.5 p-1 bg-[#181818] border border-[#4a4a4a] h-7"
                  title="Configure the frequency axis scale. Logarithmic mimics human hearing; Linear is uniform."
                >
                  <span className="text-[#858585] pl-1 text-[10px] font-sans font-medium uppercase tracking-[1px]">Scale:</span>
                  <select
                    id="settings-btn-toggle-frequency-scale"
                    value={config.frequencyScale}
                    onChange={(e) => setConfig({ ...config, frequencyScale: e.target.value as FrequencyScale })}
                    className="bg-transparent border-0 text-[#F2F2F2] focus:outline-none cursor-pointer font-sans text-[11px] font-medium uppercase tracking-[0.5px] pr-1"
                  >
                    <option value={FrequencyScale.LOGARITHMIC} className="bg-[#181818]">Logarithmic</option>
                    <option value={FrequencyScale.LINEAR} className="bg-[#181818]">Linear</option>
                  </select>
                </div>
              )}

              {/* Quick Response Presets (Core Tuning) */}
              <div className="flex gap-1 shrink-0" id="settings-quick-response-presets">
                <button
                  type="button"
                  id="btn-quick-preset-high-res"
                  onClick={() => setConfig(prev => ({ ...prev, fftSize: 4096, smoothing: 0.85 }))}
                  className={`px-2 py-0.5 text-[10px] font-sans uppercase tracking-[0.8px] font-medium border transition-colors cursor-pointer h-7 ${
                    config.fftSize === 4096 && Math.abs(config.smoothing - 0.85) < 0.01
                      ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2]'
                      : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111]'
                  }`}
                  title="Configure High FFT Size (4096) and higher smoothing (0.85)."
                >
                  High Res
                </button>
                <button
                  type="button"
                  id="btn-quick-preset-fast-resp"
                  onClick={() => setConfig(prev => ({ ...prev, fftSize: 512, smoothing: 0.35 }))}
                  className={`px-2 py-0.5 text-[10px] font-sans uppercase tracking-[0.8px] font-medium border transition-colors cursor-pointer h-7 ${
                    config.fftSize === 512 && Math.abs(config.smoothing - 0.35) < 0.01
                      ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2]'
                      : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111]'
                  }`}
                  title="Configure Low FFT Size (512) and lower smoothing (0.35)."
                >
                  Fast Resp
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Compliance Target Row */}
          <div 
            className="flex flex-col md:flex-row md:items-center py-3 gap-3" 
            id="settings-row-compliance"
            title="Compliance Target: Select an industry-standard relative integrated LUFS alignment threshold or type a custom calibration target."
          >
            {/* LHS Section Label (Subtitle on hover) */}
            <div className="w-full md:w-1/4 flex items-center gap-2 text-[#F2F2F2] font-sans text-[11px] uppercase font-semibold tracking-[1.4px] cursor-default select-none shrink-0">
              <Volume2 className="w-3.5 h-3.5 text-[#b20000]" />
              <span>Compliance</span>
            </div>

            {/* RHS Horizontal Controls Group */}
            <div className="flex flex-row flex-wrap items-center gap-2 flex-grow">
              {/* Predefined Standard Select */}
              <div 
                className="flex items-center gap-1.5 p-1 bg-[#181818] border border-[#4a4a4a] h-7 flex-grow"
                title="Select a predefined industry-standard target loudness"
              >
                <span className="text-[#858585] pl-1 text-[10px] font-sans font-medium uppercase tracking-[1px]">Standard:</span>
                <select
                  id="settings-select-lufs"
                  value={targetLoudness}
                  onChange={(e) => setTargetLoudness(parseFloat(e.target.value))}
                  className="bg-transparent border-0 text-[#F2F2F2] font-sans text-[11px] font-medium uppercase tracking-[0.5px] focus:outline-none cursor-pointer flex-grow p-0.5"
                >
                  {![
                    LoudnessStandard.SPOTIFY,
                    LoudnessStandard.APPLE_MUSIC,
                    LoudnessStandard.GENRE_JUNGLE_DNB,
                    LoudnessStandard.GENRE_EDM,
                    LoudnessStandard.GENRE_TECHNO_HOUSE,
                    LoudnessStandard.GENRE_ROCK_METAL,
                    LoudnessStandard.GENERIC_MUSIC,
                    LoudnessStandard.GENRE_ACOUSTIC_INDIE,
                    LoudnessStandard.GENRE_JAZZ,
                    LoudnessStandard.GENRE_CLASSICAL,
                    LoudnessStandard.BROADCAST_EBU,
                    LoudnessStandard.BROADCAST_ATSC,
                    LoudnessStandard.CINEMATIC_TRAILER,
                    LoudnessStandard.PODCAST_AUDIOBOOK,
                    LoudnessStandard.FILM_MIX
                  ].includes(targetLoudness as any) && (
                    <option value={targetLoudness} disabled className="bg-[#181818] text-[#b20000] font-sans">
                      Custom ({typeof targetLoudness === 'number' ? targetLoudness.toFixed(1) : ''} LUFS)
                    </option>
                  )}
                  <optgroup label="Streaming Standards" className="bg-[#181818] text-[#b20000] font-bold text-[10px]">
                    <option value={LoudnessStandard.SPOTIFY} className="bg-[#181818] text-[#F2F2F2] font-sans">Spotify (-14.0 LUFS)</option>
                    <option value={LoudnessStandard.YOUTUBE} className="bg-[#181818] text-[#F2F2F2] font-sans">YouTube (-14.0 LUFS)</option>
                    <option value={LoudnessStandard.APPLE_MUSIC} className="bg-[#181818] text-[#F2F2F2] font-sans">Apple Music (-16.0 LUFS)</option>
                    <option value={LoudnessStandard.TIDAL_DEEZER} className="bg-[#181818] text-[#F2F2F2] font-sans">Tidal / Deezer (-14.0 LUFS)</option>
                  </optgroup>
                  
                  <optgroup label="Music Genres" className="bg-[#181818] text-[#b20000] font-bold text-[10px]">
                    <option value={LoudnessStandard.GENRE_JUNGLE_DNB} className="bg-[#181818] text-[#F2F2F2] font-sans">Jungle / DnB (-5.0 LUFS)</option>
                    <option value={LoudnessStandard.GENRE_EDM} className="bg-[#181818] text-[#F2F2F2] font-sans">EDM / Club (-6.0 LUFS)</option>
                    <option value={LoudnessStandard.GENRE_TECHNO_HOUSE} className="bg-[#181818] text-[#F2F2F2] font-sans">Techno / House (-8.0 LUFS)</option>
                    <option value={LoudnessStandard.GENRE_ROCK_METAL} className="bg-[#181818] text-[#F2F2F2] font-sans">Rock / Metal (-9.0 LUFS)</option>
                    <option value={LoudnessStandard.GENRE_HIPHOP_RAP} className="bg-[#181818] text-[#F2F2F2] font-sans">Hip-Hop / Rap (-9.0 LUFS)</option>
                    <option value={LoudnessStandard.GENERIC_MUSIC} className="bg-[#181818] text-[#F2F2F2] font-sans">Pop Music / Top 40 (-10.0 LUFS)</option>
                    <option value={LoudnessStandard.GENRE_ACOUSTIC_INDIE} className="bg-[#181818] text-[#F2F2F2] font-sans">Acoustic / Indie (-12.0 LUFS)</option>
                    <option value={LoudnessStandard.GENRE_JAZZ} className="bg-[#181818] text-[#F2F2F2] font-sans">Jazz / Fusion (-15.0 LUFS)</option>
                    <option value={LoudnessStandard.GENRE_CLASSICAL} className="bg-[#181818] text-[#F2F2F2] font-sans">Classical / Orchestral (-18.0 LUFS)</option>
                  </optgroup>

                  <optgroup label="Broadcast Standards" className="bg-[#181818] text-[#b20000] font-bold text-[10px]">
                    <option value={LoudnessStandard.BROADCAST_EBU} className="bg-[#181818] text-[#F2F2F2] font-sans">EBU R128 (-23.0 LUFS)</option>
                    <option value={LoudnessStandard.BROADCAST_ATSC} className="bg-[#181818] text-[#B8B8B8] font-sans">ATSC A/85 (-24.0 LUFS)</option>
                  </optgroup>

                  <optgroup label="Specialty & Mediums" className="bg-[#181818] text-[#b20000] font-bold text-[10px]">
                    <option value={LoudnessStandard.CINEMATIC_TRAILER} className="bg-[#181818] text-[#F2F2F2] font-sans">Cinematic Trailer (-13.0 LUFS)</option>
                    <option value={LoudnessStandard.PODCAST_AUDIOBOOK} className="bg-[#181818] text-[#F2F2F2] font-sans">Podcast / Audiobook (-16.0 LUFS)</option>
                    <option value={LoudnessStandard.FILM_MIX} className="bg-[#181818] text-[#F2F2F2] font-sans">Film Mix (-18.0 LUFS)</option>
                  </optgroup>
                </select>
              </div>

              {/* Custom Value Calibration Input */}
              <div className="flex items-center gap-1.5 p-1 bg-[#181818] border border-[#4a4a4a] h-7 justify-between shrink-0">
                <span className="text-[10px] text-[#858585] font-sans font-medium pl-1 uppercase tracking-[1px]">Custom Target:</span>
                <div className="flex items-center gap-1">
                  <input
                    id="settings-input-custom-lufs"
                    type="number"
                    min="-60"
                    max="0"
                    step="0.5"
                    value={typeof targetLoudness === 'number' ? targetLoudness : ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        setTargetLoudness(Math.max(-60, Math.min(0, val)));
                      } else if (e.target.value === '') {
                        setTargetLoudness('' as any);
                      }
                    }}
                    onBlur={() => {
                      if (typeof targetLoudness !== 'number' || isNaN(targetLoudness)) {
                        setTargetLoudness(-14);
                      }
                    }}
                    className="w-12 bg-[#121212] border border-[#4a4a4a] text-[#F2F2F2] font-sans font-medium text-[11px] text-center focus:outline-none focus:border-white p-0.5 h-5"
                  />
                  <span className="text-[10px] text-[#858585] font-sans font-medium pr-1">LUFS</span>
                </div>
              </div>
            </div>
          </div>



          {/* Section 4: Preset Manager Row */}
          <div 
            className="flex flex-col md:flex-row md:items-center py-3 gap-3 relative" 
            id="settings-row-preset"
            ref={dropdownRef}
            title="Visualizer Presets: Instantly load a preset layout or store your current settings variables."
          >
            {/* LHS Section Label (Subtitle on hover) */}
            <div className="w-full md:w-1/4 flex items-center gap-2 text-[#F2F2F2] font-sans text-[11px] uppercase font-semibold tracking-[1.4px] cursor-default select-none shrink-0">
              <Sliders className="w-3.5 h-3.5 text-[#b20000]" />
              <span>Presets</span>
            </div>

            {/* RHS Horizontal Controls Group */}
            <div className="flex flex-row flex-wrap items-center gap-2 flex-grow">
              {/* Presets loader drop trigger */}
              <div className="relative flex-grow min-w-[120px]">
                <button
                  id="btn-settings-presets-dropdown"
                  onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                  className="flex items-center justify-between p-1 px-2.5 bg-[#181818] border border-[#4a4a4a] text-[#B8B8B8] hover:text-[#F2F2F2] cursor-pointer select-none transition-colors w-full h-7"
                >
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className="text-[10px] font-sans text-[#858585] uppercase tracking-[1px] font-medium">Load:</span>
                    <span className="text-[11px] font-sans font-medium text-[#b20000] uppercase tracking-[0.5px] truncate">{activePreset.name}</span>
                  </div>
                  <span className="text-[9px] text-[#858585]">▼</span>
                </button>

                {/* Flyout presets list */}
                {isPresetDropdownOpen && (
                  <div className="absolute bottom-full mb-1 left-0 right-0 z-50 bg-[#181818] border border-[#4a4a4a] shadow-2xl p-2 flex flex-col gap-1.5 max-h-[160px] overflow-y-auto" id="settings-presets-dropdown-menu">
                    <div className="text-[10px] uppercase tracking-[1px] font-semibold text-[#F2F2F2] border-b border-[#4a4a4a] pb-1 flex justify-between items-center font-sans">
                      <span>Saved Presets</span>
                      <span className="text-[10px] uppercase text-[#858585]">Click to Load</span>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      {presets.map((preset) => {
                        const isActive = activePreset.name === preset.name;
                        const isEditing = editingPresetId === preset.id;

                        if (isEditing) {
                          return (
                            <div
                              key={preset.id}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center justify-between p-1 border bg-[#121212] border-[#4a4a4a]"
                            >
                              <form
                                onSubmit={(e) => handleSaveRename(preset.id, e)}
                                className="flex items-center gap-1 w-full"
                              >
                                <input
                                  type="text"
                                  value={editingPresetName}
                                  onChange={(e) => setEditingPresetName(e.target.value)}
                                  className="flex-grow bg-[#181818] border border-[#b20000] px-1 text-[11px] text-[#F2F2F2] focus:outline-none font-sans uppercase tracking-[0.5px]"
                                  maxLength={24}
                                  autoFocus
                                />
                                <button
                                  type="submit"
                                  className="text-emerald-400 hover:text-white p-0.5"
                                  title="Save"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelRename}
                                  className="text-[#ff4444] hover:text-white p-0.5"
                                  title="Cancel"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </form>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={preset.id}
                            onClick={() => handleLoadPreset(preset)}
                            className={`group relative flex items-center justify-between pl-2 pr-1.5 py-1 border text-left cursor-pointer transition-colors ${
                              isActive 
                                ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2]' 
                                : 'bg-[#121212] border-[#4a4a4a] hover:bg-white hover:text-[#111111]'
                            }`}
                          >
                            <div className="flex flex-col pr-4 overflow-hidden">
                              <span className="text-[11px] font-sans font-medium uppercase tracking-[0.5px] leading-tight truncate">{preset.name}</span>
                              <span className="text-[10px] font-sans uppercase tracking-[0.5px] opacity-75 mt-0.5 leading-none">
                                FFT: {preset.config.fftSize} · Smth: {preset.config.smoothing?.toFixed(1)}
                              </span>
                            </div>

                            {preset.isCustom ? (
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={(e) => handleStartRename(preset.id, preset.name, e)}
                                  className="text-[#858585] hover:text-[#F2F2F2] p-0.5"
                                  title="Rename"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(e) => handleDeletePreset(preset.id, e)}
                                  className="text-[#858585] hover:text-[#F2F2F2] p-0.5"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] font-sans font-medium uppercase bg-[#181818] text-[#858585] px-1 py-0.5 border border-[#4a4a4a] leading-none">
                                Core
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Save Current Config as Custom Preset */}
              <form onSubmit={handleSavePreset} className="flex items-center gap-1.5 flex-grow min-w-[150px]">
                <input
                  type="text"
                  placeholder="SAVE CURRENT SETUP..."
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="flex-grow bg-[#181818] border border-[#4a4a4a] focus:border-white px-2 text-[11px] text-[#F2F2F2] focus:outline-none font-sans uppercase tracking-[0.5px] h-7 placeholder:text-[#666666]"
                  maxLength={24}
                />
                <button
                  type="submit"
                  disabled={!newPresetName.trim()}
                  className="px-2.5 bg-[#181818] hover:bg-[#b20000] border border-[#4a4a4a] hover:border-[#b20000] text-[#F2F2F2] font-sans text-[11px] font-medium uppercase tracking-[0.8px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap h-7 flex items-center justify-center gap-1 shrink-0"
                >
                  <Save className="w-3 h-3" />
                  <span>Save</span>
                </button>
              </form>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
