/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import { Maximize2, Minimize2, Eye, EyeOff, BarChart2, TrendingUp, Compass, Activity, Palette, Cpu, Disc, Zap, ExternalLink, Sliders, Trash2, Pencil, Check, X, RefreshCw, Waves, AudioLines, Snowflake } from 'lucide-react';
import { AnalyzerConfig, VisualizerMode, FrequencyScale, AudioSourceType, GeneratorSignalType, FrequencyMarker } from '../types';
import { audioAnalyzer, useStreamMetadata } from '../audioEngine';
import { COLOR_PALETTES, resolvePalette, frequencyToNote, formatDB } from '../utils';
import { usePersistentState, SafeStorage } from '../utils/storage';
import { FloatingWindow } from './FloatingWindow';
import { ResetButton, PopOutButton } from './SharedButtons';

interface PresetItem {
  id: string;
  name: string;
  isCustom: boolean;
  config: Partial<AnalyzerConfig>;
}

const DEFAULT_PRESETS: PresetItem[] = [
  {
    id: 'breach_bars',
    name: 'Breach bars',
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
    id: 'high_res_curve',
    name: 'High-Res Curve',
    isCustom: false,
    config: {
      fftSize: 2048,
      smoothing: 0.80,
      visualizerMode: VisualizerMode.SPECTRUM_CURVE,
      frequencyScale: FrequencyScale.LINEAR,
      colorPalette: 'synthwave',
      showGrid: false,
      showPeakHold: false
    }
  },
  {
    id: 'dynamic_waveform',
    name: 'Dynamic Waveform (Osc)',
    isCustom: false,
    config: {
      fftSize: 1024,
      smoothing: 0.40,
      visualizerMode: VisualizerMode.WAVEFORM,
      frequencyScale: FrequencyScale.LINEAR,
      colorPalette: 'crimson-red',
      showGrid: true,
      showPeakHold: false
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
      colorPalette: 'neon-cyan',
      showGrid: true,
      showPeakHold: true
    }
  },
  {
    id: 'monochrome_slate_bars',
    name: 'Slate Monochrome',
    isCustom: false,
    config: {
      fftSize: 2048,
      smoothing: 0.80,
      visualizerMode: VisualizerMode.SPECTRUM_CURVE,
      frequencyScale: FrequencyScale.LOGARITHMIC,
      colorPalette: 'monochrome-slate',
      showGrid: true,
      showPeakHold: true
    }
  }
];


/**
 * Helper to compute an interpolated or peak decibel value for a frequency range.
 * - Prevents choppy/stair-stepped low-end display via sub-bin linear interpolation.
 * - Prevents high-frequency resonant peaks from flickering out via max energy pooling.
 */
function getInterpolatedDbForFreq(
  freq: number,
  nextFreq: number,
  freqData: Float32Array,
  totalBins: number,
  sampleRate: number
): number {
  if (!sampleRate || isNaN(sampleRate) || sampleRate <= 0) {
    return -120;
  }

  const fftSize = totalBins * 2;
  const binFloat1 = freq * fftSize / sampleRate;
  const binFloat2 = nextFreq * fftSize / sampleRate;

  // Clamp bin targets to [1.0, totalBins - 1.0] to safeguard math and bypass DC 0Hz offset bleed
  const clampedBinFloat1 = Math.min(totalBins - 1, Math.max(1, binFloat1));
  const clampedBinFloat2 = Math.min(totalBins - 1, Math.max(1, binFloat2));

  const binLower = Math.floor(clampedBinFloat1);
  const binUpper = Math.ceil(clampedBinFloat2);

  if (binUpper - binLower <= 1) {
    // Zoomed in (low frequencies): multiple screens pixels map to a single bin.
    // Linear-interpolate between adjacent bins for fluid, accurate low-end motion.
    const nextIndex = Math.min(totalBins - 1, binLower + 1);
    const weight = clampedBinFloat1 - binLower;
    const dbValue = freqData[binLower] * (1 - weight) + freqData[nextIndex] * weight;
    return isNaN(dbValue) || dbValue === -Infinity ? -120 : dbValue;
  } else {
    // Zoomed out (mid/high frequencies): one screen pixel covers multiple FFT bins.
    // Pool the maximum value across the range to accurately capture resonant peaks.
    let maxDb = -120;
    for (let b = binLower; b <= binUpper; b++) {
      const dbValue = freqData[b];
      if (dbValue > maxDb && !isNaN(dbValue) && dbValue !== -Infinity) {
        maxDb = dbValue;
      }
    }
    return maxDb;
  }
}

interface AnalyserCanvasProps {
  config: AnalyzerConfig;
  setConfig: React.Dispatch<React.SetStateAction<AnalyzerConfig>>;
  isPlaying: boolean;
  onSourceChanged: (type: AudioSourceType) => void;
  activeSourceType: AudioSourceType;
  setIsPlaying: (playing: boolean) => void;
  togglePlaybackRef: React.MutableRefObject<(() => void) | null>;
  fileUrl: string;
  setFileUrl: (url: string) => void;
  fileName: string;
  setFileName: (name: string) => void;
  hardwareSampleRate: number;
  isFullscreen: boolean;
  setIsFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleFullscreenRef: React.MutableRefObject<(() => void) | null>;
  onPopOut?: () => void;
  isPoppedOut?: boolean;
  resetRef?: React.MutableRefObject<(() => void) | null>;
  deck1ShowGrid?: boolean;
  setDeck1ShowGrid?: (val: boolean) => void;
  deck2ShowGrid?: boolean;
  setDeck2ShowGrid?: (val: boolean) => void;
  onlyRenderSplit?: boolean;       // Render only secondary waterfall/split panel
  hideSplitWaterfall?: boolean;    // Hide the secondary waterfall/split panel in this instance
}

interface WaveformOscilloscopeDeckHeaderProps {
  secondaryMode: 'split' | 'spectrogram' | 'oscilloscope' | 'waveform';
  setSecondaryMode: (mode: 'split' | 'spectrogram' | 'oscilloscope') => void;
  isDeckFrozen: boolean;
  onToggleFreeze: () => void;
  oscTimebase: number;
  setOscTimebase: (v: number) => void;
  oscTriggerThreshold: number;
  setOscTriggerThreshold: (v: number) => void;
  secondaryHeight: number;
  setSecondaryHeight: (v: number) => void;
  deck2ShowGrid: boolean;
  setDeck2ShowGrid: (v: boolean) => void;
  onResetPeaks: () => void;
  onPopOut: () => void;
}

const WaveformOscilloscopeDeckHeader: React.FC<WaveformOscilloscopeDeckHeaderProps> = ({
  secondaryMode,
  setSecondaryMode,
  isDeckFrozen,
  onToggleFreeze,
  oscTimebase,
  setOscTimebase,
  oscTriggerThreshold,
  setOscTriggerThreshold,
  secondaryHeight,
  setSecondaryHeight,
  deck2ShowGrid,
  setDeck2ShowGrid,
  onResetPeaks,
  onPopOut
}) => {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between p-3 bg-[#121212] border-b border-[#4a4a4a] z-10 gap-2.5" id="secondary-visualizer-header">
      {/* Left: Deck Branding, Mode Selector Dropdown, Freeze, Timebase, Trigger */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex items-center gap-2 mr-1">
          <div className="p-1.5 bg-[#181818] border border-[#4a4a4a] flex items-center justify-center text-[#b20000]">
            <Waves className="w-4 h-4 text-[#b20000]" />
          </div>
          <h2 className="text-xs font-semibold tracking-[1.4px] text-[#F2F2F2] font-sans uppercase">
            Spectrogram / Oscilloscope Deck
          </h2>
        </div>

        {/* View Mode Dropdown */}
        <div 
          className="flex items-center gap-1.5 p-1 bg-[#181818] border border-[#4a4a4a] h-7"
          title="Select visualizer display mode"
          id="select-deck2-mode-container"
        >
          <span className="text-[#B8B8B8] pl-1 text-[11px] font-sans font-medium uppercase tracking-[1px]">Mode:</span>
          <select
            id="select-deck2-mode-dropdown"
            value={secondaryMode === 'waveform' ? 'spectrogram' : secondaryMode}
            onChange={(e) => setSecondaryMode(e.target.value as 'split' | 'spectrogram' | 'oscilloscope')}
            className="bg-transparent border-0 text-[#F2F2F2] focus:outline-none cursor-pointer font-sans text-[11px] font-medium uppercase tracking-[1px] pr-1"
          >
            <option value="spectrogram" className="bg-[#181818]">Spectrogram</option>
            <option value="oscilloscope" className="bg-[#181818]">Oscilloscope</option>
            <option value="split" className="bg-[#181818]">Split (Spectrogram / Osc)</option>
          </select>
        </div>

        {/* Freeze Button: halts canvas animation frame updates for detailed inspection */}
        <button
          type="button"
          id="btn-deck2-freeze-toggle"
          onClick={onToggleFreeze}
          className={`px-2.5 py-1 text-[11px] font-sans font-medium uppercase tracking-[1px] border transition-colors cursor-pointer h-7 flex items-center justify-center gap-1.5 select-none ${
            isDeckFrozen
              ? 'bg-[#b20000] border-[#b20000] text-white'
              : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-white hover:text-[#111111]'
          }`}
          title={isDeckFrozen ? 'Click to unfreeze and resume real-time audio visualization' : 'Halt canvas animation frame updates to inspect specific audio transients in detail'}
        >
          <Snowflake className={`w-3.5 h-3.5 ${isDeckFrozen ? 'text-white' : 'text-[#b20000]'}`} />
          <span>{isDeckFrozen ? 'Frozen' : 'Freeze'}</span>
        </button>

        {/* Horizontal Timebase Scale Zoom Slider */}
        <div 
          className="flex items-center gap-1.5 bg-[#181818] border border-[#4a4a4a] px-2 py-1 select-none transition-colors h-7" 
          title="Adjust oscilloscope horizontal timebase scale (zoom in/out: 0.25x to 4.00x)"
          id="control-deck2-timebase"
        >
          <span className="text-[#B8B8B8] text-[11px] uppercase font-sans font-medium tracking-[1px]">Timebase:</span>
          <input
            id="slider-deck2-timebase"
            type="range"
            min="0.25"
            max="4.0"
            step="0.25"
            value={oscTimebase}
            onChange={(e) => setOscTimebase(parseFloat(e.target.value))}
            className="w-14 accent-[#b20000] h-1 bg-[#121212] cursor-pointer"
          />
          <span className="text-[#F2F2F2] font-sans text-[11px] w-8 text-right font-semibold shrink-0">
            {oscTimebase.toFixed(2)}x
          </span>
          {oscTimebase !== 1.0 && (
            <button
              type="button"
              onClick={() => setOscTimebase(1.0)}
              className="text-[10px] font-sans font-semibold text-[#858585] hover:text-white cursor-pointer ml-0.5 uppercase"
              title="Reset timebase to 1.00x"
            >
              1x
            </button>
          )}
        </div>

        {/* Trigger Threshold Adjustment Slider */}
        <div 
          className="flex items-center gap-1.5 bg-[#181818] border border-[#4a4a4a] px-2 py-1 select-none transition-colors h-7" 
          title="Adjust oscilloscope trigger threshold (-90% to +90%) to lock and stabilize waveform"
          id="control-deck2-trigger-threshold"
        >
          <span className="text-[#B8B8B8] text-[11px] uppercase font-sans font-medium tracking-[1px]">Trigger:</span>
          <input
            id="slider-deck2-trigger-threshold"
            type="range"
            min="-90"
            max="90"
            step="5"
            value={oscTriggerThreshold}
            onChange={(e) => setOscTriggerThreshold(parseInt(e.target.value))}
            className="w-14 accent-[#b20000] h-1 bg-[#121212] cursor-pointer"
          />
          <span className="text-[#F2F2F2] font-sans text-[11px] w-8 text-right font-semibold shrink-0">
            {oscTriggerThreshold > 0 ? '+' : ''}{oscTriggerThreshold}%
          </span>
          {oscTriggerThreshold !== 0 && (
            <button
              type="button"
              onClick={() => setOscTriggerThreshold(0)}
              className="text-[10px] font-sans font-semibold text-[#858585] hover:text-white cursor-pointer ml-0.5 uppercase"
              title="Reset trigger threshold to zero crossing (0%)"
            >
              0
            </button>
          )}
        </div>
      </div>

      {/* Right Controls Container: Anchored top right corner (Height, Grid, Reset, Popout) */}
      <div className="flex items-center gap-2 ml-auto shrink-0" id="waveform-panel-upper-right-anchors">
        {/* Height Slider */}
        <div 
          className="flex items-center gap-1.5 bg-[#181818] border border-[#4a4a4a] px-2 py-1 select-none transition-colors h-7" 
          title="Adjust the vertical height of the deck (80px to 300px)"
          id="header-secondary-height-control"
        >
          <span className="text-[#B8B8B8] text-[11px] uppercase font-sans font-medium tracking-[1px]">Height:</span>
          <input
            id="slider-header-split-height"
            type="range"
            min="80"
            max="300"
            step="10"
            value={secondaryHeight}
            onChange={(e) => setSecondaryHeight(parseInt(e.target.value))}
            className="w-14 accent-[#b20000] h-1 bg-[#121212] cursor-pointer"
          />
          <span className="text-[#F2F2F2] font-sans text-[11px] w-8 text-right font-semibold shrink-0">{secondaryHeight}px</span>
        </div>

        {/* Grid Toggle Button */}
        <button
          type="button"
          id="btn-deck2-grid-toggle"
          onClick={() => setDeck2ShowGrid(!deck2ShowGrid)}
          className={`px-2.5 py-1 text-[11px] font-sans font-medium uppercase tracking-[1px] border transition-colors cursor-pointer h-7 flex items-center justify-center select-none ${
            deck2ShowGrid
              ? 'bg-[#b20000] border-[#b20000] text-white'
              : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-white hover:text-[#111111]'
          }`}
          title="Toggle measurement grid lines"
        >
          Grid
        </button>

        {/* Refresh / Reset Peaks Button */}
        <ResetButton
          id="btn-header-secondary-reset-peaks"
          onClick={onResetPeaks}
          title="Refresh waveform and clear all transient data"
        />

        {/* Pop Out Button */}
        <PopOutButton
          onClick={onPopOut}
          title="Pop out waveform panel to a floating window"
          id="btn-popout-secondary-visualizer"
        />
      </div>
    </div>
  );
};

export function AnalyserCanvas({ 
  config, 
  setConfig, 
  isPlaying,
  onSourceChanged,
  activeSourceType,
  setIsPlaying,
  togglePlaybackRef,
  fileUrl,
  setFileUrl,
  fileName,
  setFileName,
  hardwareSampleRate,
  isFullscreen,
  setIsFullscreen,
  toggleFullscreenRef,
  onPopOut,
  isPoppedOut = false,
  resetRef,
  deck1ShowGrid: propDeck1ShowGrid,
  setDeck1ShowGrid: propSetDeck1ShowGrid,
  deck2ShowGrid: propDeck2ShowGrid,
  setDeck2ShowGrid: propSetDeck2ShowGrid,
  onlyRenderSplit = false,
  hideSplitWaterfall = false
}: AnalyserCanvasProps) {
  const [secondaryMode, setSecondaryMode] = usePersistentState<'split' | 'spectrogram' | 'oscilloscope' | 'waveform'>(
    'breach_secondary_deck_mode',
    'spectrogram',
    (val) => val === 'split' || val === 'spectrogram' || val === 'oscilloscope' || val === 'waveform'
  );

  // Oscilloscope Trigger Threshold state (-90% to +90%, 0 = center zero-crossing)
  const [oscTriggerThreshold, setOscTriggerThreshold] = usePersistentState<number>(
    'breach_osc_trigger_threshold',
    0,
    (val) => typeof val === 'number'
  );
  const oscTriggerThresholdRef = useRef<number>(oscTriggerThreshold);
  useEffect(() => {
    oscTriggerThresholdRef.current = oscTriggerThreshold;
  }, [oscTriggerThreshold]);

  // Oscilloscope Horizontal Timebase Zoom state (0.25x to 4.00x)
  const [oscTimebase, setOscTimebase] = usePersistentState<number>(
    'breach_osc_timebase',
    1.0,
    (val) => typeof val === 'number'
  );
  const oscTimebaseRef = useRef<number>(oscTimebase);
  useEffect(() => {
    oscTimebaseRef.current = oscTimebase;
  }, [oscTimebase]);

  // Freeze state to halt canvas animation frame updates for transient inspection
  const [isDeckFrozen, setIsDeckFrozen] = useState<boolean>(false);
  const frozenTimeDataRef = useRef<Uint8Array | null>(null);
  const isDeckFrozenRef = useRef<boolean>(false);
  useEffect(() => {
    isDeckFrozenRef.current = isDeckFrozen;
  }, [isDeckFrozen]);

  const lastModeRef = useRef<string>('waterfall');
  const splitWaterfall = onlyRenderSplit ? true : hideSplitWaterfall ? false : true;

  const [primaryHeight, setPrimaryHeight] = usePersistentState<number>(
    'breach_primary_height',
    320,
    (val) => typeof val === 'number'
  );

  useEffect(() => {
    if (resetRef) {
      resetRef.current = handleResetPeaks;
    }
    return () => {
      if (resetRef) {
        resetRef.current = null;
      }
    };
  }, [resetRef]);

  const [secondaryHeight, setSecondaryHeight] = usePersistentState<number>(
    'breach_secondary_height',
    150,
    (val) => typeof val === 'number'
  );

  const [zoomMin, setZoomMin] = usePersistentState<number>(
    'breach_zoom_min',
    20,
    (val) => typeof val === 'number'
  );

  const [zoomMax, setZoomMax] = usePersistentState<number>(
    'breach_zoom_max',
    20000,
    (val) => typeof val === 'number'
  );

  const showHistory = config.showPeakHold;

  const sliderToFreq = (val: number) => {
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    return Math.round(Math.pow(10, minLog + (val / 100) * (maxLog - minLog)));
  };

  const freqToSlider = (freq: number) => {
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    return Math.round(((Math.log10(freq) - minLog) / (maxLog - minLog)) * 100);
  };

  const handleZoomMinChange = (val: number) => {
    const freq = sliderToFreq(val);
    if (freq < zoomMax - 10) {
      setZoomMin(freq);
    }
  };

  const handleZoomMaxChange = (val: number) => {
    const freq = sliderToFreq(val);
    if (freq > zoomMin + 10) {
      setZoomMax(freq);
    }
  };

  const [localDeck1ShowGrid, setLocalDeck1ShowGrid] = usePersistentState<boolean>(
    'breach_deck1_show_grid',
    true,
    (val) => typeof val === 'boolean'
  );
  const deck1ShowGrid = propDeck1ShowGrid !== undefined ? propDeck1ShowGrid : localDeck1ShowGrid;
  const setDeck1ShowGrid = propSetDeck1ShowGrid !== undefined ? propSetDeck1ShowGrid : setLocalDeck1ShowGrid;

  const [localDeck2ShowGrid, setLocalDeck2ShowGrid] = usePersistentState<boolean>(
    'breach_deck2_show_grid',
    true,
    (val) => typeof val === 'boolean'
  );
  const deck2ShowGrid = propDeck2ShowGrid !== undefined ? propDeck2ShowGrid : localDeck2ShowGrid;
  const setDeck2ShowGrid = propSetDeck2ShowGrid !== undefined ? propSetDeck2ShowGrid : setLocalDeck2ShowGrid;

  const streamMetadata = useStreamMetadata();

  // Presets State & Management
  const [isPresetOpen, setIsPresetOpen] = useState(false);
  const [customPresets, setCustomPresets] = usePersistentState<PresetItem[]>(
    'breach_analyzer_presets',
    [],
    (val) => Array.isArray(val)
  );

  const presets = React.useMemo(() => {
    return [...DEFAULT_PRESETS, ...customPresets];
  }, [customPresets]);

  const [newPresetName, setNewPresetName] = useState('');
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Click outside handler for presets dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsPresetOpen(false);
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
      setDeck1ShowGrid(preset.config.showGrid);
      setDeck2ShowGrid(preset.config.showGrid);
    }
    setIsPresetOpen(false);
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

  // Preset Rename & History Ref
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState<string>('');
  const curveHistoryRef = useRef<{
    buffer: Float32Array[];
    head: number;
    size: number;
    maxSize: number;
  }>({
    buffer: [],
    head: -1,
    size: 0,
    maxSize: 6
  });

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
      config.visualizerMode === preset.config.visualizerMode
    );
  }) || { name: 'Custom Setup' };
  const palette = resolvePalette(config.colorPalette, config.customColors);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inlineWaterfallCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const popoutWaterfallCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number | null>(null);

  const peakHoldArrayRef = useRef<number[]>([]);
  const peakHoldTimeArrayRef = useRef<number[]>([]);
  const spectrogramPrimaryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrogramSecondaryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Spectral Peaks History Refs (Requirement 3)
  const spectralPeaksHistoryRef = useRef<Float32Array[]>([]);
  const lastHistorySnapshotTimeRef = useRef<number>(0);

  // Mouse interactivity coordinates
  const [hoverData, setHoverData] = useState<{ x: number; y: number; freq: number; db: number; note: string } | null>(null);
  const [hoverDataWaterfall, setHoverDataWaterfall] = useState<{ x: number; y: number; freq: number; db: number; note: string } | null>(null);
  const [isSplitPanelPoppedOut, setIsSplitPanelPoppedOut] = useState<boolean>(false);

  // Interactive Frequency Markers State
  const activeMarkers = config.frequencyMarkers || [];
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null);
  const [isHoveringMarker, setIsHoveringMarker] = useState<boolean>(false);
  const liveMarkerDbRef = useRef<Record<string, number>>({});
  const [markerDbSnapshot, setMarkerDbSnapshot] = useState<Record<string, number>>({});

  // Synchronize periodic marker decibel snapshots for smooth UI badge updates
  useEffect(() => {
    const timer = setInterval(() => {
      if (activeMarkers.length > 0) {
        setMarkerDbSnapshot({ ...liveMarkerDbRef.current });
      }
    }, 120);
    return () => clearInterval(timer);
  }, [activeMarkers.length]);

  // Global mouseup listener to terminate drag operations safely
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setDraggingMarkerId(null);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const addMarkerAtFreq = (frequency: number, label?: string) => {
    const clampedFreq = Math.round(Math.max(20, Math.min(20000, frequency)));
    const defaultLabel = label || (
      clampedFreq < 120 ? 'SUB' :
      clampedFreq < 400 ? 'BASS' :
      clampedFreq < 2000 ? 'MID' :
      clampedFreq < 6000 ? 'PRESENCE' : 'AIR'
    );
    const newMarker: FrequencyMarker = {
      id: `marker_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      frequency: clampedFreq,
      label: defaultLabel
    };
    setConfig(prev => ({
      ...prev,
      frequencyMarkers: [...(prev.frequencyMarkers || []), newMarker]
    }));
  };

  const removeMarker = (id: string) => {
    setConfig(prev => ({
      ...prev,
      frequencyMarkers: (prev.frequencyMarkers || []).filter(m => m.id !== id)
    }));
  };

  const clearAllMarkers = () => {
    setConfig(prev => ({
      ...prev,
      frequencyMarkers: []
    }));
  };

  // Re-usable data arrays for high-frequency renders To minimize GC thrashing
  const floatFreqArrayRef = useRef<Float32Array | null>(null);
  const byteTimeArrayRef = useRef<Uint8Array | null>(null);
  const curveYCoordinatesRef = useRef<Float32Array | null>(null);

  // Progressive Waveform Accumulator Ref (records amplitude envelope as playback is ongoing)
  const MAX_PROGRESSIVE_SLOTS = 1200;
  const progressiveWaveformRef = useRef<{
    mins: Float32Array;
    maxs: Float32Array;
    rms: Float32Array;
    formed: Uint8Array;
    lastSlot: number;
    writeIndex: number;
    lastFileUrl: string;
  }>({
    mins: new Float32Array(MAX_PROGRESSIVE_SLOTS),
    maxs: new Float32Array(MAX_PROGRESSIVE_SLOTS),
    rms: new Float32Array(MAX_PROGRESSIVE_SLOTS),
    formed: new Uint8Array(MAX_PROGRESSIVE_SLOTS),
    lastSlot: -1,
    writeIndex: 0,
    lastFileUrl: ''
  });

  useEffect(() => {
    if (progressiveWaveformRef.current) {
      progressiveWaveformRef.current.mins.fill(0);
      progressiveWaveformRef.current.maxs.fill(0);
      progressiveWaveformRef.current.rms.fill(0);
      progressiveWaveformRef.current.formed.fill(0);
      progressiveWaveformRef.current.lastSlot = -1;
      progressiveWaveformRef.current.writeIndex = 0;
      progressiveWaveformRef.current.lastFileUrl = fileUrl || '';
    }
  }, [fileUrl]);

  const spectrogramHistoryRef = useRef<{
    buffer: { freqData: Float32Array; timestamp: number }[];
    head: number;
    size: number;
    maxSize: number;
  }>({
    buffer: [],
    head: -1,
    size: 0,
    maxSize: 500
  });

  const getHistoryFrame = (index: number) => {
    const hist = spectrogramHistoryRef.current;
    if (index < 0 || index >= hist.size) return null;
    const targetIdx = (hist.head - index + hist.maxSize) % hist.maxSize;
    return hist.buffer[targetIdx];
  };

  // Grid constants
  const FREQ_LOG_GRID = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const FREQ_LIN_GRID = [1000, 4000, 8000, 12000, 16000, 20000];
  const DB_GRID = [0, -10, -20, -30, -40, -50, -60, -70, -80, -90, -100, -110, -120];

  // Map mouse hover to audio coordinate information
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scaleX;

    const plotLeft = 48;
    const drawWidth = Math.max(10, canvas.width - plotLeft - 14);
    const markers = config.frequencyMarkers || [];

    let hitMarkerId: string | null = null;
    let minDistance = 22; // Generous hit area for clicking marker handles and lines

    markers.forEach(m => {
      let rX = 0;
      if (config.frequencyScale === FrequencyScale.LOGARITHMIC) {
        const logMin = Math.log10(zoomMin);
        const logMax = Math.log10(zoomMax);
        rX = (Math.log10(m.frequency) - logMin) / (logMax - logMin);
      } else {
        rX = (m.frequency - zoomMin) / (zoomMax - zoomMin);
      }
      const mx = plotLeft + rX * drawWidth;
      const dist = Math.abs(x - mx);
      if (dist < minDistance) {
        minDistance = dist;
        hitMarkerId = m.id;
      }
    });

    if (hitMarkerId) {
      setDraggingMarkerId(hitMarkerId);
      e.preventDefault();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scaleX;

    const plotLeft = 48;
    const drawWidth = Math.max(10, canvas.width - plotLeft - 14);
    const clampedX = Math.max(0, Math.min(drawWidth, x - plotLeft));
    const ratioX = clampedX / drawWidth;

    let clickedFreq = 0;
    if (config.frequencyScale === FrequencyScale.LOGARITHMIC) {
      const logMin = Math.log10(zoomMin);
      const logMax = Math.log10(zoomMax);
      clickedFreq = Math.pow(10, logMin + ratioX * (logMax - logMin));
    } else {
      clickedFreq = zoomMin + ratioX * (zoomMax - zoomMin);
    }
    addMarkerAtFreq(clickedFreq);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setHoverDataWaterfall(null); // Clear secondary canvas overlay crosshair

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const plotLeft = 48;
    const drawWidth = Math.max(10, canvas.width - plotLeft - 14);
    const adjustedX = x - plotLeft;

    // 1. If currently dragging a marker, update its frequency in real time
    if (draggingMarkerId) {
      const clampedX = Math.max(0, Math.min(drawWidth, adjustedX));
      const ratioX = clampedX / drawWidth;
      let newFreq = 0;
      if (config.frequencyScale === FrequencyScale.LOGARITHMIC) {
        const logMin = Math.log10(zoomMin);
        const logMax = Math.log10(zoomMax);
        newFreq = Math.pow(10, logMin + ratioX * (logMax - logMin));
      } else {
        newFreq = zoomMin + ratioX * (zoomMax - zoomMin);
      }
      newFreq = Math.round(Math.max(20, Math.min(20000, newFreq)));

      setConfig(prev => ({
        ...prev,
        frequencyMarkers: (prev.frequencyMarkers || []).map(m =>
          m.id === draggingMarkerId ? { ...m, frequency: newFreq } : m
        )
      }));
      setHoverData(null);
      return;
    }

    // 2. Check if cursor is hovering close to any marker
    const markers = config.frequencyMarkers || [];
    let isNearMarker = false;
    markers.forEach(m => {
      let rX = 0;
      if (config.frequencyScale === FrequencyScale.LOGARITHMIC) {
        const logMin = Math.log10(zoomMin);
        const logMax = Math.log10(zoomMax);
        rX = (Math.log10(m.frequency) - logMin) / (logMax - logMin);
      } else {
        rX = (m.frequency - zoomMin) / (zoomMax - zoomMin);
      }
      const mx = plotLeft + rX * drawWidth;
      if (Math.abs(x - mx) <= 16) {
        isNearMarker = true;
      }
    });
    setIsHoveringMarker(isNearMarker);

    if (adjustedX < 0 || adjustedX > drawWidth) {
      setHoverData(null);
      return;
    }

    // Relative mouse X position (0 to 1) inside padded drawing area
    const ratioX = adjustedX / drawWidth;
    let freq = 0;

    if (config.frequencyScale === FrequencyScale.LOGARITHMIC) {
      const logMin = Math.log10(zoomMin);
      const logMax = Math.log10(zoomMax);
      const logVal = logMin + ratioX * (logMax - logMin);
      freq = Math.pow(10, logVal);
    } else {
      freq = zoomMin + ratioX * (zoomMax - zoomMin); // Linear projection
    }

    // Map Y position back to decibel levels inside vertical plot area
    const plotHeight = Math.max(10, canvas.height - 22);
    const ratioY = 1 - Math.max(0, Math.min(1, y / plotHeight)); // 0 (bottom) to 1 (top)
    const db = config.minDecibels + ratioY * (config.maxDecibels - config.minDecibels);

    const note = frequencyToNote(freq);

    setHoverData({
      x,
      y,
      freq,
      db,
      note
    });
  };

  const handleMouseMoveWaterfall = (_e: React.MouseEvent<HTMLCanvasElement>) => {
    // Deck 2 (Waveform / Oscilloscope) has inline measurement badges and formation playhead
    setHoverData(null);
  };

  const handleMouseLeave = () => {
    setHoverData(null);
    setHoverDataWaterfall(null);
  };

  const handleResetPeaks = () => {
    if (peakHoldArrayRef.current) {
      peakHoldArrayRef.current.fill(-120);
    }
    if (peakHoldTimeArrayRef.current) {
      peakHoldTimeArrayRef.current.fill(0);
    }
    if (progressiveWaveformRef.current) {
      progressiveWaveformRef.current.mins.fill(0);
      progressiveWaveformRef.current.maxs.fill(0);
      progressiveWaveformRef.current.rms.fill(0);
      progressiveWaveformRef.current.formed.fill(0);
      progressiveWaveformRef.current.lastSlot = -1;
      progressiveWaveformRef.current.writeIndex = 0;
    }
    frozenTimeDataRef.current = null;
    setIsDeckFrozen(false);
    audioAnalyzer.resetMetrics();
  };

  const handleToggleFreeze = () => {
    setIsDeckFrozen((prev) => {
      const next = !prev;
      if (next) {
        if (byteTimeArrayRef.current) {
          frozenTimeDataRef.current = new Uint8Array(byteTimeArrayRef.current);
        }
      } else {
        frozenTimeDataRef.current = null;
      }
      return next;
    });
  };

  // Listen to container sizes dynamically (ResizeObserver) and recalculate aspect ratio and padding on visualizer mode toggle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const wrapper = canvas.parentElement;
    if (!wrapper) return;

    const recalculateCanvasDimensions = () => {
      if (!canvas || !wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const width = Math.floor(rect.width) || 800;
      const height = Math.floor(rect.height) || 300;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;

        if (peakHoldArrayRef.current.length !== width) {
          peakHoldArrayRef.current = new Array(width).fill(-120);
        }
        if (peakHoldTimeArrayRef.current.length !== width) {
          peakHoldTimeArrayRef.current = new Array(width).fill(0);
        }
      }
    };

    // Immediately recalculate on mode or scale toggle
    recalculateCanvasDimensions();

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        recalculateCanvasDimensions();
      });
    });

    observer.observe(wrapper);

    return () => {
      observer.disconnect();
    };
  }, [canvasRef, config.visualizerMode, config.frequencyScale, primaryHeight]);

  // Observe the inline waterfall container size dynamically if active
  useEffect(() => {
    const wCanvas = inlineWaterfallCanvasRef.current;
    if (!splitWaterfall || isSplitPanelPoppedOut || !wCanvas || !wCanvas.parentElement) return;

    const observer = new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        if (!wCanvas) return;
        for (let entry of entries) {
          let { width, height } = entry.contentRect;
          width = Math.floor(width) || 800;
          height = Math.floor(height) || 150;

          if (wCanvas.width !== width || wCanvas.height !== height) {
            wCanvas.width = width;
            wCanvas.height = height;

            // Ensure auxiliary scroll templates grow safely
            if (spectrogramSecondaryCanvasRef.current) {
              spectrogramSecondaryCanvasRef.current.width = width;
              spectrogramSecondaryCanvasRef.current.height = height;
            }
          }
        }
      });
    });

    observer.observe(wCanvas.parentElement);

    return () => {
      observer.disconnect();
    };
  }, [inlineWaterfallCanvasRef, splitWaterfall, isSplitPanelPoppedOut, secondaryHeight]);

  // Observe the popped out waterfall container size dynamically if active
  useEffect(() => {
    const wCanvas = popoutWaterfallCanvasRef.current;
    if (!splitWaterfall || !isSplitPanelPoppedOut || !wCanvas || !wCanvas.parentElement) return;

    const observer = new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        if (!wCanvas) return;
        for (let entry of entries) {
          let { width, height } = entry.contentRect;
          width = Math.floor(width) || 800;
          height = Math.floor(height) || 400;

          if (wCanvas.width !== width || wCanvas.height !== height) {
            wCanvas.width = width;
            wCanvas.height = height;

            // Ensure auxiliary scroll templates grow safely
            if (spectrogramSecondaryCanvasRef.current) {
              spectrogramSecondaryCanvasRef.current.width = width;
              spectrogramSecondaryCanvasRef.current.height = height;
            }
          }
        }
      });
    });

    observer.observe(wCanvas.parentElement);

    return () => {
      observer.disconnect();
    };
  }, [popoutWaterfallCanvasRef, splitWaterfall, isSplitPanelPoppedOut]);

  // Combined Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas && !onlyRenderSplit) return;

    const ctx = canvas ? canvas.getContext('2d') : null;
    if (canvas && !ctx) return;

    const render = () => {
      animationRef.current = requestAnimationFrame(render);

      const analyser = audioAnalyzer.getAnalyser();
      const palette = resolvePalette(config.colorPalette, config.customColors);
      const width = canvas ? canvas.width : 500;
      const height = canvas ? canvas.height : 300;

      if (width <= 0 || height <= 0) {
        return;
      }

      // If style switches, instantly wipe offscreen spectrogram canvases to prevent diagonal distortion artifacts
      if (lastModeRef.current !== secondaryMode) {
        lastModeRef.current = secondaryMode;
        [spectrogramPrimaryCanvasRef, spectrogramSecondaryCanvasRef].forEach((ref) => {
          if (ref.current) {
            const sCtx = ref.current.getContext('2d');
            if (sCtx) {
              sCtx.fillStyle = palette.bgDark;
              sCtx.fillRect(0, 0, ref.current.width, ref.current.height);
            }
          }
        });
      }

      // Check if we have active decaying spectral data
      const hasActiveData = floatFreqArrayRef.current && floatFreqArrayRef.current.some(v => v > -119.5);

      // Early exit if analyzer state isn't initialized, or if stopped and completely decayed
      if (!analyser || (!isPlaying && !hasActiveData)) {
        // 1. Render Deck 1 (Main Canvas) background
        if (ctx) {
          ctx.fillStyle = palette.bgDark;
          ctx.fillRect(0, 0, width, height);

          let topMode = config.visualizerMode;

          // Draw Grid on Deck 1 if enabled
          if (deck1ShowGrid) {
            if (topMode === VisualizerMode.SPECTROGRAM) {
              ctx.save();
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
              ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
              drawGridLines(ctx, width, height, { gridColor: 'rgba(255, 255, 255, 0.05)', bgDark: 'transparent' });
              ctx.restore();
            } else {
              drawGridLines(ctx, width, height, palette);
            }
          }

          // Draw Offline message over deck 1
          ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
          ctx.font = 'normal 11px "Geist Pixel", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('[ AUDIO DECK OFFLINE - COMMENCE ENGINE TO ANALYZE ]', width / 2, height / 2);
        }

        // 2. Render Deck 2 (Waveform / Oscilloscope Deck) if active
        if (splitWaterfall) {
          const wCanvas = isSplitPanelPoppedOut ? popoutWaterfallCanvasRef.current : inlineWaterfallCanvasRef.current;
          if (wCanvas) {
            const wCtx = wCanvas.getContext('2d');
            const wWidth = wCanvas.width;
            const wHeight = wCanvas.height;

            if (wCtx && wWidth > 0 && wHeight > 0) {
              const pausedTime = (isDeckFrozenRef.current && frozenTimeDataRef.current)
                ? frozenTimeDataRef.current
                : (byteTimeArrayRef.current || new Uint8Array(2048).fill(128));
              const pausedFreq = floatFreqArrayRef.current || new Float32Array(2048).fill(-120);
              renderWaveformScopeDeck(
                wCtx,
                wWidth,
                wHeight,
                pausedTime,
                pausedFreq,
                pausedTime.length,
                audioAnalyzer.getContext()?.sampleRate || 48000,
                palette,
                deck2ShowGrid,
                secondaryMode,
                true,
                oscTriggerThresholdRef.current,
                oscTimebaseRef.current
              );
            }
          }
        }

        return;
      }

      // Sync active FFT Size and Decibel Range dynamically on the AnalyserNode
      try {
        if (analyser.fftSize !== config.fftSize) {
          analyser.fftSize = config.fftSize;
        }
        if (analyser.smoothingTimeConstant !== config.smoothing) {
          analyser.smoothingTimeConstant = config.smoothing;
        }
        if (analyser.minDecibels !== config.minDecibels) {
          analyser.minDecibels = config.minDecibels;
        }
        if (analyser.maxDecibels !== config.maxDecibels) {
          analyser.maxDecibels = config.maxDecibels;
        }
      } catch (e) {
        console.warn('AnalyserNode properties sync notice:', e);
      }

      const totalBins = analyser.frequencyBinCount;
      const sampleRate = analyser.context.sampleRate;

      // Ensure array instances are ready
      if (!floatFreqArrayRef.current || floatFreqArrayRef.current.length !== totalBins) {
        floatFreqArrayRef.current = new Float32Array(totalBins).fill(-120);
      }
      if (!byteTimeArrayRef.current || byteTimeArrayRef.current.length !== totalBins) {
        byteTimeArrayRef.current = new Uint8Array(totalBins).fill(128);
      }

      // Fetch audio data or apply decaying gravity
      if (isPlaying) {
        analyser.getFloatFrequencyData(floatFreqArrayRef.current);
        analyser.getByteTimeDomainData(byteTimeArrayRef.current);
      } else {
        if (floatFreqArrayRef.current) {
          for (let i = 0; i < floatFreqArrayRef.current.length; i++) {
            floatFreqArrayRef.current[i] = Math.max(-120, floatFreqArrayRef.current[i] - 1.8);
          }
        }
        if (byteTimeArrayRef.current) {
          for (let i = 0; i < byteTimeArrayRef.current.length; i++) {
            const diff = byteTimeArrayRef.current[i] - 128;
            byteTimeArrayRef.current[i] = 128 + Math.round(diff * 0.88);
          }
        }
      }

      const freqData = floatFreqArrayRef.current;
      const timeData = byteTimeArrayRef.current;

      // Update Progressive Waveform Accumulator buffer as playback is ongoing (halted while deck is frozen)
      if (isPlaying && timeData && timeData.length > 0 && !isDeckFrozenRef.current) {
        let minV = 128;
        let maxV = 128;
        let sumSq = 0;
        const len = timeData.length;
        for (let i = 0; i < len; i++) {
          const v = timeData[i];
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
          const norm = (v - 128) / 128;
          sumSq += norm * norm;
        }
        const minNorm = (minV - 128) / 128;
        const maxNorm = (maxV - 128) / 128;
        const rmsVal = Math.sqrt(sumSq / len);

        const prog = progressiveWaveformRef.current;
        const elem = audioAnalyzer.getAudioElement();
        if (elem && elem.duration > 0 && !isNaN(elem.duration) && isFinite(elem.duration)) {
          const progress = Math.min(1.0, Math.max(0, elem.currentTime / elem.duration));
          const targetSlot = Math.min(MAX_PROGRESSIVE_SLOTS - 1, Math.floor(progress * MAX_PROGRESSIVE_SLOTS));

          const startSlot = (prog.lastSlot >= 0 && targetSlot >= prog.lastSlot && targetSlot - prog.lastSlot < 80)
            ? prog.lastSlot
            : targetSlot;

          for (let s = startSlot; s <= targetSlot; s++) {
            if (prog.formed[s]) {
              prog.mins[s] = Math.min(prog.mins[s], minNorm);
              prog.maxs[s] = Math.max(prog.maxs[s], maxNorm);
              prog.rms[s] = Math.max(prog.rms[s], rmsVal);
            } else {
              prog.mins[s] = minNorm;
              prog.maxs[s] = maxNorm;
              prog.rms[s] = rmsVal;
              prog.formed[s] = 1;
            }
          }
          prog.lastSlot = targetSlot;
        } else {
          // Live microphone, synthesizer, or infinite stream
          const idx = prog.writeIndex % MAX_PROGRESSIVE_SLOTS;
          prog.mins[idx] = minNorm;
          prog.maxs[idx] = maxNorm;
          prog.rms[idx] = rmsVal;
          prog.formed[idx] = 1;
          prog.writeIndex = (prog.writeIndex + 1) % MAX_PROGRESSIVE_SLOTS;
          prog.lastSlot = idx;
        }
      }

      // Write spectrum frame into high-performance circular buffer to minimize GC thrashing
      if (isPlaying && freqData) {
        const hist = spectrogramHistoryRef.current;
        const nextHead = (hist.head + 1) % hist.maxSize;
        let slot = hist.buffer[nextHead];
        if (!slot || slot.freqData.length !== totalBins) {
          slot = { freqData: new Float32Array(totalBins), timestamp: 0 };
          hist.buffer[nextHead] = slot;
        }
        slot.freqData.set(freqData);
        slot.timestamp = Date.now();
        hist.head = nextHead;
        hist.size = Math.min(hist.size + 1, hist.maxSize);
      }

      // Determine top canvas mode
      let topMode = config.visualizerMode;

      // Save current frame to high-performance curve circular buffer
      if (topMode === VisualizerMode.SPECTRUM_CURVE && isPlaying && freqData) {
        const ch = curveHistoryRef.current;
        const nextHead = (ch.head + 1) % ch.maxSize;
        let slot = ch.buffer[nextHead];
        if (!slot || slot.length !== totalBins) {
          slot = new Float32Array(totalBins);
          ch.buffer[nextHead] = slot;
        }
        slot.set(freqData);
        ch.head = nextHead;
        ch.size = Math.min(ch.size + 1, ch.maxSize);
      } else if (!isPlaying) {
        curveHistoryRef.current.size = 0;
        curveHistoryRef.current.head = -1;
      }

      // Manage spectral peaks history for overlay (Requirement 3)
      if (showHistory && isPlaying && freqData) {
        const now = Date.now();
        if (now - lastHistorySnapshotTimeRef.current > 400) {
          lastHistorySnapshotTimeRef.current = now;
          const snapshot = new Float32Array(freqData.length);
          snapshot.set(freqData);
          
          const historyList = spectralPeaksHistoryRef.current;
          historyList.unshift(snapshot);
          if (historyList.length > 3) {
            historyList.pop();
          }
        }
      } else if (!isPlaying) {
        spectralPeaksHistoryRef.current = [];
      }

      // Draw Top Canvas (Primary Visualization)
      if (ctx) {
        ctx.fillStyle = palette.bgDark;
        ctx.fillRect(0, 0, width, height);

        // Save and apply horizontal and vertical padding for spectrum graph bounds
        ctx.save();
        const plotLeft = 48;
        const plotRightMargin = 14;
        const plotBottom = 22;
        const plotWidth = Math.max(10, width - plotLeft - plotRightMargin);
        const plotHeight = Math.max(10, height - plotBottom);
        const scaleX = plotWidth / width;
        const scaleY = plotHeight / height;
        ctx.translate(plotLeft, 0);
        ctx.scale(scaleX, scaleY);

        // Draw selected top visualizer graphics (Spectrum Deck: Vertical Bars or Curve)
        if (topMode === VisualizerMode.SPECTRUM_CURVE) {
          drawSpectrumCurve(ctx, width, height, freqData, totalBins, sampleRate, palette, curveHistoryRef.current);
        } else {
          drawSpectrumBars(ctx, width, height, freqData, totalBins, sampleRate, palette);
        }

        // Draw historical spectral peaks overlay
        if (showHistory) {
          drawSpectralPeaksHistory(ctx, width, height, totalBins, sampleRate, palette);
        }

        // Restore transformation matrix
        ctx.restore();

        // Draw standard measurement grid and vertical dB values (OUTSIDE scaled block for perfect margins)
        drawGridLines(ctx, width, height, palette, deck1ShowGrid);

        // Draw hover interactivity crosshair badge if active (rendered unscaled to prevent squished text)
        if (hoverData) {
          // Restrict hover drawing to within the active spectrum bounds
          if (hoverData.x >= plotLeft && hoverData.x <= plotLeft + plotWidth && hoverData.y >= 0 && hoverData.y <= plotHeight) {
            drawHoverCrosshair(ctx, width, height, hoverData, palette);
          }
        }

        // Draw interactive draggable frequency markers with real-time decibel readouts
        if (topMode !== VisualizerMode.WAVEFORM) {
          drawFrequencyMarkers(ctx, width, height, activeMarkers, palette, freqData, totalBins, sampleRate);
        }
      }

      // Draw Bottom Canvas (Split scrolling Spectrogram/Oscilloscope)
      if (splitWaterfall) {
        const wCanvas = isSplitPanelPoppedOut ? popoutWaterfallCanvasRef.current : inlineWaterfallCanvasRef.current;
        if (wCanvas) {
          const wCtx = wCanvas.getContext('2d');
          const wWidth = wCanvas.width;
          const wHeight = wCanvas.height;

          if (wCtx && wWidth > 0 && wHeight > 0) {
            const dataToRender = (isDeckFrozenRef.current && frozenTimeDataRef.current)
              ? frozenTimeDataRef.current
              : timeData;
            renderWaveformScopeDeck(
              wCtx,
              wWidth,
              wHeight,
              dataToRender,
              freqData,
              totalBins,
              sampleRate,
              palette,
              deck2ShowGrid,
              secondaryMode,
              isDeckFrozenRef.current,
              oscTriggerThresholdRef.current,
              oscTimebaseRef.current
            );
          }
        }
      }
    };

    // Sub Drawers
    const drawEmptySpecturm = (ctx: CanvasRenderingContext2D, width: number, height: number, palette: any) => {
      if (config.visualizerMode !== VisualizerMode.SPECTROGRAM && deck1ShowGrid) {
        drawGridLines(ctx, width, height, palette);
      }
      ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.font = 'normal 11px "Geist Pixel", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('[ AUDIO DECK OFFLINE - COMMENCE ENGINE TO ANALYZE ]', width / 2, height / 2);
    };

    const drawGridLines = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      palette: any,
      showInnerGrid: boolean = true,
      forceSpectrogramGrid: boolean = false
    ) => {
      const scaleLog = config.frequencyScale === FrequencyScale.LOGARITHMIC;
      const isSpectrogram = forceSpectrogramGrid || config.visualizerMode === VisualizerMode.SPECTROGRAM;
      const plotLeft = 48;
      const plotRightMargin = 14;
      const plotBottom = 22;
      const plotWidth = Math.max(10, width - plotLeft - plotRightMargin);
      const plotHeight = Math.max(10, height - plotBottom);

      // 1. Dedicated vertical scale gutter background for 100% legibility
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, plotLeft, plotHeight);

      // 2. Vertical axis dividing line separating gutter from frequency plot
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotLeft, 0);
      ctx.lineTo(plotLeft, plotHeight);
      ctx.stroke();

      // 3. Right boundary axis line for visual balance
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(plotLeft + plotWidth, 0);
      ctx.lineTo(plotLeft + plotWidth, plotHeight);
      ctx.stroke();

      if (isSpectrogram) {
        // Vertical Time Scale Header Tag: "SEC"
        ctx.fillStyle = '#b20000';
        ctx.font = '600 10px "Geist Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('SEC', plotLeft - 7, 4);

        // Time intervals: Live (NOW) at top, historical seconds rolling down
        const pxPerSec = 90;
        const totalSec = Math.floor(plotHeight / pxPerSec);
        const secStep = totalSec > 5 ? 2 : 1;
        for (let s = 0; s <= totalSec; s += secStep) {
          const y = Math.round(s * pxPerSec);
          if (y >= plotHeight) break;

          if (showInnerGrid && s > 0) {
            ctx.strokeStyle = palette.gridColor || 'rgba(255, 255, 255, 0.08)';
            ctx.setLineDash([1, 5]);
            ctx.beginPath();
            ctx.moveTo(plotLeft, y);
            ctx.lineTo(plotLeft + plotWidth, y);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Left tick mark on vertical axis
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.beginPath();
          ctx.moveTo(plotLeft - 4, y);
          ctx.lineTo(plotLeft, y);
          ctx.stroke();

          // Right tick mark
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
          ctx.beginPath();
          ctx.moveTo(plotLeft + plotWidth, y);
          ctx.lineTo(plotLeft + plotWidth + 3, y);
          ctx.stroke();

          ctx.fillStyle = s === 0 ? '#F2F2F2' : '#B8B8B8';
          ctx.font = '600 10px "Geist Mono", monospace';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          const label = s === 0 ? 'NOW' : `-${s}s`;
          ctx.fillText(label, plotLeft - 7, y === 0 ? 14 : y);
        }
      } else {
        // 4. Vertical dB Scale Header Tag: "dB" in distinctive red
        ctx.fillStyle = '#b20000';
        ctx.font = '600 10px "Geist Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('dB', plotLeft - 7, 4);

        // 5. Decibel Intervals & Horizontal Grid Lines
        let dbGridIntervals = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54, -60, -72, -84, -96, -108, -120];
        if (plotHeight < 190) {
          dbGridIntervals = [0, -6, -12, -24, -36, -48, -60, -84, -120];
        }
        if (plotHeight < 115) {
          dbGridIntervals = [0, -12, -24, -48, -72, -120];
        }

        dbGridIntervals.forEach((db) => {
          const ratioY = 1 - ((db - config.minDecibels) / (config.maxDecibels - config.minDecibels));
          let y = ratioY * plotHeight;
          if (y < 0 || y > plotHeight) return;

          if (db === config.maxDecibels) y = 1.5;
          if (db === config.minDecibels) y = plotHeight - 1.5;

          // Horizontal dashed grid line across the spectrum plot area
          if (showInnerGrid) {
            ctx.strokeStyle = palette.gridColor || 'rgba(255, 255, 255, 0.08)';
            ctx.beginPath();
            ctx.setLineDash([1, 5]);
            ctx.moveTo(plotLeft, y);
            ctx.lineTo(plotLeft + plotWidth, y);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Left tick mark on vertical dB axis
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.beginPath();
          ctx.moveTo(plotLeft - 4, y);
          ctx.lineTo(plotLeft, y);
          ctx.stroke();

          // Right tick mark
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
          ctx.beginPath();
          ctx.moveTo(plotLeft + plotWidth, y);
          ctx.lineTo(plotLeft + plotWidth + 3, y);
          ctx.stroke();

          // High-contrast vertical decibel value text label (unclipped with 7px margin from axis)
          if (db === 0) {
            ctx.fillStyle = '#FF3333'; // Red for 0 dB ceiling
          } else if (db >= -6) {
            ctx.fillStyle = '#F59E0B'; // Amber for -6 dB
          } else if (db >= -36) {
            ctx.fillStyle = '#F2F2F2'; // Crisp white for active audio range
          } else {
            ctx.fillStyle = '#B8B8B8'; // Secondary silver for lower range
          }

          ctx.font = '600 10px "Geist Mono", monospace';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          const dbStr = db === 0 ? '0' : `${db}`;
          ctx.fillText(dbStr, plotLeft - 7, y);
        });
      }

      // 6. Frequency Grid (Vertical lines + labels along bottom margin)
      const BASE_FREQ_LOG_GRID = [20, 30, 40, 50, 70, 100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000, 15000, 20000];
      const BASE_FREQ_LIN_GRID = [100, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000];
      const baseGrid = scaleLog ? BASE_FREQ_LOG_GRID : BASE_FREQ_LIN_GRID;
      let gridFreqs = baseGrid.filter(f => f >= zoomMin && f <= zoomMax);

      if (plotWidth < 450) {
        gridFreqs = gridFreqs.filter(freq => freq === zoomMin || freq === zoomMax || freq === 100 || freq === 1000 || freq === 10000);
      }

      let lastLabelX = -999;
      gridFreqs.forEach((freq) => {
        let ratioX = 0;
        if (scaleLog) {
          const logMin = Math.log10(zoomMin);
          const logMax = Math.log10(zoomMax);
          ratioX = (Math.log10(freq) - logMin) / (logMax - logMin);
        } else {
          ratioX = (freq - zoomMin) / (zoomMax - zoomMin);
        }

        let x = plotLeft + ratioX * plotWidth;
        if (x < plotLeft || x > plotLeft + plotWidth) return;

        if (freq === zoomMin) x = plotLeft + 1.5;
        if (freq === zoomMax) x = plotLeft + plotWidth - 1.5;

        if (showInnerGrid) {
          ctx.strokeStyle = palette.gridColor || 'rgba(255, 255, 255, 0.05)';
          ctx.beginPath();
          ctx.setLineDash([2, 4]);
          ctx.moveTo(x, 0);
          ctx.lineTo(x, plotHeight);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Bottom tick
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.moveTo(x, plotHeight);
        ctx.lineTo(x, plotHeight + 3);
        ctx.stroke();

        const label = freq >= 1000 ? `${(freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 1)}k` : `${freq}`;
        const isEdge = freq === zoomMin || freq === zoomMax;
        const canDrawLabel = isEdge || (x - lastLabelX > 40 && (plotLeft + plotWidth) - x > 25);

        if (canDrawLabel) {
          ctx.fillStyle = isEdge ? '#F2F2F2' : '#B8B8B8';
          ctx.font = '500 10px "Geist Mono", monospace';
          ctx.textBaseline = 'top';
          if (freq === zoomMin) {
            ctx.textAlign = 'left';
            ctx.fillText(label, plotLeft, plotHeight + 4);
          } else if (freq === zoomMax) {
            ctx.textAlign = 'right';
            ctx.fillText(label, plotLeft + plotWidth, plotHeight + 4);
          } else {
            ctx.textAlign = 'center';
            ctx.fillText(label, x, plotHeight + 4);
          }
          lastLabelX = x;
        }
      });
    };

    const drawSpectrumBars = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      freqData: Float32Array,
      totalBins: number,
      sampleRate: number,
      palette: any
    ) => {
      const isLog = config.frequencyScale === FrequencyScale.LOGARITHMIC;
      const logMin = Math.log10(zoomMin);
      const logMax = Math.log10(zoomMax);
      const minDB = config.minDecibels;
      const maxDB = config.maxDecibels;

      // Custom bar resolution spacing
      const barSpacing = 1;
      const barWidth = Math.max(1, 3);
      const totalBars = Math.floor(width / (barWidth + barSpacing));

      const isPioneerRGB = config.colorPalette === 'pioneer-rgb' || (!config.colorPalette);

      // Precompute Rekordbox frequency band gradients covering Hz ranges:
      // Rekordbox dB logic: vague green at the bottom, green, transition to yellow and red as it higher dB
      let rekordboxLowGrad: CanvasGradient | null = null;
      let rekordboxMidGrad: CanvasGradient | null = null;
      let rekordboxHighGrad: CanvasGradient | null = null;

      if (isPioneerRGB) {
        // Lows / Bass (< 250 Hz): Vague green at floor, green body, warm amber/yellow rise, red peak
        rekordboxLowGrad = ctx.createLinearGradient(0, height, 0, 0);
        rekordboxLowGrad.addColorStop(0.0, 'rgba(10, 36, 16, 0.45)'); // vague green at bottom
        rekordboxLowGrad.addColorStop(0.20, '#0f481c');
        rekordboxLowGrad.addColorStop(0.48, '#16a34a'); // green
        rekordboxLowGrad.addColorStop(0.72, '#f59e0b'); // transition to yellow / warm amber
        rekordboxLowGrad.addColorStop(0.88, '#ea580c'); // warm orange
        rekordboxLowGrad.addColorStop(1.0, '#ef4444'); // red as it reaches higher dB

        // Mids (250 Hz - 3500 Hz): Vague green at floor, vibrant lime green body, bright yellow transition, red peak
        rekordboxMidGrad = ctx.createLinearGradient(0, height, 0, 0);
        rekordboxMidGrad.addColorStop(0.0, 'rgba(10, 36, 16, 0.45)'); // vague green at bottom
        rekordboxMidGrad.addColorStop(0.20, '#0f481c');
        rekordboxMidGrad.addColorStop(0.50, '#22c55e'); // vibrant lime green
        rekordboxMidGrad.addColorStop(0.75, '#eab308'); // transition to yellow
        rekordboxMidGrad.addColorStop(0.90, '#f97316'); // orange
        rekordboxMidGrad.addColorStop(1.0, '#ef4444'); // red as it reaches higher dB

        // Highs (> 3500 Hz): Vague green at floor, green, cyan/sky blue air shimmer, transition to yellow, red peak
        rekordboxHighGrad = ctx.createLinearGradient(0, height, 0, 0);
        rekordboxHighGrad.addColorStop(0.0, 'rgba(10, 36, 16, 0.45)'); // vague green at bottom
        rekordboxHighGrad.addColorStop(0.20, '#0f481c');
        rekordboxHighGrad.addColorStop(0.48, '#10b981'); // green
        rekordboxHighGrad.addColorStop(0.68, '#00e5ff'); // Rekordbox high transient cyan shimmer
        rekordboxHighGrad.addColorStop(0.85, '#facc15'); // transition to yellow
        rekordboxHighGrad.addColorStop(1.0, '#ef4444'); // red as it reaches higher dB
      }

      // Default fallback gradient for bars
      const barGrad = ctx.createLinearGradient(0, height, 0, 0);
      barGrad.addColorStop(0, palette.secondary);
      barGrad.addColorStop(0.5, palette.primary);
      barGrad.addColorStop(0.85, palette.accent);

      for (let i = 0; i < totalBars; i++) {
        const x = i * (barWidth + barSpacing) + barSpacing;
        const ratioX = x / width;

        // Find associated central frequency
        let freq = 0;
        let nextFreq = 0;
        if (isLog) {
          const logVal = logMin + ratioX * (logMax - logMin);
          freq = Math.pow(10, logVal);
          const logValNext = logMin + ((x + barWidth + barSpacing) / width) * (logMax - logMin);
          nextFreq = Math.pow(10, logValNext);
        } else {
          freq = zoomMin + ratioX * (zoomMax - zoomMin);
          nextFreq = zoomMin + ((x + barWidth + barSpacing) / width) * (zoomMax - zoomMin);
        }

        const db = getInterpolatedDbForFreq(freq, nextFreq, freqData, totalBins, sampleRate);

        // Decibel percentage heights (safely clamped)
        const percentY = Math.max(0, Math.min(1.0, (db - minDB) / (maxDB - minDB)));
        const barHeight = percentY * height;
        const y = height - barHeight;

        if (isPioneerRGB) {
          if (freq < 250) {
            ctx.fillStyle = rekordboxLowGrad!;
          } else if (freq < 3500) {
            ctx.fillStyle = rekordboxMidGrad!;
          } else {
            ctx.fillStyle = rekordboxHighGrad!;
          }
        } else {
          ctx.fillStyle = barGrad;
        }
        ctx.fillRect(x, y, barWidth, barHeight);

        // Peak hold tracker
        if (config.showPeakHold) {
          let currPeak = peakHoldArrayRef.current[i] || -120;
          let setTime = peakHoldTimeArrayRef.current[i] || 0;
          const now = Date.now();

          if (db >= currPeak) {
            currPeak = db;
            peakHoldArrayRef.current[i] = db;
            peakHoldTimeArrayRef.current[i] = now;
          } else {
            const decayMs = config.peakHoldDecay !== undefined ? config.peakHoldDecay : 1000;
            if (decayMs === 999999) {
              // Infinite hold, no gravity decay
            } else {
              const timeElapsed = now - setTime;
              if (timeElapsed > decayMs) {
                currPeak = Math.max(-120, currPeak - 1.25);
                peakHoldArrayRef.current[i] = currPeak;
              }
            }
          }

          const peakPercent = (currPeak - minDB) / (maxDB - minDB);
          if (peakPercent > 0.02 && currPeak > minDB + 2) {
            const clampedPeakPercent = Math.min(1.0, peakPercent);
            const peakY = height - (clampedPeakPercent * height);
            
            if (isPioneerRGB) {
              if (currPeak >= -6) {
                ctx.fillStyle = '#EF4444'; // Red peak
              } else if (currPeak >= -18) {
                ctx.fillStyle = '#FACC15'; // Yellow
              } else if (freq < 250) {
                ctx.fillStyle = '#F59E0B'; // Amber bass
              } else if (freq < 3500) {
                ctx.fillStyle = '#22C55E'; // Green mid
              } else {
                ctx.fillStyle = '#00E5FF'; // Cyan treble
              }
            } else {
              ctx.fillStyle = palette.accent;
            }
            ctx.fillRect(x, peakY, barWidth, 1.5);
          }
        }
      }
    };

    const drawSpectralPeaksHistory = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      totalBins: number,
      sampleRate: number,
      palette: any
    ) => {
      const historyList = spectralPeaksHistoryRef.current;
      if (!historyList || historyList.length === 0) return;

      const isLog = config.frequencyScale === FrequencyScale.LOGARITHMIC;
      const logMin = Math.log10(zoomMin);
      const logMax = Math.log10(zoomMax);
      const minDB = config.minDecibels;
      const maxDB = config.maxDecibels;
      const step = 2; // resolution matching

      ctx.save();
      const opacities = [0.32, 0.18, 0.08];

      historyList.forEach((histData, idx) => {
        const opacity = opacities[idx] || 0.1;
        ctx.beginPath();
        let peakInPath = false;
        
        for (let x = 0; x < width; x += step) {
          const ratioX = x / width;
          let freq = 0;
          let nextFreq = 0;
          if (isLog) {
            const logVal = logMin + ratioX * (logMax - logMin);
            freq = Math.pow(10, logVal);
            const logValNext = logMin + ((x + step) / width) * (logMax - logMin);
            nextFreq = Math.pow(10, logValNext);
          } else {
            freq = zoomMin + ratioX * (zoomMax - zoomMin);
            nextFreq = zoomMin + ((x + step) / width) * (zoomMax - zoomMin);
          }

          const db = getInterpolatedDbForFreq(freq, nextFreq, histData, totalBins, sampleRate);
          const percentY = Math.max(0, Math.min(1.0, (db - minDB) / (maxDB - minDB)));
          const y = height - (percentY * height);

          if (y < height - 3.5) {
            if (!peakInPath) {
              ctx.moveTo(x, y);
              peakInPath = true;
            } else {
              ctx.lineTo(x, y);
            }
          } else {
            peakInPath = false;
          }
        }

        if (peakInPath) {
          ctx.strokeStyle = palette.accent || '#FFFFFF';
          ctx.globalAlpha = opacity;
          ctx.lineWidth = 1.0;
          ctx.setLineDash([3, 4]);
          ctx.stroke();
        }
      });

      ctx.restore();
    };

    const drawSpectrumCurve = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      freqData: Float32Array,
      totalBins: number,
      sampleRate: number,
      palette: any,
      history: {
        buffer: Float32Array[];
        head: number;
        size: number;
        maxSize: number;
      }
    ) => {
      const isLog = config.frequencyScale === FrequencyScale.LOGARITHMIC;
      const logMin = Math.log10(zoomMin);
      const logMax = Math.log10(zoomMax);
      const minDB = config.minDecibels;
      const maxDB = config.maxDecibels;
      const step = 2; // Step resolution for smoothness/performance

      // Draw trailing shadow decay (phosphor-like ghost persistence)
      if (history && history.size > 0) {
        const { buffer, head, size, maxSize } = history;
        const startIdx = (head - size + 1 + maxSize * 2) % maxSize;
        for (let i = 0; i < size; i++) {
          const targetIdx = (startIdx + i) % maxSize;
          const histData = buffer[targetIdx];
          if (!histData) continue;

          // Linear decay of opacity based on index (i = 0 is oldest, last is newest copy)
          const alpha = ((i + 1) / (size + 1)) * 0.45;
          ctx.beginPath();
          let histInPath = false;
          for (let x = 0; x < width; x += step) {
            const ratioX = x / width;
            let freq = 0;
            let nextFreq = 0;
            if (isLog) {
              const logVal = logMin + ratioX * (logMax - logMin);
              freq = Math.pow(10, logVal);
              const logValNext = logMin + ((x + step) / width) * (logMax - logMin);
              nextFreq = Math.pow(10, logValNext);
            } else {
              freq = zoomMin + ratioX * (zoomMax - zoomMin);
              nextFreq = zoomMin + ((x + step) / width) * (zoomMax - zoomMin);
            }

            const db = getInterpolatedDbForFreq(freq, nextFreq, histData, totalBins, sampleRate);
            const percentY = Math.max(0, Math.min(1.0, (db - minDB) / (maxDB - minDB)));
            const y = height - (percentY * height);

            if (y < height - 3.5) {
              if (!histInPath) {
                ctx.moveTo(x, y);
                histInPath = true;
              } else {
                ctx.lineTo(x, y);
              }
            } else {
              histInPath = false;
            }
          }
          if (histInPath) {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = palette.primary;
            ctx.lineWidth = 0.55; // Thin persistent line
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // Pre-calculate the current frame coordinates to prevent repeating deep math loops
      const ptsCount = Math.floor(width / step) + 1;
      if (!curveYCoordinatesRef.current || curveYCoordinatesRef.current.length < ptsCount) {
        curveYCoordinatesRef.current = new Float32Array(ptsCount);
      }
      const yCoords = curveYCoordinatesRef.current;

      let index = 0;
      for (let x = 0; x < width; x += step) {
        const ratioX = x / width;
        let freq = 0;
        let nextFreq = 0;
        if (isLog) {
          const logVal = logMin + ratioX * (logMax - logMin);
          freq = Math.pow(10, logVal);
          const logValNext = logMin + ((x + step) / width) * (logMax - logMin);
          nextFreq = Math.pow(10, logValNext);
        } else {
          freq = zoomMin + ratioX * (zoomMax - zoomMin);
          nextFreq = zoomMin + ((x + step) / width) * (zoomMax - zoomMin);
        }

        const db = getInterpolatedDbForFreq(freq, nextFreq, freqData, totalBins, sampleRate);
        const percentY = Math.max(0, Math.min(1.0, (db - minDB) / (maxDB - minDB)));
        yCoords[index++] = height - (percentY * height);
      }

      // Draw filled gradients underneath using pre-rendered Y coords
      ctx.beginPath();
      index = 0;
      for (let x = 0; x < width; x += step) {
        const y = yCoords[index++];
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();

      const isPioneerRGB = config.colorPalette === 'pioneer-rgb' || (!config.colorPalette);
      const areaGrad = ctx.createLinearGradient(0, height, 0, 0);
      if (isPioneerRGB) {
        areaGrad.addColorStop(0.0, 'rgba(10, 38, 16, 0.08)'); // vague green at bottom
        areaGrad.addColorStop(0.35, 'rgba(22, 163, 74, 0.22)'); // green
        areaGrad.addColorStop(0.65, 'rgba(34, 197, 94, 0.32)'); // vibrant green
        areaGrad.addColorStop(0.82, 'rgba(234, 179, 8, 0.40)'); // transition to yellow
        areaGrad.addColorStop(1.0, 'rgba(239, 68, 68, 0.50)'); // red at higher dB
      } else {
        areaGrad.addColorStop(0, 'rgba(0, 0, 0, 0.1)');
        areaGrad.addColorStop(0.5, `${palette.secondary}1a`); // 10% alpha
        areaGrad.addColorStop(0.85, `${palette.primary}4d`); // 30% alpha
      }
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // Redraw outline line using pre-rendered Y coords (skipping flat bottom baseline segments)
      ctx.beginPath();
      let inPath = false;
      index = 0;
      for (let x = 0; x < width; x += step) {
        const y = yCoords[index++];
        if (y < height - 3.5) {
          if (!inPath) {
            ctx.moveTo(x, y);
            inPath = true;
          } else {
            ctx.lineTo(x, y);
          }
        } else {
          inPath = false;
        }
      }
      if (isPioneerRGB) {
        const strokeGrad = ctx.createLinearGradient(0, height, 0, 0);
        strokeGrad.addColorStop(0.0, '#15803D'); // vague green at bottom
        strokeGrad.addColorStop(0.40, '#22C55E'); // green
        strokeGrad.addColorStop(0.75, '#EAB308'); // transition to yellow
        strokeGrad.addColorStop(1.0, '#EF4444'); // red as it higher dB
        ctx.strokeStyle = strokeGrad;
        ctx.shadowColor = 'rgba(239, 68, 68, 0.45)';
      } else {
        ctx.strokeStyle = palette.primary;
        ctx.shadowColor = `${palette.primary}aa`;
      }
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0; // reset
    };

    const drawOscilloscope = (
      ctx: CanvasRenderingContext2D,
      startX: number,
      startY: number,
      w: number,
      h: number,
      timeData: Uint8Array,
      totalBins: number,
      palette: any,
      showGrid: boolean,
      triggerThreshold: number = 0,
      timebase: number = 1.0,
      isFrozen: boolean = false
    ) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(startX, startY, w, h);
      ctx.clip();

      // Background
      ctx.fillStyle = '#050505';
      ctx.fillRect(startX, startY, w, h);

      const midY = startY + h / 2;

      // Grid lines if enabled
      if (showGrid) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;

        // Amplitude lines ±80%, ±40%
        [-0.8, -0.4, 0.4, 0.8].forEach((factor) => {
          const y = midY + factor * (h * 0.44);
          ctx.beginPath();
          ctx.moveTo(startX, y);
          ctx.lineTo(startX + w, y);
          ctx.stroke();

          ctx.fillStyle = '#B8B8B8';
          ctx.font = '500 10px "Geist Mono", monospace';
          ctx.fillText(`${factor > 0 ? '-' : '+'}${Math.abs(Math.round(factor * 100))}%`, startX + 6, y - 2);
        });

        // Time division vertical lines
        const divisions = 6;
        for (let d = 1; d < divisions; d++) {
          const gx = startX + (d / divisions) * w;
          ctx.beginPath();
          ctx.setLineDash([2, 4]);
          ctx.moveTo(gx, startY + 20);
          ctx.lineTo(gx, startY + h - 14);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Zero crossing center line (0% level)
      ctx.strokeStyle = '#B2000040';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, midY);
      ctx.lineTo(startX + w, midY);
      ctx.stroke();

      // Trigger threshold level line & marker
      // Byte mapping: 128 is center (0%), range 0..255
      const targetTriggerByte = Math.round(128 + (triggerThreshold / 100) * 127);
      const triggerY = midY - (triggerThreshold / 100) * (h * 0.44);

      if (triggerThreshold !== 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 68, 68, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(startX, triggerY);
        ctx.lineTo(startX + w, triggerY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Small T marker at right edge
        ctx.fillStyle = '#F2F2F2';
        ctx.font = '600 10px "Geist Mono", monospace';
        ctx.fillText('T', startX + w - 12, triggerY - 2);
        ctx.restore();
      }

      // Trigger sync detection (find rising edge crossing targetTriggerByte)
      let triggerOffset = 0;
      let triggerLocked = false;
      const searchLimit = Math.min(totalBins - 2, Math.floor(totalBins * 0.65));
      for (let i = 0; i < searchLimit; i++) {
        if (timeData[i] < targetTriggerByte && timeData[i + 1] >= targetTriggerByte) {
          triggerOffset = i;
          triggerLocked = true;
          break;
        }
      }

      // If threshold was not crossed with rising edge, fallback to nearest zero-crossing
      if (!triggerLocked && triggerThreshold !== 0) {
        for (let i = 0; i < searchLimit; i++) {
          if (timeData[i] < 128 && timeData[i + 1] >= 128) {
            triggerOffset = i;
            break;
          }
        }
      }

      // Horizontal timebase scaling (zoom in/out)
      // Base window: ~half totalBins
      const baseSpan = Math.min(totalBins - triggerOffset, Math.max(64, Math.floor(totalBins / 2)));
      // Effective length to render scales inversely with timebase (higher timebase = zoomed in = fewer samples shown across width)
      const effectiveTimebase = Math.max(0.25, Math.min(4.0, timebase));
      const lengthToRender = Math.max(16, Math.min(totalBins - triggerOffset, Math.round(baseSpan / effectiveTimebase)));
      const sliceWidth = w / lengthToRender;

      // Calculate Peak Vpp & RMS
      let minByte = 128;
      let maxByte = 128;
      let sumSq = 0;
      for (let i = 0; i < lengthToRender; i++) {
        const b = timeData[triggerOffset + i];
        if (b < minByte) minByte = b;
        if (b > maxByte) maxByte = b;
        const norm = (b - 128) / 128;
        sumSq += norm * norm;
      }
      const vpp = ((maxByte - minByte) / 128).toFixed(2);
      const rmsDb = (20 * Math.log10(Math.max(0.0001, Math.sqrt(sumSq / lengthToRender)))).toFixed(1);

      // Draw oscilloscope trace (No cyan in waveform deck)
      ctx.beginPath();
      ctx.lineWidth = 2;
      const rawStroke = palette.primary || '#FF3333';
      const isCyan = typeof rawStroke === 'string' && (
        rawStroke.toLowerCase().includes('00e5ff') || 
        rawStroke.toLowerCase().includes('06b6d4') || 
        rawStroke.toLowerCase().includes('cyan') ||
        rawStroke.toLowerCase().includes('7dd3fc') ||
        rawStroke.toLowerCase().includes('00ffff')
      );
      const oscStroke = isFrozen ? '#FF5555' : (isCyan ? '#FF3333' : rawStroke);
      ctx.strokeStyle = oscStroke;
      ctx.shadowBlur = isFrozen ? 12 : 8;
      ctx.shadowColor = isFrozen ? '#FF2222' : oscStroke;

      let currX = startX;
      for (let i = 0; i < lengthToRender; i++) {
        const v = timeData[triggerOffset + i] / 128.0; // 0..2
        // v = 1 is baseline (midY)
        const y = midY - (v - 1.0) * (h * 0.44);

        if (i === 0) {
          ctx.moveTo(currX, y);
        } else {
          ctx.lineTo(currX, y);
        }
        currX += sliceWidth;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Top-left badge: OSCILLOSCOPE + [FROZEN] indicator if applicable
      ctx.fillStyle = 'rgba(7, 7, 7, 0.9)';
      const badgeWidth = isFrozen ? 250 : 195;
      ctx.fillRect(startX + 8, startY + 6, badgeWidth, 18);
      ctx.strokeStyle = isFrozen ? '#FF444480' : '#B20000';
      ctx.lineWidth = 1;
      ctx.strokeRect(startX + 8, startY + 6, badgeWidth, 18);

      ctx.fillStyle = isFrozen ? '#FF4444' : '#B20000';
      ctx.beginPath();
      ctx.arc(startX + 16, startY + 15, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#B8B8B8';
      ctx.font = '600 10px "Geist Mono", monospace';
      ctx.fillText(isFrozen ? 'TIME-DOMAIN OSCILLOSCOPE [FROZEN]' : 'TIME-DOMAIN OSCILLOSCOPE', startX + 24, startY + 18);

      // Top-right readout: Vpp, RMS, Trigger status, Timebase zoom (Crisp #F2F2F2 text)
      const trigLabel = triggerLocked ? 'LOCK' : 'AUTO';
      const trigVal = `${triggerThreshold > 0 ? '+' : ''}${triggerThreshold}%`;
      const infoText = `Vpp: ${vpp} | RMS: ${rmsDb} dB | TRIG: ${trigLabel} ${trigVal} | TB: ${effectiveTimebase.toFixed(2)}x`;

      ctx.font = '500 11px "Geist Mono", monospace';
      ctx.fillStyle = 'rgba(7, 7, 7, 0.9)';
      const infoWidth = ctx.measureText(infoText).width + 16;
      ctx.fillRect(startX + w - infoWidth - 8, startY + 6, infoWidth, 18);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.strokeRect(startX + w - infoWidth - 8, startY + 6, infoWidth, 18);

      ctx.fillStyle = '#F2F2F2';
      ctx.fillText(infoText, startX + w - infoWidth + 8, startY + 18);

      ctx.restore();
    };

    const drawProgressiveWaveform = (
      ctx: CanvasRenderingContext2D,
      startX: number,
      startY: number,
      w: number,
      h: number,
      palette: any,
      showGrid: boolean,
      isFrozen: boolean = false
    ) => {
      const prog = progressiveWaveformRef.current;
      const elem = audioAnalyzer.getAudioElement();
      const hasDuration = elem && elem.duration > 0 && !isNaN(elem.duration) && isFinite(elem.duration);
      const currentTime = elem ? elem.currentTime : 0;
      const duration = hasDuration ? elem.duration : 0;
      const currentProgress = hasDuration && duration > 0 
        ? Math.min(1.0, Math.max(0, currentTime / duration))
        : (prog.writeIndex % MAX_PROGRESSIVE_SLOTS) / MAX_PROGRESSIVE_SLOTS;

      ctx.save();
      ctx.beginPath();
      ctx.rect(startX, startY, w, h);
      ctx.clip();

      // Canvas background
      ctx.fillStyle = '#050505';
      ctx.fillRect(startX, startY, w, h);

      const midY = startY + h / 2;

      // Measurement Grid
      if (showGrid) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;

        // Amplitude scale lines
        [-0.8, -0.4, 0.4, 0.8].forEach((factor) => {
          const y = midY + factor * (h * 0.44);
          ctx.beginPath();
          ctx.moveTo(startX, y);
          ctx.lineTo(startX + w, y);
          ctx.stroke();

          ctx.fillStyle = '#B8B8B8';
          ctx.font = '500 10px "Geist Mono", monospace';
          ctx.fillText(`${factor > 0 ? '-' : '+'}${Math.abs(Math.round(factor * 100))}%`, startX + 6, y - 2);
        });

        // Timeline division lines
        [0.25, 0.5, 0.75].forEach((frac) => {
          const gx = startX + frac * w;
          ctx.beginPath();
          ctx.setLineDash([2, 4]);
          ctx.moveTo(gx, startY + 20);
          ctx.lineTo(gx, startY + h - 14);
          ctx.stroke();
          ctx.setLineDash([]);

          if (hasDuration) {
            const t = frac * duration;
            const mins = Math.floor(t / 60);
            const secs = Math.floor(t % 60);
            ctx.fillStyle = '#F2F2F2';
            ctx.font = '500 10px "Geist Mono", monospace';
            ctx.fillText(`${mins}:${secs < 10 ? '0' : ''}${secs}`, gx + 4, startY + h - 4);
          }
        });
      }

      // Center zero crossing line
      ctx.strokeStyle = '#B2000040';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, midY);
      ctx.lineTo(startX + w, midY);
      ctx.stroke();

      // Number of visual columns to render
      const renderCols = Math.max(10, Math.floor(w));
      const slotStep = MAX_PROGRESSIVE_SLOTS / renderCols;
      const playheadX = startX + currentProgress * w;

      // Render unformed region background silhouette ahead of playhead
      if (currentProgress < 1.0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.fillRect(playheadX, startY + 18, (startX + w) - playheadX, h - 36);
      }

      // Draw formed waveform envelope bars
      const colWidth = Math.max(1, w / renderCols);
      for (let c = 0; c < renderCols; c++) {
        const x = startX + c * colWidth;
        const slotIdx = Math.min(MAX_PROGRESSIVE_SLOTS - 1, Math.floor(c * slotStep));

        if (prog.formed[slotIdx]) {
          const maxVal = Math.min(1.0, Math.max(0.01, prog.maxs[slotIdx]));
          const minVal = Math.max(-1.0, Math.min(-0.01, prog.mins[slotIdx]));
          const rmsVal = prog.rms[slotIdx] || 0.04;

          const topY = midY - maxVal * (h * 0.44);
          const bottomY = midY - minVal * (h * 0.44);
          const rmsTop = midY - rmsVal * (h * 0.44);
          const rmsBottom = midY + rmsVal * (h * 0.44);

          // Outer peak gradient
          const isPioneerRGB = config.colorPalette === 'pioneer-rgb' || (!config.colorPalette);
          const grad = ctx.createLinearGradient(0, topY, 0, bottomY);
          if (config.colorPalette === 'custom' && config.customColors) {
            grad.addColorStop(0, config.customColors.accent || '#FFFFFF');
            grad.addColorStop(0.25, config.customColors.tertiary || '#FFAA00');
            grad.addColorStop(0.5, config.customColors.secondary || '#0066FF');
            grad.addColorStop(0.75, config.customColors.primary || '#00E5FF');
            grad.addColorStop(1, config.customColors.accent || '#FFFFFF');
          } else if (isPioneerRGB) {
            // Rekordbox RGB waveform: Cyan/sky blue transient tips, vibrant lime green mids, warm amber/red bass
            grad.addColorStop(0, '#00E5FF'); // Cyan transient tips
            grad.addColorStop(0.2, '#38BDF8'); // Sky blue
            grad.addColorStop(0.5, '#22C55E'); // Electric lime green mids
            grad.addColorStop(0.8, '#F59E0B'); // Warm amber/orange bass
            grad.addColorStop(1, '#EF4444'); // Fiery red
          } else {
            grad.addColorStop(0, '#FF3333');
            grad.addColorStop(0.3, '#B20000');
            grad.addColorStop(0.5, '#770000');
            grad.addColorStop(0.7, '#B20000');
            grad.addColorStop(1, '#FF3333');
          }

          ctx.fillStyle = grad;
          ctx.fillRect(x, topY, Math.max(1, colWidth - 0.5), Math.max(1, bottomY - topY));

          // Inner RMS core
          ctx.fillStyle = isPioneerRGB ? 'rgba(34, 197, 94, 0.65)' : 'rgba(255, 255, 255, 0.45)';
          ctx.fillRect(x, rmsTop, Math.max(1, colWidth - 0.5), Math.max(1, rmsBottom - rmsTop));
        }
      }

      // Draw Formation Playhead / Front Laser (No cyan)
      if (currentProgress >= 0 && currentProgress <= 1.0) {
        const playheadColor = '#FF3333';
        ctx.save();
        ctx.strokeStyle = playheadColor;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 8;
        ctx.shadowColor = playheadColor;
        ctx.beginPath();
        ctx.moveTo(playheadX, startY + 4);
        ctx.lineTo(playheadX, startY + h - 4);
        ctx.stroke();

        // Small laser diamond at midY
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(playheadX, midY, 3, 0, Math.PI * 2);
        ctx.fill();

        // Top & bottom needle indicators
        ctx.fillStyle = playheadColor;
        ctx.beginPath();
        ctx.moveTo(playheadX - 4, startY + 2);
        ctx.lineTo(playheadX + 4, startY + 2);
        ctx.lineTo(playheadX, startY + 8);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(playheadX - 4, startY + h - 2);
        ctx.lineTo(playheadX + 4, startY + h - 2);
        ctx.lineTo(playheadX, startY + h - 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Top-right progress readout (Gray text)
      let progressText = '';
      if (isFrozen) {
        progressText = 'TRANSIENT INSPECTION (FROZEN)';
      } else if (hasDuration) {
        const curMins = Math.floor(currentTime / 60);
        const curSecs = Math.floor(currentTime % 60);
        const durMins = Math.floor(duration / 60);
        const durSecs = Math.floor(duration % 60);
        progressText = `${curMins}:${curSecs < 10 ? '0' : ''}${curSecs} / ${durMins}:${durSecs < 10 ? '0' : ''}${durSecs} (${Math.round(currentProgress * 100)}%)`;
      } else {
        progressText = isPlaying ? 'LIVE PLAYBACK STREAM' : 'STANDBY';
      }

      ctx.fillStyle = 'rgba(7, 7, 7, 0.9)';
      const progWidth = ctx.measureText(progressText).width + 16;
      ctx.fillRect(startX + w - progWidth - 8, startY + 6, progWidth, 18);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.strokeRect(startX + w - progWidth - 8, startY + 6, progWidth, 18);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'normal 11px "Geist Pixel", monospace';
      ctx.fillText(progressText, startX + w - progWidth, startY + 18);

      ctx.restore();
    };

    const drawSpectrogramScroll = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      freqData: Float32Array,
      totalBins: number,
      sampleRate: number,
      palette: any,
      offscreenRef: React.MutableRefObject<HTMLCanvasElement | null>,
      gridEnabled: boolean,
      isFrozen: boolean = false
    ) => {
      const plotLeft = 48;
      const plotRightMargin = 14;
      const plotBottom = 22;
      const plotWidth = Math.max(10, width - plotLeft - plotRightMargin);
      const plotHeight = Math.max(10, height - plotBottom);

      // Instantiate offscreen scrolling buffer matching plot dimensions
      if (!offscreenRef.current) {
        offscreenRef.current = document.createElement('canvas');
        offscreenRef.current.width = plotWidth;
        offscreenRef.current.height = plotHeight;
        const offCtx = offscreenRef.current.getContext('2d');
        if (offCtx) {
          offCtx.fillStyle = palette.bgDark;
          offCtx.fillRect(0, 0, plotWidth, plotHeight);
        }
      }

      const sCanvas = offscreenRef.current;
      const sCtx = sCanvas.getContext('2d');
      if (!sCtx) return;

      // Ensure offscreen fits window resize sizes
      if (sCanvas.width !== plotWidth || sCanvas.height !== plotHeight) {
        if (sCanvas.width > 0 && sCanvas.height > 0) {
          try {
            const backupData = sCtx.getImageData(0, 0, sCanvas.width, sCanvas.height);
            sCanvas.width = plotWidth;
            sCanvas.height = plotHeight;
            sCtx.fillStyle = palette.bgDark;
            sCtx.fillRect(0, 0, plotWidth, plotHeight);
            sCtx.putImageData(backupData, 0, 0);
          } catch (e) {
            sCanvas.width = plotWidth;
            sCanvas.height = plotHeight;
            sCtx.fillStyle = palette.bgDark;
            sCtx.fillRect(0, 0, plotWidth, plotHeight);
          }
        } else {
          sCanvas.width = plotWidth;
          sCanvas.height = plotHeight;
          sCtx.fillStyle = palette.bgDark;
          sCtx.fillRect(0, 0, plotWidth, plotHeight);
        }
      }

      if (!isFrozen) {
        // 1. Shift offscreen canvas contents DOWNwards by scrollSpeed pixels
        const scrollSpeed = 1.5;
        sCtx.drawImage(sCanvas, 0, 0, plotWidth, plotHeight - scrollSpeed, 0, scrollSpeed, plotWidth, plotHeight - scrollSpeed);

        // 2. Draw newly generated 1-pixel row representing the current FFT frames
        const isLog = config.frequencyScale === FrequencyScale.LOGARITHMIC;
        const logMin = Math.log10(zoomMin);
        const logMax = Math.log10(zoomMax);
        const minDB = config.minDecibels;
        const maxDB = config.maxDecibels;

        for (let x = 0; x < plotWidth; x++) {
          const ratioX = x / plotWidth;
          let freq = 0;
          let nextFreq = 0;
          if (isLog) {
            const logVal = logMin + ratioX * (logMax - logMin);
            freq = Math.pow(10, logVal);
            const logValNext = logMin + ((x + 1) / plotWidth) * (logMax - logMin);
            nextFreq = Math.pow(10, logValNext);
          } else {
            freq = zoomMin + ratioX * (zoomMax - zoomMin);
            nextFreq = zoomMin + ((x + 1) / plotWidth) * (zoomMax - zoomMin);
          }

          const db = getInterpolatedDbForFreq(freq, nextFreq, freqData, totalBins, sampleRate);

          // Map decibels range (minDB to maxDB) to 0.0 -> 1.0 amplitude
          const normalizedAmp = Math.max(0, Math.min(1, (db - minDB) / (maxDB - minDB)));
          
          // Grab custom spectrum sweep colors
          sCtx.fillStyle = palette.getSpectrogramColor(normalizedAmp);
          sCtx.fillRect(x, 0, 1, Math.max(1, scrollSpeed));
        }
      }

      // 3. Blit the offscreen buffer directly onto main canvas inside the plot bounds at (plotLeft, 0)
      ctx.drawImage(sCanvas, plotLeft, 0);

      // 4. Draw overlays of Gridlines (In subtle transparency on top of scroll)
      ctx.save();
      drawGridLines(
        ctx,
        width,
        height,
        { gridColor: 'rgba(255, 255, 255, 0.05)', bgDark: 'transparent' },
        gridEnabled,
        true
      );
      ctx.restore();
    };

    const renderWaveformScopeDeck = (
      wCtx: CanvasRenderingContext2D,
      wWidth: number,
      wHeight: number,
      timeData: Uint8Array,
      freqData: Float32Array,
      totalBins: number,
      sampleRate: number,
      palette: any,
      showGrid: boolean,
      mode: 'split' | 'spectrogram' | 'waveform' | 'oscilloscope',
      isFrozen: boolean = false,
      triggerThreshold: number = 0,
      timebase: number = 1.0
    ) => {
      // Clear background
      wCtx.fillStyle = '#050505';
      wCtx.fillRect(0, 0, wWidth, wHeight);

      if (mode === 'spectrogram') {
        // Full Width Spectrogram
        drawSpectrogramScroll(
          wCtx,
          wWidth,
          wHeight,
          freqData,
          totalBins,
          sampleRate,
          palette,
          spectrogramSecondaryCanvasRef,
          showGrid,
          isFrozen
        );
      } else if (mode === 'split') {
        const halfW = Math.floor(wWidth / 2);

        // Left Half: Spectrogram
        drawSpectrogramScroll(
          wCtx,
          halfW - 2,
          wHeight,
          freqData,
          totalBins,
          sampleRate,
          palette,
          spectrogramSecondaryCanvasRef,
          showGrid,
          isFrozen
        );

        // Center vertical divider
        wCtx.save();
        wCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        wCtx.lineWidth = 1;
        wCtx.beginPath();
        wCtx.moveTo(halfW, 0);
        wCtx.lineTo(halfW, wHeight);
        wCtx.stroke();

        // Center pill badge
        wCtx.fillStyle = isFrozen ? '#B20000' : '#101010';
        wCtx.fillRect(halfW - 24, wHeight / 2 - 9, 48, 18);
        wCtx.strokeStyle = isFrozen ? '#FF4444' : '#B2000080';
        wCtx.lineWidth = 1;
        wCtx.strokeRect(halfW - 24, wHeight / 2 - 9, 48, 18);
        wCtx.fillStyle = '#9CA3AF';
        wCtx.font = 'bold 8px "Geist Pixel", monospace';
        wCtx.textAlign = 'center';
        wCtx.fillText(isFrozen ? 'FREEZE' : 'SPLIT', halfW, wHeight / 2 + 3.5);
        wCtx.textAlign = 'left';
        wCtx.restore();

        // Right Half: Instantaneous Oscilloscope
        drawOscilloscope(
          wCtx,
          halfW + 2,
          0,
          wWidth - (halfW + 2),
          wHeight,
          timeData,
          totalBins,
          palette,
          showGrid,
          triggerThreshold,
          timebase,
          isFrozen
        );
      } else if (mode === 'waveform') {
        // Option to show only waveform: full width
        drawProgressiveWaveform(wCtx, 0, 0, wWidth, wHeight, palette, showGrid, isFrozen);
      } else {
        // Option to show only oscilloscope: full width
        drawOscilloscope(wCtx, 0, 0, wWidth, wHeight, timeData, totalBins, palette, showGrid, triggerThreshold, timebase, isFrozen);
      }
    };

    const drawTimeDomainOsc = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      timeData: Uint8Array,
      totalBins: number,
      palette: any
    ) => {
      drawOscilloscope(
        ctx,
        0,
        0,
        width,
        height,
        timeData,
        totalBins,
        palette,
        true,
        oscTriggerThresholdRef.current,
        oscTimebaseRef.current,
        isDeckFrozenRef.current
      );
    };

    const getThermalHeatmapColor = (amp: number) => {
      if (amp <= 0) return 'rgba(0, 0, 0, 1)';
      if (amp < 0.25) {
        // Deep Black to Dark Wine Red (no purple/violet)
        const r = Math.round((amp / 0.25) * 65);
        return `rgba(${r}, 0, 0, 1)`;
      } else if (amp < 0.55) {
        // Dark Wine Red to Brand Red (#B20000)
        const r = Math.round(65 + ((amp - 0.25) / 0.30) * (178 - 65));
        return `rgba(${r}, 0, 0, 1)`;
      } else if (amp < 0.80) {
        // Brand Red to Hot Red-Orange
        const pct = (amp - 0.55) / 0.25;
        const r = Math.round(178 + pct * 77);
        const g = Math.round(pct * 65);
        return `rgba(${r}, ${g}, 0, 1)`;
      } else if (amp < 0.95) {
        // Hot Red-Orange to High-Energy Golden Amber
        const pct = (amp - 0.80) / 0.15;
        const r = 255;
        const g = Math.round(65 + pct * 145);
        const b = Math.round(pct * 40);
        return `rgba(${r}, ${g}, ${b}, 1)`;
      } else {
        // Peak White Hot
        const pct = Math.min(1, (amp - 0.95) / 0.05);
        const r = 255;
        const g = Math.round(210 + pct * 45);
        const b = Math.round(40 + pct * 215);
        return `rgba(${r}, ${g}, ${b}, 1)`;
      }
    };

    const drawHeatmapVertical = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      freqData: Float32Array,
      totalBins: number,
      sampleRate: number,
      palette: any,
      offscreenRef: React.MutableRefObject<HTMLCanvasElement | null>
    ) => {
      if (!offscreenRef.current) {
        offscreenRef.current = document.createElement('canvas');
        offscreenRef.current.width = width;
        offscreenRef.current.height = height;
        const offCtx = offscreenRef.current.getContext('2d');
        if (offCtx) {
          offCtx.fillStyle = '#000000';
          offCtx.fillRect(0, 0, width, height);
        }
      }

      const sCanvas = offscreenRef.current;
      const sCtx = sCanvas.getContext('2d');
      if (!sCtx) return;

      if (sCanvas.width !== width || sCanvas.height !== height) {
        if (sCanvas.width > 0 && sCanvas.height > 0) {
          try {
            const backupData = sCtx.getImageData(0, 0, sCanvas.width, sCanvas.height);
            sCanvas.width = width;
            sCanvas.height = height;
            sCtx.fillStyle = '#000000';
            sCtx.fillRect(0, 0, width, height);
            sCtx.putImageData(backupData, 0, 0);
          } catch (e) {
            sCanvas.width = width;
            sCanvas.height = height;
            sCtx.fillStyle = '#000000';
            sCtx.fillRect(0, 0, width, height);
          }
        } else {
          sCanvas.width = width;
          sCanvas.height = height;
          sCtx.fillStyle = '#000000';
          sCtx.fillRect(0, 0, width, height);
        }
      }

      const scrollSpeed = 1.5;
      sCtx.drawImage(sCanvas, 0, 0, width, height - scrollSpeed, 0, scrollSpeed, width, height - scrollSpeed);

      const isLog = config.frequencyScale === FrequencyScale.LOGARITHMIC;
      const logMin = Math.log10(zoomMin);
      const logMax = Math.log10(zoomMax);
      const minDB = config.minDecibels;
      const maxDB = config.maxDecibels;

      for (let x = 0; x < width; x++) {
        const ratioX = x / width;
        let freq = 0;
        let nextFreq = 0;
        if (isLog) {
          const logVal = logMin + ratioX * (logMax - logMin);
          freq = Math.pow(10, logVal);
          const ratioXNext = (x + 1) / width;
          const logValNext = logMin + ratioXNext * (logMax - logMin);
          nextFreq = Math.pow(10, logValNext);
        } else {
          freq = zoomMin + ratioX * (zoomMax - zoomMin);
          nextFreq = zoomMin + ((x + 1) / width) * (zoomMax - zoomMin);
        }

        const db = getInterpolatedDbForFreq(freq, nextFreq, freqData, totalBins, sampleRate);
        const normalizedAmp = Math.max(0, Math.min(1, (db - minDB) / (maxDB - minDB)));
        
        sCtx.fillStyle = getThermalHeatmapColor(normalizedAmp);
        sCtx.fillRect(x, 0, 1, Math.max(1, scrollSpeed));
      }

      ctx.drawImage(sCanvas, 0, 0);
    };



    const drawGridLinesHorizontal = (ctx: CanvasRenderingContext2D, width: number, height: number, palette: any) => {
      ctx.strokeStyle = palette.gridColor || 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 0.75;
      ctx.font = '500 10px "Geist Mono", monospace';
      ctx.fillStyle = '#B8B8B8';

      const scaleLog = config.frequencyScale === FrequencyScale.LOGARITHMIC;
      const paddingX = 24;
      const paddingBottom = 20;
      const drawWidth = width - paddingX * 2;
      const drawHeight = height - paddingBottom;
      
      const BASE_FREQ_LOG_GRID = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      const BASE_FREQ_LIN_GRID = [100, 500, 1000, 2000, 5000, 10000, 15000, 20000];
      const baseGrid = scaleLog ? BASE_FREQ_LOG_GRID : BASE_FREQ_LIN_GRID;
      
      const gridFreqs = baseGrid.filter(f => f >= zoomMin && f <= zoomMax);

      let lastLabelY = 9999;

      // Draw horizontal Frequency lines (since frequency is on Y axis)
      gridFreqs.forEach((freq) => {
        let ratioY = 0;
        if (scaleLog) {
          const logMin = Math.log10(zoomMin);
          const logMax = Math.log10(zoomMax);
          ratioY = (Math.log10(freq) - logMin) / (logMax - logMin);
        } else {
          ratioY = (freq - zoomMin) / (zoomMax - zoomMin);
        }

        let y = (1 - ratioY) * drawHeight;
        if (y < 0 || y > drawHeight) return;

        ctx.strokeStyle = palette.gridColor || 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.setLineDash([3, 4]);
        ctx.moveTo(paddingX, y);
        ctx.lineTo(paddingX + drawWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Tick mark in left margin
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.moveTo(paddingX - 3, y);
        ctx.lineTo(paddingX, y);
        ctx.stroke();

        // Label formatting in left margin
        const label = freq >= 1000 ? `${(freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 1)}kHz` : `${freq}Hz`;
        
        const canDrawLabel = freq === zoomMin || freq === zoomMax || (lastLabelY - y > 24 && y > 15);
        if (canDrawLabel) {
          ctx.fillStyle = freq === zoomMin || freq === zoomMax ? '#F2F2F2' : '#B8B8B8';
          ctx.textAlign = 'right';
          ctx.fillText(label, paddingX - 5, y + 3);
          lastLabelY = y;
        }
      });

      // Draw vertical lines representing time grid
      ctx.strokeStyle = palette.gridColor || 'rgba(255, 255, 255, 0.05)';
      ctx.setLineDash([1, 6]);
      const timeIntervals = [0.25, 0.5, 0.75];
      timeIntervals.forEach((t) => {
        const x = paddingX + t * drawWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, drawHeight);
        ctx.stroke();

        // Optional time intervals text in the bottom margin
        ctx.fillStyle = '#858585';
        ctx.font = '500 10px "Geist Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`-${((1 - t) * 10).toFixed(1)}s`, x, height - 5);
      });
      ctx.setLineDash([]);
    };

    const drawSpectrogramScrollHorizontal = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      freqData: Float32Array,
      totalBins: number,
      sampleRate: number,
      palette: any,
      offscreenRef: React.MutableRefObject<HTMLCanvasElement | null>,
      gridEnabled: boolean
    ) => {
      // Instantiate offscreen scrolling buffer if missing
      if (!offscreenRef.current) {
        offscreenRef.current = document.createElement('canvas');
        offscreenRef.current.width = width;
        offscreenRef.current.height = height;
        const offCtx = offscreenRef.current.getContext('2d');
        if (offCtx) {
          offCtx.fillStyle = palette.bgDark;
          offCtx.fillRect(0, 0, width, height);
        }
      }

      const sCanvas = offscreenRef.current;
      const sCtx = sCanvas.getContext('2d');
      if (!sCtx) return;

      // Ensure offscreen fits window resize sizes
      if (sCanvas.width !== width || sCanvas.height !== height) {
        if (sCanvas.width > 0 && sCanvas.height > 0) {
          try {
            const backupData = sCtx.getImageData(0, 0, sCanvas.width, sCanvas.height);
            sCanvas.width = width;
            sCanvas.height = height;
            sCtx.fillStyle = palette.bgDark;
            sCtx.fillRect(0, 0, width, height);
            // Paint back
            sCtx.putImageData(backupData, 0, 0);
          } catch (e) {
            sCanvas.width = width;
            sCanvas.height = height;
            sCtx.fillStyle = palette.bgDark;
            sCtx.fillRect(0, 0, width, height);
          }
        } else {
          sCanvas.width = width;
          sCanvas.height = height;
          sCtx.fillStyle = palette.bgDark;
          sCtx.fillRect(0, 0, width, height);
        }
      }

      // 1. Shift offscreen canvas contents LEFTwards by waterfallSpeed pixels (scrollSpeed)
      const scrollSpeed = 1.5;
      sCtx.drawImage(sCanvas, scrollSpeed, 0, width - scrollSpeed, height, 0, 0, width - scrollSpeed, height);

      // 2. Draw newly generated 1-pixel column on the rightmost edge representing current FFT frames
      const isLog = config.frequencyScale === FrequencyScale.LOGARITHMIC;
      const minDB = config.minDecibels;
      const maxDB = config.maxDecibels;

      for (let y = 0; y < height; y++) {
        const ratioY = 1 - (y / height); // 1.0 (top is high freq) to 0.0 (bottom is low freq)
        let freq = 0;
        let nextFreq = 0;
        if (isLog) {
          const logMin = Math.log10(zoomMin);
          const logMax = Math.log10(zoomMax);
          const logVal = logMin + ratioY * (logMax - logMin);
          freq = Math.pow(10, logVal);
          const ratioYNext = 1 - ((y - 1) / height);
          const logValNext = logMin + ratioYNext * (logMax - logMin);
          nextFreq = Math.pow(10, logValNext);
        } else {
          freq = zoomMin + ratioY * (zoomMax - zoomMin);
          nextFreq = zoomMin + (1 - ((y - 1) / height)) * (zoomMax - zoomMin);
        }

        const db = getInterpolatedDbForFreq(freq, nextFreq, freqData, totalBins, sampleRate);

        // Map decibels range (minDB to maxDB) to 0.0 -> 1.0 amplitude
        const normalizedAmp = Math.max(0, Math.min(1, (db - minDB) / (maxDB - minDB)));
        
        // Grab custom spectrum sweep colors
        sCtx.fillStyle = palette.getSpectrogramColor(normalizedAmp);
        sCtx.fillRect(width - scrollSpeed, y, Math.max(1, scrollSpeed), 1);
      }

      // 3. Blit the offscreen buffer directly onto screen
      ctx.drawImage(sCanvas, 0, 0);

      // 4. Draw overlays of Gridlines (In subtle transparency on top of scroll)
      if (gridEnabled) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        drawGridLinesHorizontal(ctx, width, height, { gridColor: 'rgba(255, 255, 255, 0.05)', bgDark: 'transparent' });
        ctx.restore();
      }
    };

    const drawHoverCrosshair = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      hover: any,
      palette: any
    ) => {
      // Draw vertical alignment line
      ctx.strokeStyle = `${palette.primary}66`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(hover.x, 0);
      ctx.lineTo(hover.x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw floating badge card info
      const hasLag = hover.timeLagSeconds !== undefined;
      const boxW = 150;
      const boxH = hasLag ? 65 : 50;
      let boxX = hover.x + 12;
      let boxY = hover.y - boxH - 12;

      // Handle corner collisions
      if (boxX + boxW > width) boxX = hover.x - boxW - 12;
      if (boxY < 0) boxY = hover.y + 12;

      ctx.fillStyle = 'rgba(26, 26, 26, 0.98)';
      ctx.strokeStyle = palette.primary;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();

      // Info Texts
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px "Geist Pixel", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`Freq: ${hover.freq.toFixed(1)} Hz`, boxX + 8, boxY + 16);
      ctx.fillStyle = palette.primary;
      ctx.fillText(`Note: ${hover.note}`, boxX + 8, boxY + 28);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(`Level: ${hover.db <= -119 ? '-∞' : hover.db.toFixed(1) + ' dB'}`, boxX + 8, boxY + 40);
      if (hasLag) {
        ctx.fillStyle = '#A0A0A0'; // Light Gray
        ctx.fillText(`Delay: -${hover.timeLagSeconds.toFixed(2)}s`, boxX + 8, boxY + 54);
      }

      // Draw active horizontal frequency marker pill at the bottom x-axis scale
      ctx.save();
      const freqLabel = `${hover.freq.toFixed(0)} Hz`;
      ctx.font = 'bold 11px "Geist Pixel", monospace';
      const textWidth = ctx.measureText(freqLabel).width;
      const padX = 6;
      const padY = 4;
      const tagW = textWidth + padX * 2;
      const tagH = 16;
      
      let tagX = hover.x - tagW / 2;
      if (tagX < 0) tagX = 0;
      if (tagX + tagW > width) tagX = width - tagW;
      
      const tagY = height - tagH - 1; // Aligned near bottom edge of the frequency spectrum canvas

      ctx.fillStyle = palette.primary; // Hot color matching the chosen palette
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tagX, tagY, tagW, tagH, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#000000'; // High contrast black text on colored background
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(freqLabel, tagX + tagW / 2, tagY + tagH / 2);
      ctx.restore();
    };

    const drawFrequencyMarkers = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      markers: FrequencyMarker[],
      palette: any,
      freqData: Float32Array | null,
      totalBins: number,
      sampleRate: number
    ) => {
      if (!markers || markers.length === 0) return;
      const plotLeft = 48;
      const paddingBottom = 22;
      const activeWidth = Math.max(10, width - plotLeft - 14);
      const activeHeight = height - paddingBottom;

      markers.forEach((marker) => {
        let ratioX = 0;
        if (config.frequencyScale === FrequencyScale.LOGARITHMIC) {
          const logMin = Math.log10(zoomMin);
          const logMax = Math.log10(zoomMax);
          const logVal = Math.log10(Math.max(zoomMin, Math.min(zoomMax, marker.frequency)));
          ratioX = (logVal - logMin) / (logMax - logMin);
        } else {
          ratioX = (marker.frequency - zoomMin) / (zoomMax - zoomMin);
        }

        if (ratioX < 0 || ratioX > 1) return; // Outside active zoom window

        const markerX = plotLeft + ratioX * activeWidth;

        // Sample live decibel level at marker's exact frequency
        let liveDb = -120;
        if (freqData && totalBins > 0) {
          liveDb = getInterpolatedDbForFreq(marker.frequency, marker.frequency * 1.02, freqData, totalBins, sampleRate);
        }
        liveMarkerDbRef.current[marker.id] = liveDb;

        const isDragging = draggingMarkerId === marker.id;
        const markerColor = marker.color || (isDragging ? '#FFFFFF' : (palette.accent || '#FF3333'));

        // 1. Draw vertical dashed marker line
        ctx.save();
        ctx.strokeStyle = isDragging ? '#FFFFFF' : `${markerColor}CC`;
        ctx.lineWidth = isDragging ? 2 : 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(markerX, 0);
        ctx.lineTo(markerX, activeHeight);
        ctx.stroke();
        ctx.restore();

        // 2. Compute curve intersection Y
        const clampedDb = Math.max(config.minDecibels, Math.min(config.maxDecibels, liveDb));
        const ratioY = (clampedDb - config.minDecibels) / (config.maxDecibels - config.minDecibels);
        const markerY = activeHeight - (ratioY * activeHeight);

        // 3. Draw intersection node on spectrum trace
        ctx.save();
        ctx.shadowColor = markerColor;
        ctx.shadowBlur = isDragging ? 14 : 6;
        ctx.fillStyle = markerColor;
        ctx.beginPath();
        ctx.arc(markerX, markerY, isDragging ? 5.5 : 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(markerX, markerY, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 4. Draw node decibel readout badge on curve
        ctx.save();
        const dbStr = liveDb <= -119 ? '-∞ dB' : `${liveDb.toFixed(1)} dB`;
        ctx.font = '600 10px "Geist Mono", monospace';
        const dbMetrics = ctx.measureText(dbStr);
        const pillW = dbMetrics.width + 10;
        const pillH = 16;
        let pillX = markerX + 7;
        let pillY = markerY - pillH / 2;
        if (pillX + pillW > width - 8) pillX = markerX - pillW - 7;
        if (pillY < 8) pillY = 8;
        if (pillY + pillH > activeHeight - 2) pillY = activeHeight - pillH - 2;

        ctx.fillStyle = 'rgba(10, 10, 10, 0.9)';
        ctx.strokeStyle = isDragging ? '#FFFFFF' : markerColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isDragging ? '#FFFFFF' : '#F2F2F2';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(dbStr, pillX + 5, pillY + pillH / 2);
        ctx.restore();

        // 5. Draw top draggable header flag
        ctx.save();
        const freqStr = marker.frequency >= 1000 
          ? `${(marker.frequency / 1000).toFixed(marker.frequency % 1000 === 0 ? 0 : 2)}kHz` 
          : `${marker.frequency.toFixed(0)}Hz`;
        const noteStr = frequencyToNote(marker.frequency);
        const headerLabel = marker.label ? `${marker.label}: ${freqStr}` : freqStr;
        const fullTag = `${headerLabel} [${noteStr}]`;
        ctx.font = '600 11px "Geist Mono", monospace';
        const tagMetrics = ctx.measureText(fullTag);
        const tagW = tagMetrics.width + 14;
        const tagH = 18;
        let tagX = markerX - tagW / 2;
        if (tagX < plotLeft) tagX = plotLeft;
        if (tagX + tagW > width - 14) tagX = width - 14 - tagW;
        const tagY = 6;

        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = isDragging ? '#222222' : 'rgba(14, 14, 14, 0.95)';
        ctx.strokeStyle = isDragging ? '#FFFFFF' : markerColor;
        ctx.lineWidth = isDragging ? 2 : 1.2;
        ctx.beginPath();
        ctx.roundRect(tagX, tagY, tagW, tagH, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isDragging ? '#FFFFFF' : markerColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fullTag, tagX + tagW / 2, tagY + tagH / 2);
        ctx.restore();
      });
    };

    // Run animation loop
    render();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [config, isPlaying, hoverData, hoverDataWaterfall, secondaryMode, deck1ShowGrid, deck2ShowGrid, isSplitPanelPoppedOut, zoomMin, zoomMax, onlyRenderSplit, hideSplitWaterfall, activeMarkers, draggingMarkerId]);

  const toggleFullscreen = React.useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => {
        console.error('Fullscreen failed:', err);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, [setIsFullscreen]);

  useEffect(() => {
    toggleFullscreenRef.current = toggleFullscreen;
    return () => {
      if (toggleFullscreenRef.current === toggleFullscreen) {
        toggleFullscreenRef.current = null;
      }
    };
  }, [toggleFullscreen, toggleFullscreenRef]);

  useEffect(() => {
    const handleFSChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFSChange);
    return () => document.removeEventListener('fullscreenchange', handleFSChange);
  }, [setIsFullscreen]);

  if (onlyRenderSplit) {
    const palette = resolvePalette(config.colorPalette, config.customColors);
    return (
      <div 
        ref={containerRef}
        className="w-full flex flex-col items-stretch select-none"
        id="split-visualizer-outer-wrapper"
      >
        {splitWaterfall && (
          isSplitPanelPoppedOut ? (
            <div 
              className="bg-[#121212] border border-[#4a4a4a] p-6 flex flex-col items-center justify-center min-h-[180px] text-center gap-4 transition-colors"
              id="secondary-visualizer-popped-placeholder"
            >
              <div className="flex items-center gap-2">
                <Waves className="w-4 h-4 text-[#b20000]" />
                <h3 className="text-xs font-bold text-white font-sans tracking-[1.4px] uppercase">
                  Waveform / Oscilloscope Deck Popped Out
                </h3>
              </div>
              <p className="text-[10px] text-[#aaaaaa] font-sans max-w-sm leading-normal uppercase tracking-wider">
                The concurrent waveform and oscilloscope visualizer is actively running inside a floating workspace window.
              </p>
              <button
                type="button"
                onClick={() => setIsSplitPanelPoppedOut(false)}
                className="px-3.5 py-1.5 text-[10px] uppercase font-sans font-bold tracking-[1.2px] bg-[#181818] text-[#b20000] border border-[#4a4a4a] hover:bg-[#b20000] hover:text-white transition-colors cursor-pointer"
              >
                Dock Waveform / Oscilloscope Deck
              </button>
            </div>
          ) : (
            <div 
              className="bg-[#1a1a1a] border border-[#4a4a4a] flex flex-col overflow-hidden transition-colors select-none w-full"
              id="secondary-visualizer-container"
            >
              {/* Secondary Deck Header */}
              <WaveformOscilloscopeDeckHeader
                secondaryMode={secondaryMode}
                setSecondaryMode={setSecondaryMode}
                isDeckFrozen={isDeckFrozen}
                onToggleFreeze={handleToggleFreeze}
                oscTimebase={oscTimebase}
                setOscTimebase={setOscTimebase}
                oscTriggerThreshold={oscTriggerThreshold}
                setOscTriggerThreshold={setOscTriggerThreshold}
                secondaryHeight={secondaryHeight}
                setSecondaryHeight={setSecondaryHeight}
                deck2ShowGrid={deck2ShowGrid}
                setDeck2ShowGrid={setDeck2ShowGrid}
                onResetPeaks={handleResetPeaks}
                onPopOut={() => setIsSplitPanelPoppedOut(true)}
              />

              {/* Bottom Secondary View Content */}
              <div 
                style={{ height: `${secondaryHeight}px` }} 
                className="w-full relative cursor-crosshair overflow-hidden bg-[#0e0e0e] border-t border-[#4a4a4a] px-4 py-0 shrink-0" 
                id="waterfall-canvas-wrapper"
                title="Secondary multi-perspective canvas displaying scrolling spectrogram history."
              >
                <canvas 
                  ref={inlineWaterfallCanvasRef}
                  onMouseMove={handleMouseMoveWaterfall}
                  onMouseLeave={handleMouseLeave}
                  className="block w-full h-full rounded-none"
                />
              </div>
            </div>
          )
        )}

        {/* 3. Floating window for popped-out secondary panel */}
        {splitWaterfall && isSplitPanelPoppedOut && (
          <FloatingWindow
            id="popout-secondary-split-window"
            title={secondaryMode === 'split' ? 'Waveform / Oscilloscope Deck' : secondaryMode === 'waveform' ? 'Progressive Waveform Deck' : 'Time-Domain Oscilloscope'}
            onDock={() => setIsSplitPanelPoppedOut(false)}
            defaultWidth={800}
            defaultHeight={420}
          >
            <div className="w-full h-full p-1 bg-black overflow-hidden flex flex-col items-stretch" id="popout-waterfall-wrapper">
              <canvas 
                ref={popoutWaterfallCanvasRef}
                onMouseMove={handleMouseMoveWaterfall}
                onMouseLeave={handleMouseLeave}
                className="block w-full h-full bg-black rounded-lg"
              />
            </div>
          </FloatingWindow>
        )}
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={`w-full flex flex-col items-stretch select-none ${
        isFullscreen ? 'p-6 h-screen overflow-y-auto bg-black' : 'gap-4'
      }`}
      id="visualizer-outer-wrapper"
    >
      {/* 1. Main visualizer deck */}
      <div 
        className={`bg-[#1a1a1a] flex flex-col items-stretch justify-between relative border border-[#4a4a4a] ${
          isPoppedOut ? 'border-0 h-full' : 'min-h-[380px]'
        }`}
        id="visualizer-container"
      >
        {/* Visualizer Floating Controller Header */}
        {!isPoppedOut && (
          <div className="flex flex-col md:flex-row md:items-center justify-between p-3 bg-[#121212] border-b border-[#4a4a4a] z-10 gap-3" id="visualizer-header">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-[#181818] border border-[#4a4a4a] flex items-center justify-center text-[#b20000]">
                  <AudioLines className="w-4 h-4 text-[#b20000]" />
                </div>
                <h1 className="text-xs font-semibold tracking-[1.4px] text-[#F2F2F2] font-sans uppercase animate-fade-in">
                  Spectrum Analyzer Deck
                </h1>
              </div>
              {/* Mode Selector */}
              <div 
                className="flex items-center gap-1.5 p-1 bg-[#181818] border border-[#4a4a4a] h-7"
                title="Select spectrum render method"
              >
                <span className="text-[#B8B8B8] pl-1 text-[11px] font-sans font-medium uppercase tracking-[1px]">Mode:</span>
                <select
                  id="select-spectrum-style-header"
                  value={config.visualizerMode === VisualizerMode.SPECTRUM_CURVE ? VisualizerMode.SPECTRUM_CURVE : VisualizerMode.SPECTRUM_BARS}
                  onChange={(e) => {
                    const selectedMode = e.target.value as VisualizerMode;
                    setConfig(prev => ({
                      ...prev,
                      visualizerMode: selectedMode
                    }));
                  }}
                  className="bg-transparent border-0 text-[#F2F2F2] focus:outline-none cursor-pointer font-sans text-[11px] font-medium uppercase tracking-[1px] pr-1"
                >
                  <option value={VisualizerMode.SPECTRUM_BARS} className="bg-[#181818]">Vertical Bars</option>
                  <option value={VisualizerMode.SPECTRUM_CURVE} className="bg-[#181818]">Curve</option>
                </select>
              </div>


            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Primary Panel Height Adjustment */}
              <div 
                className="flex items-center gap-1.5 bg-[#181818] border border-[#4a4a4a] px-2 py-1 select-none transition-colors h-7" 
                title="Adjust the vertical height of the primary visualizer (120px to 480px)"
                id="header-primary-height-control"
              >
                <span className="text-[#B8B8B8] text-[11px] uppercase font-sans font-medium tracking-[1px]">Height:</span>
                <input
                  id="slider-header-main-height"
                  type="range"
                  min="120"
                  max="480"
                  step="10"
                  value={primaryHeight}
                  onChange={(e) => {
                    const h = parseInt(e.target.value);
                    setPrimaryHeight(h);
                  }}
                  className="w-16 accent-[#b20000] h-1 bg-[#121212] cursor-pointer"
                />
                <span className="text-[#F2F2F2] font-sans text-[11px] w-8 text-right font-semibold shrink-0">{primaryHeight}px</span>
              </div>

              {/* Grid Toggle Button - styled like auto-reset */}
              <button
                type="button"
                id="btn-deck1-grid-toggle"
                onClick={() => {
                  setDeck1ShowGrid(!deck1ShowGrid);
                }}
                className={`px-2.5 py-1 text-[11px] font-sans font-medium uppercase tracking-[1px] border transition-colors cursor-pointer h-7 flex items-center justify-center select-none ${
                  deck1ShowGrid
                    ? 'bg-[#b20000] border-[#b20000] text-white'
                    : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-white hover:text-[#111111]'
                }`}
                title="Toggle measurement grid lines displaying decibel (dB) amplitudes and logarithmic frequency bounds."
              >
                Grid
              </button>



              {/* Reset Peaks button next to pop out deck, match Loudness panel style 1:1 */}
              <ResetButton
                id="btn-header-reset-peaks"
                onClick={handleResetPeaks}
                title="Instantly wipe and clear all transient peak-hold markers and maximum peaks"
              />

              {onPopOut && (
                <PopOutButton
                  onClick={onPopOut}
                  title="Pop out spectrum visualizer to a floating component window"
                  id="btn-popout-visualizer"
                />
              )}
            </div>
          </div>
        )}

        {/* Dynamic Canvas Area */}
        <div className="flex-grow w-full overflow-hidden p-0 min-h-0 animate-fade-in" id="visualizer-main-layout">
          {/* Top Primary View: Bars, Curve, Oscilloscope, or Waterfall */}
          <div 
            style={{ height: `${primaryHeight}px` }} 
            className="w-full relative cursor-crosshair overflow-hidden bg-[#070707] rounded-none shrink-0 shadow-inner px-0" 
            id="primary-canvas-wrapper"
          >
            <canvas 
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onDoubleClick={handleDoubleClick}
              className={`block w-full h-full rounded-none select-none ${
                draggingMarkerId ? 'cursor-grabbing' : isHoveringMarker ? 'cursor-ew-resize' : 'cursor-crosshair'
              }`}
            />
          </div>
        </div>

        {/* Interactive Frequency Markers Bar */}
        <div className="flex flex-wrap items-center justify-between p-2.5 px-4 bg-[#121212] border-t border-[#4a4a4a] text-[11px] gap-3 select-none" id="interactive-frequency-markers-bar">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5 font-sans text-[11px] text-[#B8B8B8] uppercase font-medium tracking-[1px]">
              <span className="text-[#b20000] text-xs leading-none">●</span>
              <span>Frequency Markers</span>
              <span className="px-1.5 py-0.5 bg-[#181818] border border-[#4a4a4a] text-[#F2F2F2] font-sans text-[10px] font-semibold">
                {activeMarkers.length}
              </span>
            </div>

            {/* Quick Add Presets */}
            <div className="flex items-center gap-1 flex-wrap">
              {[
                { freq: 60, label: 'SUB' },
                { freq: 120, label: 'KICK' },
                { freq: 250, label: 'SNARE' },
                { freq: 1000, label: 'MID' },
                { freq: 2500, label: 'VOCAL' },
                { freq: 10000, label: 'AIR' }
              ].map((preset) => {
                const exists = activeMarkers.some(m => Math.abs(m.frequency - preset.freq) < 10);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => addMarkerAtFreq(preset.freq, preset.label)}
                    className={`px-2 py-0.5 text-[10px] font-sans font-medium uppercase tracking-[0.5px] border transition-colors cursor-pointer select-none ${
                      exists
                        ? 'bg-[#b20000] border-[#b20000] text-white'
                        : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-white hover:text-[#111111]'
                    }`}
                    title={`Add ${preset.label} marker at ${preset.freq} Hz`}
                  >
                    + {preset.label} ({preset.freq >= 1000 ? `${preset.freq / 1000}k` : `${preset.freq}Hz`})
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => addMarkerAtFreq(1000, 'MARKER')}
                className="px-2 py-0.5 text-[10px] font-sans font-medium uppercase tracking-[0.5px] bg-[#181818] border border-[#b20000] text-[#FF3333] hover:bg-[#b20000] hover:text-white transition-colors cursor-pointer"
                title="Add custom frequency marker at 1 kHz"
              >
                + New Marker
              </button>

              {activeMarkers.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllMarkers}
                  className="px-1.5 py-0.5 text-[10px] font-sans font-medium uppercase tracking-[0.5px] bg-[#181818] border border-[#4a4a4a] text-[#858585] hover:bg-white hover:text-[#111111] transition-colors cursor-pointer"
                  title="Clear all active markers"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {/* Active Marker Badges with Real-Time Decibel Readout */}
          <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto max-w-full py-0.5">
            {activeMarkers.length === 0 ? (
              <span className="text-[11px] font-sans text-[#858585] uppercase tracking-wider">
                Double-click anywhere on spectrum or click presets above to track frequencies
              </span>
            ) : (
              activeMarkers.map((marker) => {
                const liveDb = markerDbSnapshot[marker.id] ?? -120;
                const dbText = liveDb <= -119 ? '-∞ dB' : `${liveDb.toFixed(1)} dB`;
                const freqText = marker.frequency >= 1000 
                  ? `${(marker.frequency / 1000).toFixed(marker.frequency % 1000 === 0 ? 0 : 2)}k` 
                  : `${marker.frequency}Hz`;
                const note = frequencyToNote(marker.frequency);
                const isDragging = draggingMarkerId === marker.id;

                return (
                  <div
                    key={marker.id}
                    className={`flex items-center gap-1.5 px-2 py-0.5 border transition-colors ${
                      isDragging 
                        ? 'bg-[#b20000] border-[#b20000] text-white' 
                        : 'bg-[#181818] border-[#4a4a4a] text-[#F2F2F2]'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 bg-[#b20000] shrink-0" />
                    <span className="font-sans text-[11px] font-semibold text-[#F2F2F2] uppercase tracking-[0.5px]">
                      {marker.label ? `${marker.label}: ` : ''}{freqText}
                    </span>
                    <span className="font-sans text-[10px] text-[#858585]">[{note}]</span>
                    <span className="font-sans text-[11px] font-semibold text-[#F2F2F2] bg-[#121212] px-1.5 py-0.5 border border-[#4a4a4a]">
                      {dbText}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMarker(marker.id)}
                      className="text-[#858585] hover:text-white text-xs leading-none p-0.5 ml-0.5 cursor-pointer"
                      title="Remove marker"
                    >
                      &times;
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Visualizer Settings footer strip */}
        <div className="flex flex-wrap items-center justify-between p-3 px-4 bg-[#121212] text-[11px] text-[#B8B8B8] font-sans gap-3" id="visualizer-footer">
          {/* Frequency Focus on one line */}
          <div 
            className="flex items-center gap-3"
            title="Frequency Focus: Instantly restrict viewable spectrum range to specific bands."
            id="control-frequency-zoom"
          >
            <span className="text-[#B8B8B8] font-medium uppercase text-[11px] tracking-[1px] font-sans">Freq Focus:</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { name: 'SUB', min: 20, max: 80, label: 'Sub-bass Focus (20Hz - 80Hz)' },
                { name: 'BASS', min: 60, max: 250, label: 'Bass Focus (60Hz - 250Hz)' },
                { name: 'MIDS', min: 250, max: 4000, label: 'Mids Focus (250Hz - 4kHz)' },
                { name: 'HIGH', min: 4000, max: 20000, label: 'Highs Focus (4kHz - 20kHz)' },
                { name: 'FULL', min: 20, max: 20000, label: 'Full Spectrum View (20Hz - 20kHz)' }
              ].map((b) => {
                const isActive = Math.abs(zoomMin - b.min) < 5 && Math.abs(zoomMax - b.max) < 50;
                return (
                  <button
                    key={b.name}
                    id={`btn-freq-focus-${b.name.toLowerCase()}`}
                    type="button"
                    onClick={() => {
                      setZoomMin(b.min);
                      setZoomMax(b.max);
                    }}
                    className={`px-2 py-1 text-[10px] font-sans tracking-[1px] font-medium uppercase transition-colors border cursor-pointer select-none ${
                      isActive
                        ? 'bg-[#b20000] border-[#b20000] text-white'
                        : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-white hover:text-[#111111]'
                    }`}
                    title={b.label}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-[#F2F2F2] font-semibold pl-2 border-l border-[#4a4a4a] flex items-center gap-1 font-sans">
              <span className="text-[#858585] font-sans uppercase text-[10px] tracking-[1px]">Active range:</span>
              <span className="text-[#F2F2F2] font-sans text-[11px] font-semibold">{zoomMin >= 1000 ? `${(zoomMin / 1000).toFixed(zoomMin % 1000 === 0 ? 0 : 1)}k` : zoomMin}Hz - {zoomMax >= 1000 ? `${(zoomMax / 1000).toFixed(zoomMax % 1000 === 0 ? 0 : 1)}k` : zoomMax}Hz</span>
            </span>
          </div>
        </div>
    </div>

      {/* 2. Secondary split panel deck */}
      {splitWaterfall && (
        isSplitPanelPoppedOut ? (
          <div 
            className="bg-[#121212] border border-[#4a4a4a] p-6 flex flex-col items-center justify-center min-h-[180px] text-center gap-4 transition-colors"
            id="secondary-visualizer-popped-placeholder"
          >
            <div className="flex items-center gap-2">
              <Waves className="w-4 h-4 text-[#b20000]" />
              <h3 className="text-xs font-bold text-white font-sans tracking-[1.4px] uppercase">
                Waveform / Oscilloscope Deck Popped Out
              </h3>
            </div>
            <p className="text-[10px] text-[#aaaaaa] font-sans max-w-sm leading-normal uppercase tracking-wider">
              The concurrent waveform and oscilloscope visualizer is actively running inside a floating workspace window.
            </p>
            <button
              type="button"
              onClick={() => setIsSplitPanelPoppedOut(false)}
              className="px-3.5 py-1.5 text-[10px] uppercase font-sans font-bold tracking-[1.2px] bg-[#181818] text-[#b20000] border border-[#4a4a4a] hover:bg-[#b20000] hover:text-white transition-colors cursor-pointer"
            >
              Dock Waveform / Oscilloscope Deck
            </button>
          </div>
        ) : (
          <div 
            className="bg-[#1a1a1a] border border-[#4a4a4a] flex flex-col overflow-hidden transition-colors select-none w-full"
            id="secondary-visualizer-container"
          >
            {/* Secondary Deck Header */}
            <WaveformOscilloscopeDeckHeader
              secondaryMode={secondaryMode}
              setSecondaryMode={setSecondaryMode}
              isDeckFrozen={isDeckFrozen}
              onToggleFreeze={handleToggleFreeze}
              oscTimebase={oscTimebase}
              setOscTimebase={setOscTimebase}
              oscTriggerThreshold={oscTriggerThreshold}
              setOscTriggerThreshold={setOscTriggerThreshold}
              secondaryHeight={secondaryHeight}
              setSecondaryHeight={setSecondaryHeight}
              deck2ShowGrid={deck2ShowGrid}
              setDeck2ShowGrid={setDeck2ShowGrid}
              onResetPeaks={handleResetPeaks}
              onPopOut={() => setIsSplitPanelPoppedOut(true)}
            />

            {/* Bottom Secondary View Content */}
            <div 
              style={{ height: `${secondaryHeight}px` }} 
              className="w-full relative cursor-crosshair overflow-hidden bg-[#0e0e0e] border-t border-[#4a4a4a] px-4 py-0 shrink-0" 
              id="waterfall-canvas-wrapper"
              title="Secondary multi-perspective canvas displaying scrolling spectrogram history or live multi-channel oscilloscope traces."
            >
              <canvas 
                ref={inlineWaterfallCanvasRef}
                onMouseMove={handleMouseMoveWaterfall}
                onMouseLeave={handleMouseLeave}
                className="block w-full h-full rounded-none"
              />
            </div>
          </div>
        )
      )}

      {/* 3. Floating window for popped-out secondary panel */}
      {splitWaterfall && isSplitPanelPoppedOut && (
        <FloatingWindow
          id="popout-secondary-split-window"
          title={secondaryMode === 'split' ? 'Waveform / Oscilloscope Deck' : secondaryMode === 'waveform' ? 'Progressive Waveform Deck' : 'Time-Domain Oscilloscope'}
          onDock={() => setIsSplitPanelPoppedOut(false)}
          defaultWidth={880}
          defaultHeight={460}
        >
          <div className="w-full h-full bg-[#121212] overflow-hidden flex flex-col items-stretch" id="popout-waterfall-wrapper">
            <WaveformOscilloscopeDeckHeader
              secondaryMode={secondaryMode}
              setSecondaryMode={setSecondaryMode}
              isDeckFrozen={isDeckFrozen}
              onToggleFreeze={handleToggleFreeze}
              oscTimebase={oscTimebase}
              setOscTimebase={setOscTimebase}
              oscTriggerThreshold={oscTriggerThreshold}
              setOscTriggerThreshold={setOscTriggerThreshold}
              secondaryHeight={secondaryHeight}
              setSecondaryHeight={setSecondaryHeight}
              deck2ShowGrid={deck2ShowGrid}
              setDeck2ShowGrid={setDeck2ShowGrid}
              onResetPeaks={handleResetPeaks}
              onPopOut={() => setIsSplitPanelPoppedOut(false)}
            />
            <div className="w-full flex-1 relative cursor-crosshair overflow-hidden bg-[#0e0e0e] border-t border-[#4a4a4a] p-2 min-h-0">
              <canvas 
                ref={popoutWaterfallCanvasRef}
                onMouseMove={handleMouseMoveWaterfall}
                onMouseLeave={handleMouseLeave}
                className="block w-full h-full"
              />
            </div>
          </div>
        </FloatingWindow>
      )}
    </div>
  );
}
