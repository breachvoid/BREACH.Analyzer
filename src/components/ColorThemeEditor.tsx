/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Palette, RotateCcw, Sparkles, Check, SlidersHorizontal } from 'lucide-react';
import { AnalyzerConfig } from '../types';

interface ColorThemeEditorProps {
  config: AnalyzerConfig;
  setConfig: React.Dispatch<React.SetStateAction<AnalyzerConfig>>;
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

export const ColorThemeEditor: React.FC<ColorThemeEditorProps> = ({ config, setConfig }) => {
  // Default to Rekordbox RGB colors (Green = Mids #00E639, Red = Bass #FF1E1E, Cyan = Highs #00E5FF, Orange = Punch #FF8800)
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
      // Revert to current value
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
      primary: '#00E5FF',
      secondary: '#0066FF',
      highlight: '#FFFFFF',
      tertiary: '#FFAA00'
    });
  };

  return (
    <div className="flex flex-col gap-3.5 bg-[#121212] border border-[#4a4a4a] p-4" id="color-theme-editor">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#4a4a4a] pb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-[#181818] border border-[#4a4a4a] text-[#b20000] flex items-center justify-center">
            <Palette className="w-3.5 h-3.5 text-[#b20000]" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white font-sans tracking-[1.4px] uppercase flex items-center gap-2">
              Color Theme Editor
              {config.colorPalette === 'custom' ? (
                <span className="text-[9px] font-sans font-bold px-1.5 py-0.5 bg-[#181818] text-[#ff8800] border border-[#ff8800]/50 tracking-[1px]">
                  CUSTOM ACTIVE
                </span>
              ) : (
                <span className="text-[9px] font-sans font-bold px-1.5 py-0.5 bg-[#181818] text-white border border-[#4a4a4a] tracking-[1px]">
                  REKORDBOX RGB (DEFAULT)
                </span>
              )}
            </h3>
            <p className="text-[10px] text-[#aaaaaa] font-sans mt-0.5 uppercase tracking-[0.5px]">
              Deploy custom palette across spectrum visualizer traces, waveforms, and measurement meters.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={resetToDefault}
          className="flex items-center gap-1.5 text-[9px] font-sans font-bold uppercase tracking-[1px] text-[#cccccc] hover:text-[#111111] hover:bg-white px-2.5 py-1.5 bg-[#181818] border border-[#4a4a4a] transition-colors cursor-pointer"
          title="Reset to default Rekordbox RGB colors"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset Defaults</span>
        </button>
      </div>

      {/* Quick Presets Swatches */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] font-sans uppercase text-[#aaaaaa] font-bold tracking-[1px]">Quick Swatches:</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {THEME_PRESETS.map((preset) => {
            const isMatch =
              (preset.name === 'Rekordbox RGB' && (config.colorPalette === 'pioneer-rgb' || (!config.colorPalette && !config.customColors))) ||
              (config.colorPalette === 'custom' &&
               currentPrimary.toLowerCase() === preset.primary.toLowerCase() &&
               currentSecondary.toLowerCase() === preset.secondary.toLowerCase());

            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`flex items-center gap-2 p-1.5 border text-left transition-colors cursor-pointer select-none ${
                  isMatch
                    ? 'bg-[#181818] border-white text-white'
                    : 'bg-[#181818] border-[#4a4a4a] text-[#cccccc] hover:bg-white hover:text-[#111111]'
                }`}
                title={`Apply ${preset.name} palette`}
              >
                <div className="flex items-center -space-x-1 shrink-0">
                  <div className="w-3 h-3 border border-black" style={{ backgroundColor: preset.primary }} />
                  <div className="w-3 h-3 border border-black" style={{ backgroundColor: preset.secondary }} />
                  <div className="w-3 h-3 border border-black" style={{ backgroundColor: preset.highlight }} />
                </div>
                <span className="text-[9px] font-sans font-bold uppercase tracking-[0.5px] truncate">{preset.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3 Core Color Pickers (Primary, Secondary, Highlight) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#0e0e0e] p-3 border border-[#4a4a4a]">
        
        {/* 1. Primary Color */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-sans text-white font-bold uppercase tracking-[1px]">Primary Color</span>
            <span className="text-[8px] font-sans text-[#aaaaaa] uppercase tracking-[0.5px]">Trace & Accents</span>
          </div>
          <div className="flex items-center gap-2 bg-[#181818] border border-[#4a4a4a] p-1.5 relative h-9">
            <input
              type="color"
              value={currentPrimary}
              onChange={(e) => updateColors({ primary: e.target.value })}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
              title="Click to select Primary Color"
            />
            <div
              className="w-5 h-5 border border-[#4a4a4a] shrink-0"
              style={{ backgroundColor: currentPrimary }}
            />
            <input
              type="text"
              value={hexInputs.primary}
              onChange={(e) => setHexInputs(prev => ({ ...prev, primary: e.target.value }))}
              onBlur={(e) => handleHexBlur('primary', e.target.value)}
              className="bg-transparent border-0 text-[10px] font-sans font-bold text-white tracking-wider focus:outline-none w-20 uppercase"
              maxLength={7}
            />
          </div>
        </div>

        {/* 2. Secondary Color */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-sans text-white font-bold uppercase tracking-[1px]">Secondary Color</span>
            <span className="text-[8px] font-sans text-[#aaaaaa] uppercase tracking-[0.5px]">Floor & Shadow</span>
          </div>
          <div className="flex items-center gap-2 bg-[#181818] border border-[#4a4a4a] p-1.5 relative h-9">
            <input
              type="color"
              value={currentSecondary}
              onChange={(e) => updateColors({ secondary: e.target.value })}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
              title="Click to select Secondary Color"
            />
            <div
              className="w-5 h-5 border border-[#4a4a4a] shrink-0"
              style={{ backgroundColor: currentSecondary }}
            />
            <input
              type="text"
              value={hexInputs.secondary}
              onChange={(e) => setHexInputs(prev => ({ ...prev, secondary: e.target.value }))}
              onBlur={(e) => handleHexBlur('secondary', e.target.value)}
              className="bg-transparent border-0 text-[10px] font-sans font-bold text-white tracking-wider focus:outline-none w-20 uppercase"
              maxLength={7}
            />
          </div>
        </div>

        {/* 3. Highlight Color */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-sans text-white font-bold uppercase tracking-[1px]">Highlight Color</span>
            <span className="text-[8px] font-sans text-[#aaaaaa] uppercase tracking-[0.5px]">Peaks & Markers</span>
          </div>
          <div className="flex items-center gap-2 bg-[#181818] border border-[#4a4a4a] p-1.5 relative h-9">
            <input
              type="color"
              value={currentHighlight}
              onChange={(e) => updateColors({ highlight: e.target.value })}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
              title="Click to select Highlight Color"
            />
            <div
              className="w-5 h-5 border border-[#4a4a4a] shrink-0"
              style={{ backgroundColor: currentHighlight }}
            />
            <input
              type="text"
              value={hexInputs.highlight}
              onChange={(e) => setHexInputs(prev => ({ ...prev, highlight: e.target.value }))}
              onBlur={(e) => handleHexBlur('highlight', e.target.value)}
              className="bg-transparent border-0 text-[10px] font-sans font-bold text-white tracking-wider focus:outline-none w-20 uppercase"
              maxLength={7}
            />
          </div>
        </div>

      </div>

      {/* Live Gradient Preview Bar */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[8px] font-sans font-bold text-[#aaaaaa] uppercase tracking-[1px]">
          <span>Interpolated Spectral Gradient Spectrum</span>
          <span>Floor &rarr; Mid &rarr; Peak &rarr; Accent</span>
        </div>
        <div
          className="h-3.5 w-full border border-[#4a4a4a]"
          style={{
            background: `linear-gradient(to right, #000000, ${currentSecondary}, ${currentPrimary}, ${currentTertiary}, ${currentHighlight})`
          }}
        />
      </div>
    </div>
  );
};
