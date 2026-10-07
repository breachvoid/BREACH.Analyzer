/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  AnalyzerConfig,
  TrackAnalysisDisplay,
  AudioSourceType, 
  VisualizerMode, 
  FrequencyScale, 
  LoudnessStandard,
  FFTWindowFunction 
} from './types';
import { audioAnalyzer, useStreamMetadata, useAudioMetrics, useAnalyzerState } from './audioEngine';
import { AnalyserCanvas } from './components/AnalyserCanvas';
import { SettingsPanel } from './components/SettingsPanel';
import { LoudnessMeter } from './components/LoudnessMeter';
import { SourceSelector } from './components/SourceSelector';
import { FloatingWindow } from './components/FloatingWindow';
import { StereoVectorScope } from './components/StereoVectorScope';
import { EqualizerDeck } from './components/EqualizerDeck';
import { DJWaveformDeck } from './components/DJWaveformDeck';
import { resolvePalette } from './utils';
import { usePersistentState } from './utils/storage';
import { 
  Info, 
  HelpCircle, 
  Activity, 
  Disc, 
  Cpu, 
  Zap,
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Maximize2, 
  Minimize2, 
  ExternalLink,
  Sliders,
  Save,
  Trash2,
  Compass,
  Waves,
  AudioLines,
  Mail
} from 'lucide-react';

const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = {
  fftSize: 2048,
  smoothing: 0.75,
  minDecibels: -120,
  maxDecibels: 0,
  frequencyScale: FrequencyScale.LOGARITHMIC,
  visualizerMode: VisualizerMode.SPECTRUM_BARS,
  targetLoudness: LoudnessStandard.YOUTUBE,
  showGrid: true,
  showPeakHold: true,
  colorPalette: 'pioneer-rgb',
  splitWaterfall: true,
  peakHoldDecay: 1000,
  waveformPalette: 'rgb',
  fftWindow: FFTWindowFunction.HANN,
  frequencyMarkers: [
    { id: 'marker_sub', frequency: 60, label: 'SUB' },
    { id: 'marker_kick', frequency: 120, label: 'BASS' },
    { id: 'marker_vocal', frequency: 2500, label: 'VOCAL' },
    { id: 'marker_air', frequency: 10000, label: 'AIR' }
  ]
};

const INITIAL_ANALYZER_CONFIG: AnalyzerConfig = (() => {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const prevRaw = localStorage.getItem('breach_active_analyzer_config');
      if (prevRaw) {
        const prev = JSON.parse(prevRaw);
        if (prev && typeof prev === 'object') {
          return {
            ...DEFAULT_ANALYZER_CONFIG,
            ...prev,
            colorPalette: prev.colorPalette === 'custom' ? 'custom' : 'pioneer-rgb',
            waveformPalette: 'rgb',
            visualizerMode: prev.visualizerMode || VisualizerMode.SPECTRUM_BARS
          };
        }
      }
    } catch {}
  }
  return DEFAULT_ANALYZER_CONFIG;
})();

export default function App() {
  const [activeSourceType, setActiveSourceType] = useState<AudioSourceType>(AudioSourceType.AUDIO_FILE);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const streamMetadata = useStreamMetadata();
  const [targetLoudness, setTargetLoudness] = useState<number>(LoudnessStandard.YOUTUBE);
  const [hardwareSampleRate, setHardwareSampleRate] = useState<number>(48000);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreenRef = useRef<(() => void) | null>(null);

  // Floating Window States
  const [isVisualizerPoppedOut, setIsVisualizerPoppedOut] = useState<boolean>(false);
  const [isLoudnessPoppedOut, setIsLoudnessPoppedOut] = useState<boolean>(false);
  const [isVectorPoppedOut, setIsVectorPoppedOut] = useState<boolean>(false);
  const [isDeckPoppedOut, setIsDeckPoppedOut] = useState<boolean>(false);
  const [isPlaylistPoppedOut, setIsPlaylistPoppedOut] = useState<boolean>(false);
  const [isDJWaveformPoppedOut, setIsDJWaveformPoppedOut] = useState<boolean>(false);

  const visualizerResetRef = useRef<(() => void) | null>(null);
  const vectorResetRef = useRef<(() => void) | null>(null);

  // Hoisted state for File Player & Volume Specs for sync from header
  const togglePlaybackRef = useRef<(() => void) | null>(null);
  const [fileUrl, setFileUrl] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysisDisplay | null>(null);
  const [volume, setVolume] = useState<number>(50);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isBypassed, setIsBypassed] = useState<boolean>(() => audioAnalyzer.isBypassed());
  const isMusicSource = activeSourceType === AudioSourceType.AUDIO_FILE;

  // Synchronize bypass state with audioEngine
  useEffect(() => {
    audioAnalyzer.setBypassed(isBypassed);
  }, [isBypassed]);

  // Workstation settings visibility state (Defaults to false: always default Studio Deck opening to "File")
  const [isSettingsOpen, setIsSettingsOpen] = usePersistentState<boolean>(
    'breach_settings_panel_open',
    false,
    (val) => typeof val === 'boolean'
  );

  const handleToggleSettings = () => {
    setIsSettingsOpen((prev) => !prev);
  };

  // Synchronized Analyzer Visual configuration (Default: Rekordbox RGB)
  const [analyzerConfig, setAnalyzerConfig] = usePersistentState<AnalyzerConfig>(
    'breach_active_analyzer_config_v2',
    INITIAL_ANALYZER_CONFIG,
    (parsed) => parsed && typeof parsed === 'object' && 'fftSize' in parsed
  );

  const [isThemeTransitioning, setIsThemeTransitioning] = useState<boolean>(false);
  useEffect(() => {
    setIsThemeTransitioning(true);
    const tm = setTimeout(() => setIsThemeTransitioning(false), 450);
    return () => clearTimeout(tm);
  }, [analyzerConfig.colorPalette, analyzerConfig.customColors]);

  // Resolve active theme palette (supports predefined or user custom theme)
  const activePalette = resolvePalette(analyzerConfig.colorPalette, analyzerConfig.customColors);

  // Synchronize CSS custom properties across root document for global UI theme customization
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.style.setProperty('--breach-primary', activePalette.primary);
      root.style.setProperty('--breach-secondary', activePalette.secondary);
      root.style.setProperty('--breach-highlight', activePalette.accent);
      root.style.setProperty('--breach-grid', activePalette.gridColor);
    }
  }, [activePalette.primary, activePalette.secondary, activePalette.accent, activePalette.gridColor]);

  // Verify locked font identity on startup: Geist for UI/body, Geist Mono for Instruments, Geist Pixel for sparse metadata
  useEffect(() => {
    if (typeof document !== 'undefined' && 'fonts' in document) {
      Promise.all([
        document.fonts.load('400 16px "Geist"'),
        document.fonts.load('600 16px "Geist"'),
        document.fonts.load('700 16px "Geist"'),
        document.fonts.load('800 16px "Geist"'),
        document.fonts.load('400 12px "Geist Mono"'),
        document.fonts.load('700 12px "Geist Mono"'),
        document.fonts.load('400 12px "Geist Pixel"'),
        document.fonts.load('700 12px "Geist Pixel"'),
        document.fonts.ready
      ]).then(() => {
        const isGeistLoaded = document.fonts.check('16px "Geist"');
        const isGeistMonoLoaded = document.fonts.check('12px "Geist Mono"');
        const isGeistPixelLoaded = document.fonts.check('12px "Geist Pixel"');
        console.log('[BREACH Typography] Verification:', {
          geist: isGeistLoaded ? 'Rendered (Active & Verified)' : 'Unverified',
          geistMono: isGeistMonoLoaded ? 'Rendered (Active & Verified)' : 'Unverified',
          geistPixel: isGeistPixelLoaded ? 'Rendered (Active & Verified)' : 'Unverified'
        });
      }).catch((err) => {
        console.warn('[BREACH Typography] Font verification exception:', err);
      });
    }
  }, []);

  const [isClipping, setIsClipping] = useState<boolean>(false);

  // Lifted grid states for deck 1 and 2
  const [deck1ShowGrid, setDeck1ShowGrid] = usePersistentState<boolean>(
    'breach_deck1_show_grid',
    true,
    (val) => typeof val === 'boolean'
  );

  const [deck2ShowGrid, setDeck2ShowGrid] = usePersistentState<boolean>(
    'breach_deck2_show_grid',
    true,
    (val) => typeof val === 'boolean'
  );

  // Synchronize clipping events across components using the useAudioMetrics callback hook (zero re-render callbacks)
  const clipTimeoutRef = useRef<number | null>(null);
  useAudioMetrics((newMetrics) => {
    if (newMetrics.peakLeft >= 0 || newMetrics.peakRight >= 0) {
      setIsClipping(true);
      if (clipTimeoutRef.current !== null) {
        clearTimeout(clipTimeoutRef.current);
      }
      clipTimeoutRef.current = window.setTimeout(() => {
        setIsClipping(false);
        clipTimeoutRef.current = null;
      }, 300);
    }
  });

  useEffect(() => {
    return () => {
      if (clipTimeoutRef.current !== null) {
        clearTimeout(clipTimeoutRef.current);
      }
    };
  }, []);

  // Keep target loudness synced between standard selector and visualizer guidelines
  useEffect(() => {
    setAnalyzerConfig(prev => ({
      ...prev,
      targetLoudness
    }));
  }, [targetLoudness]);

  // Synchronize master output settings
  useEffect(() => {
    const isMusicSource = activeSourceType === AudioSourceType.AUDIO_FILE;
    if (isMusicSource) {
      audioAnalyzer.setVolume(volume / 100);
      audioAnalyzer.setMuted(isMuted);
    } else {
      audioAnalyzer.setVolume(0);
      audioAnalyzer.setMuted(true);
    }
  }, [volume, isMuted, activeSourceType]);

  // Synchronize playbacks state of context with UI using useAnalyzerState hook
  const activeState = useAnalyzerState();
  useEffect(() => {
    setIsPlaying(activeState);
  }, [activeState]);

  useEffect(() => {
    // Detect actual hardware sample rate
    const ctx = audioAnalyzer.getContext();
    let handleGesture: (() => void) | null = null;
    if (ctx) {
      setHardwareSampleRate(ctx.sampleRate);
    } else {
      // Lazy detect
      handleGesture = () => {
        const testCtx = audioAnalyzer.initContext();
        if (testCtx) {
          setHardwareSampleRate(testCtx.sampleRate);
        }
        if (handleGesture) {
          window.removeEventListener('click', handleGesture);
          window.removeEventListener('keydown', handleGesture);
          window.removeEventListener('touchstart', handleGesture);
        }
      };
      window.addEventListener('click', handleGesture);
      window.addEventListener('keydown', handleGesture);
      window.addEventListener('touchstart', handleGesture, { passive: true });
    }

    return () => {
      audioAnalyzer.stop();
      if (handleGesture) {
        window.removeEventListener('click', handleGesture);
        window.removeEventListener('keydown', handleGesture);
        window.removeEventListener('touchstart', handleGesture);
      }
    };
  }, []);

  const handleSourceChanged = (type: AudioSourceType) => {
    setActiveSourceType(type);
  };

  const handleTogglePlayback = () => {
    if (togglePlaybackRef.current) {
      togglePlaybackRef.current();
    }
  };

  // Keyboard Shortcuts Listener (Space to toggle engine)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl) {
        const tagName = activeEl.tagName.toUpperCase();
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true') {
          return;
        }
      }

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlayback();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Synchronize state for overlay query parameters if loaded in OBS or single panel mode
  const [overlayMode, setOverlayMode] = useState<string | null>(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('overlay');
      if (mode) {
        setOverlayMode(mode.toLowerCase());
      }
    } catch (e) {
      console.error('Failed to parse window.location query params:', e);
    }
  }, []);

  if (overlayMode) {
    return <main className="min-h-screen bg-[#121212] text-[#F2F2F2] p-6 font-sans">
      <h1 className="text-sm uppercase tracking-widest">BREACH. · Standalone overlay unavailable</h1>
      <p className="mt-3 text-sm text-[#aaa]">This window is not connected to the analyzer. Open the app and use a panel's pop-out control to view live measurements.</p>
      <a href={window.location.pathname} className="inline-block mt-4 text-sm text-[#ff4444] underline">Open analyzer</a>
    </main>;
  }

  return (
    <div className="min-h-screen bg-[#121212] text-white flex flex-col justify-between selection:bg-[#B20000]/30 select-none pb-8" id="workspace-root">
      
      {/* 1. Main Navigation Header styled after guides.breach.productions */}
      <header className="border-b border-[#4a4a4a] bg-[#121212] sticky top-0 z-20 px-6 sm:px-12 py-5 flex flex-wrap justify-between items-center gap-4 relative" id="navigator-bar">
        <div className="flex items-center gap-6">
          {/* Scaled uncropped BREACH. ANALYZER brand lockup */}
          <div className="flex flex-col select-none shrink-0" id="main-brand-logo">
            <div className="flex items-center">
              <img 
                src="/breach_wordmark.svg" 
                alt="BREACH." 
                className="h-6 sm:h-7 w-auto object-contain select-none filter" 
                referrerPolicy="no-referrer" 
              />
            </div>
            <div className="flex items-center justify-between px-0.5 mt-1">
              <span 
                className="text-[10px] sm:text-[11px] font-sans font-semibold text-[#858585] tracking-[0.45em] uppercase select-none leading-none"
                style={{ textAlign: 'right', marginTop: '-1px', marginRight: '0px', paddingLeft: '2px', paddingBottom: '0px', marginLeft: '53px', fontFamily: 'Geist' }}
              >
                ANALYZER
              </span>
            </div>
          </div>
          <div className="hidden sm:flex items-center pl-4 border-l-4 border-[#B20000]">
            <span className="text-[11px] text-[#B8B8B8] font-sans tracking-[1.4px] uppercase font-medium">
              Precision Spectral Fourier & EBU R128 Loudness Instrument
            </span>
          </div>
        </div>

        {/* Sticky Header Engine Control & Volume */}
        <div className="flex flex-wrap items-center gap-3 sm:mr-24 max-w-full" id="header-engine-control">
          
          {/* Master Volume */}
          <div className={`flex items-center gap-2.5 px-3 py-1.5 border border-[#4a4a4a] bg-[#181818] w-40 sm:w-48 transition-colors duration-150 ${
            !isMusicSource ? 'opacity-35 border-dashed' : 'opacity-100 hover:border-[#888888] hover:bg-[#191919]'
          }`} title={!isMusicSource ? 'Live hardware microphone/system sources are muted locally to prevent acoustic howl feedback loops.' : 'Adjust local master audio playback monitoring level'}>
            <button
              id="btn-volume-mute"
              disabled={!isMusicSource}
              onClick={() => setIsMuted(!isMuted)}
              className={`shrink-0 transition-opacity duration-150 ${
                isMusicSource ? 'text-[#B8B8B8] hover:text-[#F2F2F2] cursor-pointer' : 'text-[#555555] cursor-not-allowed'
              }`}
              title={!isMusicSource ? 'Playback monitoring disabled' : isMuted ? 'Unmute and restore master audio output monitoring' : 'Mute master audio output monitoring'}
            >
              {!isMusicSource || isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5 text-[#B20000]" /> : <Volume2 className="w-3.5 h-3.5 text-[#B8B8B8]" />}
            </button>
            
            <input
              id="slider-master-volume"
              type="range"
              min="0"
              max="100"
              disabled={!isMusicSource}
              value={isMusicSource ? volume : 0}
              onChange={(e) => setVolume(parseInt(e.target.value))}
              className={`flex-grow min-w-0 accent-[#B20000] h-1 bg-[#121212] transition-colors ${isMusicSource ? 'cursor-pointer' : 'cursor-not-allowed'}`}
              style={{ 
                background: isMusicSource 
                  ? `linear-gradient(to right, #B20000 ${volume}%, #4a4a4a ${volume}%)` 
                  : '#4a4a4a' 
              }}
              title={!isMusicSource ? 'Playback monitoring disabled' : 'Drag to adjust master local audio monitoring volume level'}
            />

            <span className="text-[11px] font-mono text-[#F2F2F2] font-medium w-8 text-right min-w-[28px] shrink-0" id="header-volume-text">
              {!isMusicSource ? 'OFF' : isMuted ? 'MUT' : `${volume}%`}
            </span>
          </div>

          {/* Master Bypass */}
          <button
            id="btn-master-bypass"
            onClick={() => setIsBypassed(!isBypassed)}
            title={isBypassed ? "Disable master bypass and restore speaker monitoring" : "Enable master bypass: disconnect output streams from speakers while keeping the visualizers active"}
            className={`h-9 px-3.5 border text-[11px] uppercase tracking-[1px] font-medium transition-colors duration-150 cursor-pointer ${
              isBypassed
                ? 'bg-[#B20000] border-[#B20000] text-[#F2F2F2]'
                : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2]'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 ${isBypassed ? 'bg-[#F2F2F2]' : 'bg-[#B20000]'}`}></span>
              Bypass
            </span>
          </button>

          {/* Master Engine Active/Inactive Toggle */}
          <button
            id="btn-header-player-toggle"
            disabled={activeSourceType === AudioSourceType.AUDIO_FILE && !fileUrl}
            onClick={handleTogglePlayback}
            title={isPlaying ? "Stop real-time audio analytics engine processing (Space)" : activeSourceType === AudioSourceType.AUDIO_FILE && !fileUrl ? "Select an audio track in the Music Lab playlist to start the engine" : "Start real-time audio analytics engine processing (Space)"}
            className={`h-9 px-4 border flex items-center justify-center gap-2 text-[11px] uppercase font-medium tracking-[1px] transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer ${
              isPlaying
                ? 'bg-[#B20000] border-[#B20000] text-[#F2F2F2]'
                : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2]'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3 h-3 fill-current text-current" />
                Active analyzer
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current text-current" />
                Inactive analyzer
              </>
            )}
          </button>
        </div>

        {/* Anchored Top Right Corner - Guides style contact icons */}
        <div 
          className="absolute top-5 right-6 sm:right-12 flex items-center gap-2.5 z-30" 
          id="header-anchored-contact-icons"
        >
          <a
            href="mailto:contact@breach.productions"
            title="Contact BREACH.PRODUCTIONS"
            aria-label="Email BREACH.PRODUCTIONS"
            className="w-[26px] h-[26px] grid place-items-center text-[#B20000] hover:opacity-65 transition-opacity duration-150 cursor-pointer"
            id="header-link-envelope"
          >
            <Mail className="w-[19px] h-[19px] text-[#B20000]" />
          </a>

          <a
            href="https://discord.gg/sV94dsDybq"
            target="_blank"
            rel="noopener noreferrer"
            title="Join BREACH Discord"
            aria-label="Join BREACH Discord"
            className="w-[26px] h-[26px] grid place-items-center text-[#B20000] hover:opacity-65 transition-opacity duration-150 cursor-pointer"
            id="header-link-discord"
          >
            <svg
              className="w-[19px] h-[19px] fill-[#B20000] shrink-0"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
          </a>
        </div>
      </header>

      {/* 2. Main Dashboard Stage */}
      <main className="max-w-7xl w-full mx-auto px-6 mt-6 flex-grow flex flex-col justify-start gap-6" id="main-content-stage">

        {/* Master Controls Panel */}
        <section className="w-full flex" id="master-controls-panel-section">
          <div className="flex flex-col select-none w-full gap-4" id="master-controls-panel">
            {/* Top row controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
              {/* Left: SourceSelector Component (Aligned to far left) */}
              <div className="flex-grow flex justify-start w-full" id="panel-source-selector">
                <SourceSelector 
                  onSourceChanged={handleSourceChanged}
                  activeSourceType={activeSourceType}
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                  togglePlaybackRef={togglePlaybackRef}
                  trackAnalysis={trackAnalysis}
                  fileUrl={fileUrl}
                  setFileUrl={setFileUrl}
                  fileName={fileName}
                  setFileName={setFileName}
                  showSettings={isSettingsOpen}
                  onToggleSettings={handleToggleSettings}
                  isDeckPoppedOut={isDeckPoppedOut}
                  setIsDeckPoppedOut={setIsDeckPoppedOut}
                  isPlaylistPoppedOut={isPlaylistPoppedOut}
                  setIsPlaylistPoppedOut={setIsPlaylistPoppedOut}
                  config={analyzerConfig}
                  setConfig={setAnalyzerConfig}
                  targetLoudness={targetLoudness}
                  setTargetLoudness={setTargetLoudness}
                  deck1ShowGrid={deck1ShowGrid}
                  setDeck1ShowGrid={setDeck1ShowGrid}
                  deck2ShowGrid={deck2ShowGrid}
                  setDeck2ShowGrid={setDeck2ShowGrid}
                />
              </div>
            </div>
          </div>
        </section>

        <div className="@container w-full" id="waveform-eq-row">
        <div className="grid grid-cols-1 @min-[850px]:grid-cols-[minmax(0,1fr)_300px] gap-3.5 items-stretch">
        {/* DJ Generated Waveform Deck (Interactive Multi-Band RGB Waveform & Beat Grid Workstation) */}
        <section 
          className="min-w-0 w-full flex flex-col border border-[#4a4a4a] bg-[#1a1a1a] overflow-hidden" 
          id="dj-waveform-deck-section"
        >
          {isDJWaveformPoppedOut ? (
            <div className="w-full min-h-[200px] bg-[#121212] border border-[#4a4a4a] flex flex-col items-center justify-center p-8 text-center gap-3 select-none" id="dj-waveform-dock-placeholder">
              <div className="h-11 w-11 bg-[#181818] border border-[#4a4a4a] flex items-center justify-center text-[#b20000]">
                <Disc className="w-5 h-5 text-[#b20000]" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-[#F2F2F2] font-sans tracking-[1.4px] uppercase">DJ Waveform Deck Popped Out</h3>
                <p className="text-[10px] text-[#858585] font-sans max-w-sm mx-auto leading-normal uppercase tracking-wider">
                  The high-resolution RGB multi-band waveform and beatgrid editor is actively running in floating window mode.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDJWaveformPoppedOut(false)}
                className="mt-2 px-3.5 py-1.5 text-[11px] uppercase font-sans font-medium tracking-[0.8px] bg-[#181818] text-[#b20000] border border-[#4a4a4a] hover:bg-[#b20000] hover:text-white transition-colors cursor-pointer"
                id="btn-redock-dj-waveform"
              >
                Dock Waveform Deck
              </button>
            </div>
          ) : (
            <DJWaveformDeck 
              onTrackAnalysis={setTrackAnalysis}
              fileUrl={fileUrl}
              fileName={fileName}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              togglePlaybackRef={togglePlaybackRef}
              onPopOut={() => setIsDJWaveformPoppedOut(true)}
              config={analyzerConfig}
            />
          )}
        </section>

        <EqualizerDeck />
        </div>
        </div>

        {/* Top Section: Master Spectrum Analyzer Deck (Main Attraction) with Integrated Signal Selection */}
        <section 
          className={`w-full flex flex-col border border-[#4a4a4a] bg-[#1a1a1a] overflow-hidden transition-colors duration-150 ${isVisualizerPoppedOut ? 'h-[250px]' : 'h-auto text-white'} ${isThemeTransitioning ? 'animate-theme-pulse' : ''}`} 
          id="visualizer-stage-section"
        >
          {isVisualizerPoppedOut ? (
            <div className="w-full h-full bg-[#121212] border border-[#4a4a4a] flex flex-col items-center justify-center p-8 text-center gap-3 select-none" id="visualizer-dock-placeholder">
              <div className="h-11 w-11 bg-[#181818] border border-[#4a4a4a] flex items-center justify-center text-[#b20000]">
                <AudioLines className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-[#F2F2F2] font-sans tracking-[1.4px] uppercase">Spectrum Analyzer Deck Popped Out</h3>
                <p className="text-[10px] text-[#858585] font-sans max-w-sm mx-auto leading-normal uppercase tracking-wider">
                  The real-time high-fidelity spectral analysis deck is actively rendering in floating window mode.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsVisualizerPoppedOut(false)}
                className="mt-2 px-3.5 py-1.5 text-[11px] uppercase font-sans font-medium tracking-[0.8px] bg-[#181818] text-[#b20000] border border-[#4a4a4a] hover:bg-[#b20000] hover:text-white transition-colors cursor-pointer"
                id="btn-redock-visualizer"
              >
                Dock Spectrum Analyzer Deck
              </button>
            </div>
          ) : (
            <AnalyserCanvas 
              config={analyzerConfig}
              setConfig={setAnalyzerConfig}
              isPlaying={isPlaying}
              onSourceChanged={handleSourceChanged}
              activeSourceType={activeSourceType}
              setIsPlaying={setIsPlaying}
              togglePlaybackRef={togglePlaybackRef}
              fileUrl={fileUrl}
              setFileUrl={setFileUrl}
              fileName={fileName}
              setFileName={setFileName}
              hardwareSampleRate={hardwareSampleRate}
              isFullscreen={isFullscreen}
              setIsFullscreen={setIsFullscreen}
              toggleFullscreenRef={toggleFullscreenRef}
              onPopOut={() => setIsVisualizerPoppedOut(true)}
              deck1ShowGrid={deck1ShowGrid}
              setDeck1ShowGrid={setDeck1ShowGrid}
              deck2ShowGrid={deck2ShowGrid}
              setDeck2ShowGrid={setDeck2ShowGrid}
              hideSplitWaterfall={true}
            />
          )}
        </section>

        {/* Separated Waveform / Oscilloscope Deck */}
        {analyzerConfig.splitWaterfall && (
          <section className="w-full flex flex-col" id="waveform-oscilloscope-stage-section">
            <AnalyserCanvas 
              config={analyzerConfig}
              setConfig={setAnalyzerConfig}
              isPlaying={isPlaying}
              onSourceChanged={handleSourceChanged}
              activeSourceType={activeSourceType}
              setIsPlaying={setIsPlaying}
              togglePlaybackRef={togglePlaybackRef}
              fileUrl={fileUrl}
              setFileUrl={setFileUrl}
              fileName={fileName}
              setFileName={setFileName}
              hardwareSampleRate={hardwareSampleRate}
              isFullscreen={isFullscreen}
              setIsFullscreen={setIsFullscreen}
              toggleFullscreenRef={toggleFullscreenRef}
              deck1ShowGrid={deck1ShowGrid}
              setDeck1ShowGrid={setDeck1ShowGrid}
              deck2ShowGrid={deck2ShowGrid}
              setDeck2ShowGrid={setDeck2ShowGrid}
              onlyRenderSplit={true}
            />
          </section>
        )}

        {/* Bottom Section: Side-by-side EBU LUFS Loudness Suite and Stereo Vector Scope */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch" id="core-grid">
          
          {/* EBU LUFS Loudness Meter Deck (Grounded on LHS) */}
          <section className="lg:col-span-7 flex flex-col h-full" id="meters-stage-section">
            {isLoudnessPoppedOut ? (
              <div className="w-full min-h-[224px] bg-[#121212] border border-[#4a4a4a] flex flex-col items-center justify-center p-8 text-center gap-3 select-none" id="loudness-dock-placeholder">
                <div className="h-11 w-11 bg-[#181818] border border-[#4a4a4a] flex items-center justify-center text-[#b20000]">
                  <Cpu className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-[#F2F2F2] font-sans tracking-[1.4px] uppercase">Loudness & Peak Analyzer Popped Out</h3>
                  <p className="text-[10px] text-[#858585] font-sans max-w-sm mx-auto leading-normal uppercase tracking-wider">
                    The ITU-R BS.1770-4 K-weighted loudness integration engine is actively updating in floating window mode.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsLoudnessPoppedOut(false)}
                  className="mt-2 px-3.5 py-1.5 text-[11px] uppercase font-sans font-medium tracking-[0.8px] bg-[#181818] text-[#b20000] border border-[#4a4a4a] hover:bg-[#b20000] hover:text-white transition-colors cursor-pointer"
                  id="btn-redock-loudness"
                >
                  Dock Loudness Meter
                </button>
              </div>
            ) : (
              <LoudnessMeter 
                isPlaying={isPlaying}
                targetLoudness={targetLoudness}
                setTargetLoudness={setTargetLoudness}
                onPopOut={() => setIsLoudnessPoppedOut(true)}
                activeSourceType={activeSourceType}
                fileUrl={fileUrl}
              />
            )}
          </section>

          {/* Stereo Vector Scope Lissajous Goniometer Panel (Grounded on RHS) */}
          <section className="lg:col-span-5 flex flex-col h-full lg:max-w-[480px] xl:max-w-[500px] w-full mx-auto" id="vector-stage-section">
            {isVectorPoppedOut ? (
              <div className="w-full h-full min-h-[292px] bg-[#121212] border border-[#4a4a4a] flex flex-col items-center justify-center p-6 text-center gap-2 select-none" id="vector-dock-placeholder">
                <div className="h-9 w-9 bg-[#181818] border border-[#4a4a4a] flex items-center justify-center text-[#b20000]">
                  <Compass className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-[#F2F2F2] font-sans tracking-[1.4px] uppercase">Scope Panel Popped Out</h3>
                  <p className="text-[10px] text-[#858585] font-sans max-w-[240px] mx-auto leading-normal uppercase tracking-wider">
                    The Lissajous phase goniometer & numeric correlation index meter is actively running in floating window mode.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsVectorPoppedOut(false)}
                  className="mt-2 px-3.5 py-1.5 text-[11px] uppercase font-sans font-medium tracking-[0.8px] bg-[#181818] text-[#b20000] border border-[#4a4a4a] hover:bg-[#b20000] hover:text-white transition-colors cursor-pointer"
                  id="btn-redock-vector"
                >
                  Dock Scope Panel
                </button>
              </div>
            ) : (
              <StereoVectorScope 
                isActive={isPlaying} 
                onPopOut={() => setIsVectorPoppedOut(true)}
                config={analyzerConfig}
              />
            )}
          </section>

        </div>

        {/* 3. Educational / Quick Help Section styled after guides.breach.productions */}
        <div className="mt-8 bg-[#1a1a1a] border border-[#4a4a4a] p-6 grid grid-cols-1 md:grid-cols-3 gap-6" id="documentation-deck">
          
          <div className="flex items-start gap-3.5">
            <div className="border-t-4 border-[#B20000] pt-2 min-w-[28px]">
              <span className="font-semibold text-xs text-[#F2F2F2]">01</span>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-[#F2F2F2] tracking-[1.2px] uppercase">Real-Time FFT Analyzer</h3>
              <p className="text-[12px] text-[#B8B8B8] leading-relaxed font-sans">
                Generates a fast-fourier representation of the unweighted audio stream. Choosing the <strong>Logarithmic</strong> view spreads critical acoustic octaves linearly across the screen, mimicking the human ear's psychoacoustic cochlea responses.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="border-t-4 border-[#B20000] pt-2 min-w-[28px]">
              <span className="font-semibold text-xs text-[#F2F2F2]">02</span>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-[#F2F2F2] tracking-[1.2px] uppercase">ITU BS.1770 WEIGHTS</h3>
              <p className="text-[12px] text-[#B8B8B8] leading-relaxed font-sans">
                Before evaluating energy power, we pipe the sound through acoustic <strong>K-weighting filters</strong>: Stage 1 shapes physical human head diffractions, and Stage 2 rolls off subsonic bass rumbles under 38Hz. This simulates human ear loudness responses.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="border-t-4 border-[#B20000] pt-2 min-w-[28px]">
              <span className="font-semibold text-xs text-[#F2F2F2]">03</span>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-[#F2F2F2] tracking-[1.2px] uppercase">EBU Gated Integration</h3>
              <p className="text-[12px] text-[#B8B8B8] leading-relaxed font-sans">
                To yield authentic target measurements, we implement dual-gated average levels. Values below <strong>-70 LUFS</strong> absolute silence are rejected, and only segments above the sliding relative block power are counted.
              </p>
            </div>
          </div>

        </div>

      </main>

      {/* 4. Static Brand Footer styled after guides.breach.productions */}
      <footer className="max-w-7xl w-full mx-auto px-6 sm:px-12 mt-12 mb-6 text-[11px] text-[#858585] font-sans flex flex-wrap justify-between items-center gap-4 border-t-4 border-[#B20000] pt-4 uppercase tracking-[1.2px]" id="system-footer">
        <div className="flex items-center gap-2 flex-wrap text-left" id="footer-brand-info">
          <span className="font-semibold text-[#F2F2F2] tracking-widest">BREACH.Analyzer /</span>
          <span className="text-[#858585]">PRECISION REAL-TIME AUDIO ANALYTICS WORKSTATION</span>
        </div>

        <div className="flex items-center gap-4 ml-auto" id="footer-attribution">
          <a
            href="https://breach.productions"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#F2F2F2] transition-colors duration-150"
            id="link-developed-by-breach"
          >
            BREACH.PRODUCTIONS
          </a>

          <div className="flex items-center gap-3 pl-3 border-l border-[#4a4a4a]">
            <a
              href="mailto:contact@breach.productions"
              title="Contact BREACH.PRODUCTIONS"
              aria-label="Email BREACH.PRODUCTIONS"
              className="text-[#B20000] hover:opacity-65 transition-opacity cursor-pointer"
              id="link-footer-envelope"
            >
              <Mail className="w-4 h-4 text-[#B20000]" />
            </a>

            <a
              href="https://discord.gg/sV94dsDybq"
              target="_blank"
              rel="noopener noreferrer"
              title="Join BREACH Discord"
              aria-label="Join BREACH Discord"
              className="text-[#B20000] hover:opacity-65 transition-opacity cursor-pointer"
              id="link-footer-discord"
            >
              <svg
                className="w-4 h-4 fill-[#B20000] shrink-0"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </a>
          </div>
        </div>
      </footer>

      {/* 5. Popped-out floating panels */}
      {isVisualizerPoppedOut && (
        <FloatingWindow 
          id="popout-visualizer"
          title="Spectrum Analyzer Deck"
          subtitle="Real-Time Spectral Fourier Analyzer"
          onDock={() => setIsVisualizerPoppedOut(false)}
          onReset={() => visualizerResetRef.current?.()}
          defaultWidth={880}
          defaultHeight={480}
        >
          <div className="w-full h-full p-1" id="popout-visualizer-container">
            <AnalyserCanvas 
              config={analyzerConfig}
              setConfig={setAnalyzerConfig}
              isPlaying={isPlaying}
              onSourceChanged={handleSourceChanged}
              activeSourceType={activeSourceType}
              setIsPlaying={setIsPlaying}
              togglePlaybackRef={togglePlaybackRef}
              fileUrl={fileUrl}
              setFileUrl={setFileUrl}
              fileName={fileName}
              setFileName={setFileName}
              hardwareSampleRate={hardwareSampleRate}
              isFullscreen={isFullscreen}
              setIsFullscreen={setIsFullscreen}
              toggleFullscreenRef={toggleFullscreenRef}
              isPoppedOut={true}
              resetRef={visualizerResetRef}
              deck1ShowGrid={deck1ShowGrid}
              setDeck1ShowGrid={setDeck1ShowGrid}
              deck2ShowGrid={deck2ShowGrid}
              setDeck2ShowGrid={setDeck2ShowGrid}
              hideSplitWaterfall={true}
            />
          </div>
        </FloatingWindow>
      )}

      {isLoudnessPoppedOut && (
        <FloatingWindow
          id="popout-loudness"
          title="Loudness & Peak Analyzer"
          subtitle="ITU-R BS.1770-4 / EBU R128 standards"
          onDock={() => setIsLoudnessPoppedOut(false)}
          onReset={() => audioAnalyzer.resetMetrics()}
          defaultWidth={880}
          defaultHeight={440}
        >
          <div className="w-full h-full overflow-y-auto p-6 bg-black" id="popout-loudness-container">
            <LoudnessMeter 
              isPlaying={isPlaying}
              targetLoudness={targetLoudness}
              setTargetLoudness={setTargetLoudness}
              isPoppedOut={true}
              activeSourceType={activeSourceType}
              fileUrl={fileUrl}
            />
          </div>
        </FloatingWindow>
      )}

      {isVectorPoppedOut && (
        <FloatingWindow
          id="popout-vector"
          title="Phase Correlation & Stereo Scope"
          subtitle="Lissajous Mid/Side Phase Space Vector Monitor"
          onDock={() => setIsVectorPoppedOut(false)}
          onReset={() => vectorResetRef.current?.()}
          defaultWidth={650}
          defaultHeight={336}
        >
          <div className="w-full h-full overflow-y-auto p-6 bg-black" id="popout-vector-container">
            <StereoVectorScope 
              isActive={isPlaying}
              isPoppedOut={true}
              resetRef={vectorResetRef}
              config={analyzerConfig}
            />
          </div>
        </FloatingWindow>
      )}

      {isDJWaveformPoppedOut && (
        <FloatingWindow
          id="popout-dj-waveform"
          title="DJ Multi-Band Waveform Deck"
          subtitle="High-Resolution Frequency-Layered Waveform & Beat Grid Workstation"
          onDock={() => setIsDJWaveformPoppedOut(false)}
          defaultWidth={980}
          defaultHeight={440}
        >
          <div className="w-full h-full bg-[#121212] overflow-hidden flex flex-col" id="popout-dj-waveform-container">
            <DJWaveformDeck
              onTrackAnalysis={setTrackAnalysis}
              fileUrl={fileUrl}
              fileName={fileName}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              togglePlaybackRef={togglePlaybackRef}
              isPoppedOut={true}
              onPopOut={() => setIsDJWaveformPoppedOut(false)}
              config={analyzerConfig}
            />
          </div>
        </FloatingWindow>
      )}

    </div>
  );
}
