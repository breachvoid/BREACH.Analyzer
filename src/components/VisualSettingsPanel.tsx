/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Palette, RotateCcw, Check, Eye, Sliders, Sparkles, Grid } from 'lucide-react';
import { AnalyzerConfig, VisualizerMode } from '../types';

interface VisualSettingsPanelProps {
  config: AnalyzerConfig;
  setConfig: React.Dispatch<React.SetStateAction<AnalyzerConfig>>;
  deck1ShowGrid?: boolean;
  setDeck1ShowGrid?: (show: boolean) => void;
  deck2ShowGrid?: boolean;
  setDeck2ShowGrid?: (show: boolean) => void;
}

interface ThemePreset {
  name: string;
  primary: string;
  secondary: string;
  highlight: string;
  tertiary: string;
}

const THEME_PRESETS: ThemePreset[] = [
  {
    name: 'Rekordbox RGB',
    primary: '#00E639', // Green (Mids/Vocals)
    secondary: '#FF1E1E', // Red (Lows/Bass)
    highlight: '#00E5FF', // Cyan / Sky Blue (Highs/Cymbals)
    tertiary: '#FF8800' // Orange / Amber (Low-Mid Punch)
  },
  {
    name: 'Serato RGB',
    primary: '#0066FF', // Blue (Lows)
    secondary: '#FF0055', // Red / Magenta (Mids)
    highlight: '#FFFFFF', // White (Highs)
    tertiary: '#FF9900' // Amber
  },
  {
    name: 'BREACH. Crimson',
    primary: '#B20000',
    secondary: '#1A0000',
    highlight: '#FF3333',
    tertiary: '#E60000'
  },
  {
    name: 'Cyber Cyan',
    primary: '#00E5FF',
    secondary: '#002244',
    highlight: '#FFAA00',
    tertiary: '#0088FF'
  },
  {
    name: 'Acid Emerald',
    primary: '#00FF66',
    secondary: '#002211',
    highlight: '#FFDD00',
    tertiary: '#00B344'
  },
  {
    name: 'Amber Analog',
    primary: '#FF9900',
    secondary: '#331A00',
    highlight: '#FFE57F',
    tertiary: '#FF5500'
  },
  {
    name: 'Monochrome Slate',
    primary: '#FFFFFF',
    secondary: '#1A1C1E',
    highlight: '#9098A3',
    tertiary: '#5D636D'
  }
];

export const VisualSettingsPanel: React.FC<VisualSettingsPanelProps> = ({
  config,
  setConfig,
  deck1ShowGrid,
  setDeck1ShowGrid,
  deck2ShowGrid,
  setDeck2ShowGrid
}) => {
  const currentPrimary = config.customColors?.primary || '#00E639';
  const currentSecondary = config.customColors?.secondary || '#FF1E1E';
  const currentHighlight = config.customColors?.accent || '#00E5FF';
  const currentTertiary = config.customColors?.tertiary || '#FF8800';

  const [hexInputs, setHexInputs] = useState({
    primary: currentPrimary,
    secondary: currentSecondary,
    highlight: currentHighlight,
    tertiary: currentTertiary
  });

  const updateColors = (newColors: { primary?: string; secondary?: string; highlight?: string; tertiary?: string }) => {
    const updatedPrimary = newColors.primary ?? currentPrimary;
    const updatedSecondary = newColors.secondary ?? currentSecondary;
    const updatedHighlight = newColors.highlight ?? currentHighlight;
    const updatedTertiary = newColors.tertiary ?? currentTertiary;

    setHexInputs({
      primary: updatedPrimary,
      secondary: updatedSecondary,
      highlight: updatedHighlight,
      tertiary: updatedTertiary
    });

    setConfig({
      ...config,
      colorPalette: 'custom',
      waveformPalette: 'rgb',
      customColors: {
        primary: updatedPrimary,
        secondary: updatedSecondary,
        accent: updatedHighlight,
        tertiary: updatedTertiary
      }
    });
  };

  const handleHexBlur = (field: 'primary' | 'secondary' | 'highlight' | 'tertiary', value: string) => {
    let clean = value.trim();
    if (!clean.startsWith('#')) clean = '#' + clean;
    if (/^#[0-9A-Fa-f]{6}$/.test(clean)) {
      updateColors({ [field]: clean });
    } else {
      const fallback = field === 'primary' ? currentPrimary :
                       field === 'secondary' ? currentSecondary :
                       field === 'highlight' ? currentHighlight : currentTertiary;
      setHexInputs(prev => ({ ...prev, [field]: fallback }));
    }
  };

  const applyPreset = (preset: ThemePreset) => {
    if (preset.name === 'Rekordbox RGB') {
      resetToDefault();
      return;
    }
    updateColors({
      primary: preset.primary,
      secondary: preset.secondary,
      highlight: preset.highlight,
      tertiary: preset.tertiary
    });
  };

  const resetToDefault = () => {
    setConfig(prev => ({
      ...prev,
      colorPalette: 'pioneer-rgb',
      waveformPalette: 'rgb',
      customColors: undefined
    }));
    setHexInputs({
      primary: '#00E639',
      secondary: '#FF1E1E',
      highlight: '#00E5FF',
      tertiary: '#FF8800'
    });
  };

  return (
    <div className="flex flex-col gap-4 bg-[#121212] border border-[#4a4a4a] p-4 text-left select-none" id="visual-settings-panel">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#4a4a4a] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-[#181818] border border-[#4a4a4a] text-[#b20000] flex items-center justify-center">
            <Palette className="w-4 h-4 text-[#b20000]" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[#F2F2F2] font-sans tracking-[1.4px] uppercase flex items-center gap-2">
              Visual & Theme Settings
              {config.colorPalette === 'custom' ? (
                <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 bg-[#181818] text-[#ff8800] border border-[#ff8800]/50 tracking-[1px]">
                  CUSTOM ACTIVE
                </span>
              ) : (
                <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 bg-[#181818] text-[#F2F2F2] border border-[#4a4a4a] tracking-[1px]">
                  REKORDBOX RGB (DEFAULT)
                </span>
              )}
            </h3>
            <p className="text-[10px] text-[#858585] font-sans mt-0.5 uppercase tracking-[0.5px]">
              Configure color themes, multi-band frequency palettes, waveform rendering modes, and visualizer overlays.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={resetToDefault}
          className="flex items-center gap-1.5 text-[11px] font-sans font-medium uppercase tracking-[0.8px] text-[#B8B8B8] hover:text-[#111111] hover:bg-[#F2F2F2] px-2.5 py-1.5 bg-[#181818] border border-[#4a4a4a] transition-colors cursor-pointer"
          title="Reset to Rekordbox RGB defaults"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset Theme</span>
        </button>
      </div>

      {/* Row 1: Theme Presets */}
      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-sans text-[#B8B8B8] uppercase tracking-[1.2px] font-semibold">
          Theme Presets
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {THEME_PRESETS.map((preset) => {
            const isSelected = config.colorPalette === 'custom'
              ? (currentPrimary === preset.primary && currentSecondary === preset.secondary)
              : (preset.name === 'Rekordbox RGB');

            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`p-2 border text-left flex flex-col gap-1.5 transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-[#b20000] bg-[#1a1a1a]'
                    : 'border-[#333333] bg-[#141414] hover:border-[#666666]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-sans font-medium uppercase text-[#F2F2F2] tracking-wider truncate">
                    {preset.name}
                  </span>
                  {isSelected && <Check className="w-3 h-3 text-[#b20000] shrink-0" />}
                </div>
                {/* 4 Color Swatches */}
                <div className="flex items-center gap-1 w-full h-3">
                  <span className="flex-1 h-full rounded-none" style={{ backgroundColor: preset.secondary }} title="Lows / Bass" />
                  <span className="flex-1 h-full rounded-none" style={{ backgroundColor: preset.tertiary }} title="Low-Mids" />
                  <span className="flex-1 h-full rounded-none" style={{ backgroundColor: preset.primary }} title="Mids / Vocals" />
                  <span className="flex-1 h-full rounded-none" style={{ backgroundColor: preset.highlight }} title="Highs / Air" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 2: Custom 4-Band Frequency Stem Color Pickers */}
      <div className="flex flex-col gap-2 border-t border-[#333333] pt-3">
        <label className="text-[11px] font-sans text-[#B8B8B8] uppercase tracking-[1.2px] font-semibold">
          Frequency Band Colors
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Lows / Bass */}
          <div className="flex flex-col gap-1 p-2 bg-[#181818] border border-[#383838]">
            <span className="text-[10px] font-sans font-medium text-[#858585] uppercase tracking-wider">
              Lows / Bass
            </span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={currentSecondary}
                onChange={(e) => updateColors({ secondary: e.target.value })}
                className="w-6 h-6 border-0 bg-transparent cursor-pointer p-0"
              />
              <input
                type="text"
                value={hexInputs.secondary}
                onChange={(e) => setHexInputs(p => ({ ...p, secondary: e.target.value }))}
                onBlur={(e) => handleHexBlur('secondary', e.target.value)}
                className="w-16 bg-[#121212] border border-[#4a4a4a] text-[#F2F2F2] text-[11px] font-mono px-1 py-0.5 text-center focus:outline-none"
              />
            </div>
          </div>

          {/* Low-Mids / Punch */}
          <div className="flex flex-col gap-1 p-2 bg-[#181818] border border-[#383838]">
            <span className="text-[10px] font-sans font-medium text-[#858585] uppercase tracking-wider">
              Low-Mids / Punch
            </span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={currentTertiary}
                onChange={(e) => updateColors({ tertiary: e.target.value })}
                className="w-6 h-6 border-0 bg-transparent cursor-pointer p-0"
              />
              <input
                type="text"
                value={hexInputs.tertiary}
                onChange={(e) => setHexInputs(p => ({ ...p, tertiary: e.target.value }))}
                onBlur={(e) => handleHexBlur('tertiary', e.target.value)}
                className="w-16 bg-[#121212] border border-[#4a4a4a] text-[#F2F2F2] text-[11px] font-mono px-1 py-0.5 text-center focus:outline-none"
              />
            </div>
          </div>

          {/* Mids / Vocals */}
          <div className="flex flex-col gap-1 p-2 bg-[#181818] border border-[#383838]">
            <span className="text-[10px] font-sans font-medium text-[#858585] uppercase tracking-wider">
              Mids / Vocals
            </span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={currentPrimary}
                onChange={(e) => updateColors({ primary: e.target.value })}
                className="w-6 h-6 border-0 bg-transparent cursor-pointer p-0"
              />
              <input
                type="text"
                value={hexInputs.primary}
                onChange={(e) => setHexInputs(p => ({ ...p, primary: e.target.value }))}
                onBlur={(e) => handleHexBlur('primary', e.target.value)}
                className="w-16 bg-[#121212] border border-[#4a4a4a] text-[#F2F2F2] text-[11px] font-mono px-1 py-0.5 text-center focus:outline-none"
              />
            </div>
          </div>

          {/* Highs / Air */}
          <div className="flex flex-col gap-1 p-2 bg-[#181818] border border-[#383838]">
            <span className="text-[10px] font-sans font-medium text-[#858585] uppercase tracking-wider">
              Highs / Air
            </span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={currentHighlight}
                onChange={(e) => updateColors({ highlight: e.target.value })}
                className="w-6 h-6 border-0 bg-transparent cursor-pointer p-0"
              />
              <input
                type="text"
                value={hexInputs.highlight}
                onChange={(e) => setHexInputs(p => ({ ...p, highlight: e.target.value }))}
                onBlur={(e) => handleHexBlur('highlight', e.target.value)}
                className="w-16 bg-[#121212] border border-[#4a4a4a] text-[#F2F2F2] text-[11px] font-mono px-1 py-0.5 text-center focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Visualizer Display Modes & Grid Controls */}
      <div className="flex flex-col gap-2 border-t border-[#333333] pt-3">
        <label className="text-[11px] font-sans text-[#B8B8B8] uppercase tracking-[1.2px] font-semibold">
          Display Modes & Overlays
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Spectrum Visualizer Style */}
          <div className="flex flex-col gap-1 p-2 bg-[#181818] border border-[#383838]">
            <span className="text-[10px] font-sans font-medium text-[#858585] uppercase tracking-wider">
              Spectrum Style
            </span>
            <select
              value={config.visualizerMode}
              onChange={(e) => setConfig(prev => ({ ...prev, visualizerMode: e.target.value as VisualizerMode }))}
              className="bg-[#121212] border border-[#4a4a4a] text-[#F2F2F2] text-[11px] font-sans font-medium uppercase p-1.5 focus:outline-none cursor-pointer"
            >
              <option value={VisualizerMode.SPECTRUM_BARS}>Vertical Bars</option>
              <option value={VisualizerMode.SPECTRUM_CURVE}>Smooth Curve</option>
            </select>
          </div>

          {/* Waveform Palette Preset */}
          <div className="flex flex-col gap-1 p-2 bg-[#181818] border border-[#383838]">
            <span className="text-[10px] font-sans font-medium text-[#858585] uppercase tracking-wider">
              Waveform Color Mode
            </span>
            <select
              value={config.waveformPalette || 'rgb'}
              onChange={(e) => setConfig(prev => ({ ...prev, waveformPalette: e.target.value as any }))}
              className="bg-[#121212] border border-[#4a4a4a] text-[#F2F2F2] text-[11px] font-sans font-medium uppercase p-1.5 focus:outline-none cursor-pointer"
            >
              <option value="rgb">RGB (Default)</option>
              <option value="3-band">3-Band Frequency</option>
              <option value="void">BREACH Crimson</option>
              <option value="blue">Electric Blue</option>
            </select>
          </div>

          {/* Grid Overlays */}
          <div className="flex flex-col gap-1.5 p-2 bg-[#181818] border border-[#383838]">
            <span className="text-[10px] font-sans font-medium text-[#858585] uppercase tracking-wider">
              Grid Lines
            </span>
            <div className="flex items-center gap-2">
              {setDeck1ShowGrid && (
                <button
                  type="button"
                  onClick={() => setDeck1ShowGrid(!deck1ShowGrid)}
                  className={`flex-1 py-1 px-2 border text-[10px] font-sans font-medium uppercase tracking-wider transition-colors cursor-pointer ${
                    deck1ShowGrid
                      ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2]'
                      : 'bg-[#121212] border-[#4a4a4a] text-[#B8B8B8] hover:text-[#F2F2F2]'
                  }`}
                >
                  Spectrum: {deck1ShowGrid ? 'ON' : 'OFF'}
                </button>
              )}
              {setDeck2ShowGrid && (
                <button
                  type="button"
                  onClick={() => setDeck2ShowGrid(!deck2ShowGrid)}
                  className={`flex-1 py-1 px-2 border text-[10px] font-sans font-medium uppercase tracking-wider transition-colors cursor-pointer ${
                    deck2ShowGrid
                      ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2]'
                      : 'bg-[#121212] border-[#4a4a4a] text-[#B8B8B8] hover:text-[#F2F2F2]'
                  }`}
                >
                  Waveform: {deck2ShowGrid ? 'ON' : 'OFF'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
