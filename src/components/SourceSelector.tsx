/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Music, 
  Upload, 
  RotateCw, 
  Activity, 
  CheckCircle2,
  AlertTriangle,
  Monitor,
  Trash2,
  Plus,
  Play,
  Pause,
  Volume2,
  Palette,
  Sliders,
  Settings,
  SkipBack,
  SkipForward,
  Repeat,
  RefreshCw,
  Cpu,
  Zap,
  Disc,
  Waves
} from 'lucide-react';
import { AudioSourceType } from '../types';
import { audioAnalyzer, useStreamMetadata } from '../audioEngine';
import { FloatingWindow } from './FloatingWindow';
import { usePersistentState, SafeStorage } from '../utils/storage';
import { ResetButton, PopOutButton } from './SharedButtons';
import { SettingsPanel } from './SettingsPanel';
import { VisualSettingsPanel } from './VisualSettingsPanel';
import { AudioFileRegistry, fetchPartialArrayBuffer, getAudioFileSize } from '../utils';

interface PlaylistItem {
  id: string;
  name: string;
  url: string;
  isDemo?: boolean;
}

const DEFAULT_PLAYLIST: PlaylistItem[] = [];

interface SourceSelectorProps {
  onSourceChanged: (type: AudioSourceType) => void;
  activeSourceType: AudioSourceType;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  isEmbedded?: boolean;
  togglePlaybackRef: React.MutableRefObject<(() => void) | null>;
  fileUrl: string;
  setFileUrl: (url: string) => void;
  fileName: string;
  setFileName: (name: string) => void;
  showSettings?: boolean;
  onToggleSettings?: () => void;
  isDeckPoppedOut?: boolean;
  setIsDeckPoppedOut?: (popped: boolean) => void;
  isPlaylistPoppedOut?: boolean;
  setIsPlaylistPoppedOut?: (popped: boolean) => void;
  config?: any;
  setConfig?: any;
  targetLoudness?: any;
  setTargetLoudness?: any;
  deck1ShowGrid?: any;
  setDeck1ShowGrid?: any;
  deck2ShowGrid?: any;
  setDeck2ShowGrid?: any;
}

export function SourceSelector({
  onSourceChanged,
  activeSourceType,
  isPlaying,
  setIsPlaying,
  togglePlaybackRef,
  fileUrl,
  setFileUrl,
  fileName,
  setFileName,
  showSettings,
  onToggleSettings,
  isDeckPoppedOut = false,
  setIsDeckPoppedOut,
  isPlaylistPoppedOut = false,
  setIsPlaylistPoppedOut,
  config,
  setConfig,
  targetLoudness,
  setTargetLoudness,
  deck1ShowGrid,
  setDeck1ShowGrid,
  deck2ShowGrid,
  setDeck2ShowGrid
}: SourceSelectorProps) {
  const streamMetadata = useStreamMetadata();

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const [fileDuration, setFileDuration] = useState<number>(0);
  const [fileCurrentTime, setFileCurrentTime] = useState<number>(0);
  const [dragActive, setDragActive] = useState<boolean>(false);

  const [activeDropdown, setActiveDropdown] = useState<AudioSourceType | null>(null);
  const [hoveredDropdown, setHoveredDropdown] = useState<AudioSourceType | null>(null);

  const [playlist, setPlaylist] = useState<PlaylistItem[]>(() => {
    const stored = SafeStorage.get<PlaylistItem[]>('breach_music_playlist', [], (val) => Array.isArray(val));
    // Filter out any legacy demo tracks from storage
    return stored.filter(item => !item.isDemo && !item.url.startsWith('demo://') && !item.name.includes('Calibration') && !item.name.includes('Haelo') && !item.name.includes('ℋaelo'));
  });

  // Sync custom playlist items back to SafeStorage safely
  useEffect(() => {
    const customOnly = playlist.filter(item => !item.isDemo && !item.url.startsWith('demo://') && !item.url.startsWith('blob:'));
    SafeStorage.set('breach_music_playlist', customOnly);
  }, [playlist]);

  // Purge any stale demo track URLs from active selection
  useEffect(() => {
    if (fileUrl.startsWith('demo://') || fileName.includes('Calibration') || fileName.includes('Haelo') || fileName.includes('ℋaelo')) {
      setFileUrl('');
      setFileName('');
      if (audioRef.current) {
        audioRef.current.src = '';
      }
    }
  }, []);

  const [customUrl, setCustomUrl] = useState('');
  const [customName, setCustomName] = useState('');
  const [showAddUrlForm, setShowAddUrlForm] = useState(false);

  const [autoplayNext, setAutoplayNext] = usePersistentState<boolean>(
    'breach_autoplay_next',
    false,
    (val) => typeof val === 'boolean'
  );
  const [loopTrack, setLoopTrack] = usePersistentState<boolean>(
    'breach_loop_track',
    false,
    (val) => typeof val === 'boolean'
  );
  const [isWaveformDecoding, setIsWaveformDecoding] = useState<boolean>(false);
  const [isPlaybackActive, setIsPlaybackActive] = useState<boolean>(false);
  const [animatePrev, setAnimatePrev] = useState<boolean>(false);
  const [animateNext, setAnimateNext] = useState<boolean>(false);

  const handleToggleAutoplayNext = () => {
    setAutoplayNext(prev => !prev);
  };

  const handleToggleLoopTrack = () => {
    setLoopTrack(prev => !prev);
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Close active dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Sync playback state backwards if mechanical deactivations happen
  useEffect(() => {
    if (!isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaybackActive(false);
    }
  }, [isPlaying]);

  const [studioTab, setStudioTab] = useState<'file' | 'visual' | 'settings'>('file');
  const [uploadError, setUploadError] = useState<string>('');

  // Always default Studio Deck opening to "File"
  useEffect(() => {
    setStudioTab('file');
    if (showSettings && onToggleSettings) {
      onToggleSettings();
    }
  }, []);

  // Synchronize internal tab selection when showSettings has been changed externally
  useEffect(() => {
    if (showSettings) {
      setStudioTab('settings');
    }
  }, [showSettings]);

  // Handle source select (audio file tracking)
  const handleSourceSelect = async (type: AudioSourceType) => {
    audioAnalyzer.stop();
    setIsPlaying(false);
    onSourceChanged(AudioSourceType.AUDIO_FILE);
  };

  const handleTabClick = (tab: 'file' | 'visual' | 'settings') => {
    if (tab === 'settings') {
      if (showSettings && studioTab === 'settings') {
        if (onToggleSettings) onToggleSettings();
        setStudioTab('file');
      } else {
        if (!showSettings && onToggleSettings) onToggleSettings();
        setStudioTab('settings');
      }
    } else if (tab === 'visual') {
      if (showSettings && onToggleSettings) onToggleSettings();
      setStudioTab('visual');
    } else {
      if (showSettings && onToggleSettings) onToggleSettings();
      setStudioTab('file');
    }
  };

  // Reusable Studio Deck Tab strip: FILE, VISUAL (theme visual settings), SETTINGS
  const renderStudioDeckTabs = (idPrefix = '') => (
    <div className="flex items-center gap-1.5 shrink-0" id={`${idPrefix}studio-deck-tabs`}>
      {/* FILE Tab */}
      <button
        type="button"
        onClick={() => handleTabClick('file')}
        className={`flex items-center gap-1.5 px-2.5 py-1 border font-sans text-[11px] font-medium uppercase tracking-[0.8px] transition-colors duration-150 cursor-pointer ${
          studioTab === 'file'
            ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2]'
            : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2]'
        }`}
        id={`${idPrefix}tab-btn-file`}
      >
        <Music className="w-3.5 h-3.5 text-current" />
        <span>FILE</span>
      </button>

      {/* VISUAL Tab (Theme visual settings section next to settings) */}
      <button
        type="button"
        onClick={() => handleTabClick('visual')}
        className={`flex items-center gap-1.5 px-2.5 py-1 border font-sans text-[11px] font-medium uppercase tracking-[0.8px] transition-colors duration-150 cursor-pointer ${
          studioTab === 'visual'
            ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2]'
            : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2]'
        }`}
        id={`${idPrefix}tab-btn-visual`}
      >
        <Palette className="w-3.5 h-3.5 text-current" />
        <span>VISUAL</span>
      </button>

      {/* SETTINGS Tab */}
      <button
        type="button"
        onClick={() => handleTabClick('settings')}
        className={`flex items-center gap-1.5 px-2.5 py-1 border font-sans text-[11px] font-medium uppercase tracking-[0.8px] transition-colors duration-150 cursor-pointer ${
          studioTab === 'settings'
            ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2]'
            : 'bg-[#181818] border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2]'
        }`}
        id={`${idPrefix}tab-btn-settings`}
      >
        <Settings className="w-3.5 h-3.5 text-current" />
        <span>SETTINGS</span>
      </button>
    </div>
  );

  // Toggle the active state of the analyzer engine (powered ON or OFF)
  const handleToggleEngine = async () => {
    if (isPlaying) {
      // Stop the analyzer engine
      audioAnalyzer.stop();
      setIsPlaying(false);
      // Also pause playback if music is currently playing, since analyzer is stopped
      if (activeSourceType === AudioSourceType.AUDIO_FILE && audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaybackActive(false);
    } else {
      // Power on the analyzer engine
      if (activeSourceType === AudioSourceType.AUDIO_FILE) {
        if (!fileUrl) {
          // Open dropdown or select element to choose trace
          setActiveDropdown(AudioSourceType.AUDIO_FILE);
          fileInputRef.current?.click();
          return;
        }
        if (audioRef.current) {
          try {
            await audioAnalyzer.startSource(AudioSourceType.AUDIO_FILE, {
              element: audioRef.current
            });
            setIsPlaying(true);
          } catch (err) {
            console.error('Failed to start audio analyzer engine:', err);
          }
        }
      } else {
        await handleSourceSelect(activeSourceType);
      }
    }
  };

  // Toggle the music playback itself (play / pause)
  const handleToggleAudioPlayback = async () => {
    if (activeSourceType !== AudioSourceType.AUDIO_FILE) return;

    if (!fileUrl) {
      setActiveDropdown(AudioSourceType.AUDIO_FILE);
      fileInputRef.current?.click();
      return;
    }

    if (audioRef.current) {
      if (isPlaybackActive) {
        audioRef.current.pause();
      } else {
        // Automatically power on the analyzer engine if it is off
        if (!isPlaying) {
          try {
            await audioAnalyzer.startSource(AudioSourceType.AUDIO_FILE, {
              element: audioRef.current
            });
            setIsPlaying(true);
          } catch (err) {
            console.error('Failed to start audio analyzer engine for playback:', err);
          }
        }
        audioRef.current.play().catch((err) => {
          console.warn('Playback gesture error:', err);
        });
      }
    }
  };

  // Synchronize toggle playback callback to parent component reference
  useEffect(() => {
    togglePlaybackRef.current = handleToggleEngine;
    return () => {
      if (togglePlaybackRef.current === handleToggleEngine) {
        togglePlaybackRef.current = null;
      }
    };
  }, [handleToggleEngine, togglePlaybackRef]);

  // Handle playlist item clicking
  const handlePlaylistItemClick = async (item: PlaylistItem, autoPlay: boolean = false) => {
    const isCurrent = fileUrl === item.url;
    if (isCurrent && !autoPlay) {
      // Toggle play/pause if clicking currently selected track
      handleToggleAudioPlayback();
      return;
    }

    const targetUrl = item.url;

    setFileName(item.name);
    setFileUrl(targetUrl);

    if (audioRef.current) {
      audioRef.current.src = targetUrl;
      audioRef.current.load();
    }

    // Ensure we switch active source type to AUDIO_FILE
    onSourceChanged(AudioSourceType.AUDIO_FILE);
    
    // If the engine is already active, or if autoPlay is explicitly requested (like in autoplayNext)
    const shouldPlay = isPlaying || autoPlay;

    if (shouldPlay) {
      setTimeout(async () => {
        if (audioRef.current) {
          try {
            await audioAnalyzer.startSource(AudioSourceType.AUDIO_FILE, {
              element: audioRef.current
            });
            audioRef.current.play().catch((err) => {
              console.warn('Playback error (needs user gesture):', err);
            });
            setIsPlaying(true);
            setIsPlaybackActive(true);
          } catch (err) {
            console.error('Audio source load error:', err);
          }
        }
      }, 50);
    } else {
      setIsPlaybackActive(false);
    }
  };

  const playNext = () => {
    if (playlist.length === 0) return;
    const currentIndex = playlist.findIndex(track => track.url === fileUrl);
    if (currentIndex !== -1 && currentIndex < playlist.length - 1) {
      handlePlaylistItemClick(playlist[currentIndex + 1], true);
    } else {
      // Loop around to first track
      handlePlaylistItemClick(playlist[0], true);
    }
  };

  const playPrevious = () => {
    if (playlist.length === 0) return;
    const currentIndex = playlist.findIndex(track => track.url === fileUrl);
    if (currentIndex > 0) {
      handlePlaylistItemClick(playlist[currentIndex - 1], true);
    } else {
      // Loop or go to the last track
      handlePlaylistItemClick(playlist[playlist.length - 1], true);
    }
  };

  const handleRemoveTrack = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const trackToDelete = playlist.find(track => track.id === id);
    if (trackToDelete && trackToDelete.url) {
      if (trackToDelete.url.startsWith('blob:')) {
        try {
          AudioFileRegistry.revoke(trackToDelete.url);
        } catch (err) {
          console.error('Failed to revoke object URL/registry reference on track removal:', err);
        }
      }
    }

    const updated = playlist.filter(track => track.id !== id);
    setPlaylist(updated);
    
    // If the track currently playing is the one being deleted, reset
    if (trackToDelete && trackToDelete.url === fileUrl) {
      setFileUrl('');
      setFileName('');
      setIsPlaying(false);
      audioAnalyzer.stop();
    }
  };

  const handleRefreshStudioDeck = () => {
    // 1. Restart playback to 0 and play if was playing
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      if (isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }
    // 2. Force re-trigger of active source changed so audio engine synchronizes fresh
    if (onSourceChanged) {
      onSourceChanged(activeSourceType);
    }
  };

  const handleAddCustomUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;
    const name = customName.trim() || `Link ${playlist.length + 1}`;
    const newItem: PlaylistItem = {
      id: `track_${Date.now()}`,
      name: name,
      url: customUrl.trim(),
      isDemo: false
    };
    const updated = [...playlist, newItem];
    setPlaylist(updated);
    setCustomUrl('');
    setCustomName('');
    setShowAddUrlForm(false);
  };

  // Handle multiple uploaded audio files
  const processAudioFiles = (files: FileList | File[]) => {
    const newItems: PlaylistItem[] = [];
    const unsupportedFiles: string[] = [];
    const baseTime = Date.now();

    Array.from(files).forEach((file, index) => {
      if (!file.type.startsWith('audio/')) {
        unsupportedFiles.push(file.name);
        return;
      }
      const url = URL.createObjectURL(file);
      AudioFileRegistry.register(url, file);
      const trackName = file.name.replace(/\.[^/.]+$/, "");
      
      newItems.push({
        id: `track_${baseTime}_${index}_${Math.random().toString(36).substr(2, 5)}`,
        name: trackName,
        url: url,
        isDemo: false
      });
    });

    if (unsupportedFiles.length > 0) {
      setUploadError(`Unsupported format: ${unsupportedFiles.join(', ')}. Please select audio files (MP3, WAV, FLAC, M4A, OGG).`);
      setTimeout(() => setUploadError(''), 6000);
    }

    if (newItems.length > 0) {
      const updated = [...playlist, ...newItems];
      setPlaylist(updated);

      // If no file is currently selected (or playlist was empty), select the first imported track
      if (!fileUrl) {
        handlePlaylistItemClick(newItems[0]);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processAudioFiles(e.target.files);
    }
  };

  // Drag-and-drop detection
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processAudioFiles(e.dataTransfer.files);
    }
  };

  // Audio timeline ticks
  const onTimeUpdate = () => {
    if (audioRef.current) {
      setFileCurrentTime(audioRef.current.currentTime);
    }
  };

  const onLoadedMetadata = async () => {
    if (!audioRef.current) return;
    const dur = audioRef.current.duration;
    setFileDuration(dur);

    const currentUrl = fileUrl || audioRef.current.src;
    if (!currentUrl) return;

    // Detect estimated properties first as immediate fallback
    let estSampleRate = 44100;
    let estBitrate = 320;
    let estCodec = 'MPEG Layer-3 (MP3)';
    const nameLower = fileName.toLowerCase();

    if (nameLower.endsWith('.wav')) {
      estCodec = 'Linear PCM (WAV)';
      estSampleRate = 44100;
      estBitrate = 1411;
    } else if (nameLower.endsWith('.flac')) {
      estCodec = 'FLAC Audio (Lossless)';
      estSampleRate = 44100;
      estBitrate = 700;
    } else if (nameLower.endsWith('.m4a') || nameLower.endsWith('.aac') || nameLower.endsWith('.mp4')) {
      estCodec = 'AAC Audio (M4A)';
      estSampleRate = 44100;
      estBitrate = 256;
    } else if (nameLower.endsWith('.ogg')) {
      estCodec = 'Ogg Vorbis (OGG)';
      estSampleRate = 44100;
      estBitrate = 192;
    }

    // Set immediate estimation so UI doesn't look empty or unpopulated
    audioAnalyzer.updateMetadata({
      sampleRate: estSampleRate,
      bitrate: estBitrate,
      codec: estCodec,
      bufferSize: 2048
    });

    // Try to perform a true background fetch and decode to retrieve exact file metrics using optimized chunk fetches
    try {
      const arrayBuffer = await fetchPartialArrayBuffer(currentUrl, 3 * 1024 * 1024);
      const ctx = audioAnalyzer.getContext() || audioAnalyzer.initContext();
      // Decode the 3MB chunk directly (sliced inside the fetcher or read progressively)
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);

      const actualSampleRate = decodedBuffer.sampleRate;
      const actualDuration = audioRef.current.duration || decodedBuffer.duration || 1;
      
      const fileSize = await getAudioFileSize(currentUrl, AudioFileRegistry.get(currentUrl));
      // Calculate true encoded bitrate using direct file size
      const actualBitrate = Math.round((fileSize * 8 / actualDuration) / 1000);

      // Determine codec based on registered file name/type or URL estimation
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

      audioAnalyzer.updateMetadata({
        sampleRate: actualSampleRate,
        bitrate: actualBitrate > 0 ? actualBitrate : estBitrate,
        codec: actualCodec,
        bufferSize: 2048
      });
    } catch (e) {
      console.warn('Real-time meta decoding failed, proceeding with estimation:', e);
    }
  };

  const handleTimelineScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setFileCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };



  const renderPlaylistQueueBodyContents = () => {
    // Renders the Playlist Queue content (perfectly useful for both standard RHS pane and floating window!)
    return (
      <div className="flex-grow flex flex-col min-h-0 bg-[#1a1a1a] p-4 h-full" id="playlist-queue-body-inner">
        {/* Add Custom URL Link Form */}
        {showAddUrlForm && (
          <form onSubmit={handleAddCustomUrl} className="mb-3 bg-[#181818] border border-[#4a4a4a] p-3 flex flex-col gap-2 animate-slide-down">
            <span className="text-[11px] font-sans text-[#B8B8B8] uppercase font-semibold tracking-[1px]">Add Custom Track Stream Link</span>
            <input
              type="text"
              placeholder="Track Name (e.g. Bass Station)"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="bg-[#121212] border border-[#4a4a4a] focus:border-[#888888] px-2.5 py-1.5 text-[11px] text-[#F2F2F2] focus:outline-none"
              maxLength={32}
            />
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="Stream URL (e.g. https://.../stream.mp3)"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                className="flex-grow bg-[#121212] border border-[#4a4a4a] focus:border-[#888888] px-2.5 py-1.5 text-[11px] text-[#F2F2F2] focus:outline-none font-mono"
                required
              />
              <button
                type="submit"
                className="bg-[#b20000] hover:opacity-90 text-[#F2F2F2] font-sans text-[11px] uppercase tracking-[0.8px] px-3 py-1.5 font-medium cursor-pointer transition-opacity"
              >
                Add
              </button>
            </div>
          </form>
        )}

        {uploadError && (
          <div className="bg-[#b20000]/20 border-b border-[#b20000] px-3 py-2 text-[11px] font-sans font-semibold text-[#ff6666] flex items-center justify-between gap-2 shrink-0 select-none" id="playlist-upload-error-banner">
            <div className="flex items-center gap-1.5 truncate">
              <AlertTriangle className="w-3.5 h-3.5 text-[#ff6666] shrink-0" />
              <span className="truncate">{uploadError}</span>
            </div>
            <button
              type="button"
              onClick={() => setUploadError('')}
              className="text-[#B8B8B8] hover:text-[#F2F2F2] cursor-pointer px-1 text-[11px] font-mono shrink-0"
              title="Dismiss warning"
            >
              ✕
            </button>
          </div>
        )}

        {/* Playlist Scroll Container */}
        <div className="flex-grow overflow-y-auto flex flex-col pr-0.5 border-t border-[#4a4a4a]" id="playlist-list-scroll">
          {playlist.map((track) => {
            const isCurrent = fileUrl === track.url;
            
            // Track badge fallback
            let fileBadge = 'AAC AUDIO (M4A) 48K';
            if (track.url) {
              const urlLower = track.url.toLowerCase();
              if (urlLower.endsWith('.wav')) {
                fileBadge = 'LINEAR PCM (WAV) 48K';
              } else if (urlLower.endsWith('.flac')) {
                fileBadge = 'FLAC (LOSSLESS) 48K';
              } else if (urlLower.endsWith('.ogg')) {
                fileBadge = 'OGG VORBIS 48K';
              } else if (urlLower.endsWith('.mp3')) {
                fileBadge = 'MPEG AUDIO (MP3) 48K';
              } else if (urlLower.endsWith('.m4a') || urlLower.endsWith('.aac')) {
                fileBadge = 'AAC AUDIO (M4A) 48K';
              }
            }
            if (isCurrent && streamMetadata && streamMetadata.sampleRate > 0) {
              const formatType = streamMetadata.codec ? streamMetadata.codec.toUpperCase() : 'AUDIO';
              fileBadge = `${formatType} ${(streamMetadata.sampleRate / 1000).toFixed(0)}K`;
            }

            return (
              <div
                key={track.id}
                onClick={() => handlePlaylistItemClick(track)}
                className={`flex items-center justify-between p-2.5 border-b border-[#4a4a4a] text-left cursor-pointer transition-colors duration-150 group shrink-0 ${
                  isCurrent 
                    ? 'bg-[#191919] border-l-4 border-l-[#b20000]' 
                    : 'bg-transparent hover:bg-[#191919] text-[#B8B8B8] hover:text-[#F2F2F2]'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate pr-2 flex-grow">
                  {isCurrent && isPlaybackActive ? (
                    <Activity className="w-3.5 h-3.5 text-[#b20000] shrink-0" />
                  ) : (
                    <Volume2 className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-[#b20000]' : 'text-[#858585]'}`} />
                  )}
                  
                  {/* Name of Track */}
                  <span className="text-[12px] font-sans font-semibold truncate leading-tight flex-grow text-[#F2F2F2]">
                    {track.name}
                  </span>

                  {/* Codec/Sample Rate badge */}
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 leading-none shrink-0 font-medium uppercase tracking-tight border ${
                    isCurrent 
                      ? 'text-[#F2F2F2] bg-[#b20000] border-[#b20000]' 
                      : 'text-[#B8B8B8] bg-[#121212] border-[#4a4a4a]'
                  }`}>
                    {fileBadge}
                  </span>
                </div>
                
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => handleRemoveTrack(track.id, e)}
                    className="text-[#858585] hover:text-[#b20000] p-1 transition-colors cursor-pointer"
                    title="Delete track"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {playlist.length === 0 && (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={`flex-grow flex flex-col items-center justify-center border border-dashed border-[#4a4a4a] hover:border-[#888888] py-12 px-6 text-center m-3 transition-colors cursor-pointer select-none ${
                dragActive 
                  ? 'bg-[#191919] text-[#F2F2F2] border-[#b20000]' 
                  : 'bg-[#181818] text-[#B8B8B8] hover:bg-[#191919]'
              }`} 
              id="empty-drag-drop-zone"
            >
              <Upload className={`w-8 h-8 mb-3 transition-colors ${dragActive ? 'text-[#b20000]' : 'text-[#858585]'}`} />
              <p className="text-[12px] font-sans uppercase font-semibold tracking-[1.2px] mb-1 text-[#F2F2F2]">
                DRAG & DROP AUDIO HERE
              </p>
              <p className="text-[11px] font-sans text-[#b20000] font-semibold tracking-[1px] mb-1 uppercase">
                or click to browse local files
              </p>
              <p className="text-[10px] font-mono text-[#858585] leading-normal">
                Supports MP3, WAV, FLAC, M4A, OGG
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderStudioDeckBodyContents = () => {
    return (
      <div className="flex-grow flex flex-col min-h-0 p-4 bg-[#1a1a1a] gap-3 h-full overflow-y-auto" id="studio-deck-body">
        {/* Source subcontent container */}
        <div className="flex-grow min-h-0 text-left overflow-y-auto" id="studio-deck-subcontent">
          {/* FILE Tab Active */}
          {studioTab === 'file' && (
            <div className="flex flex-col h-full justify-between gap-3" id="file-tab-pane">
              {/* Track Info Hero Card */}
              <div className="flex items-center gap-4 bg-[#181818] border border-[#4a4a4a] p-3" id="active-track-hero-row">
                <div className="p-2.5 bg-[#121212] border border-[#4a4a4a] text-[#b20000] flex items-center justify-center w-12 h-12 shrink-0">
                  <Music className="w-6 h-6 text-[#b20000]" />
                </div>
                <div className="min-w-0 flex-grow text-left">
                  {fileName && (
                    <p className="text-[10px] uppercase font-sans text-[#b20000] font-semibold tracking-[1px] mb-0.5">
                      CURRENT FILE LOADED
                    </p>
                  )}
                  <p className="text-[13px] font-sans font-semibold text-[#F2F2F2] truncate tracking-tight leading-tight" title={fileName || 'No Ref Track Active'}>
                    {fileName || 'No track selected'}
                  </p>
                  {fileName ? (
                    <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-1 text-[10px] font-mono text-[#858585]">
                      {/* Sample Rate */}
                      <div className="flex items-center gap-1">
                        <Cpu className="w-3 h-3 text-[#858585] shrink-0" />
                        <span className="font-medium text-[#858585]">Rate:</span>
                        <span className="text-[#F2F2F2] font-semibold">{streamMetadata && streamMetadata.sampleRate > 0 ? (streamMetadata.sampleRate / 1000).toFixed(1) + ' kHz' : '44.1 kHz'}</span>
                      </div>
                      {/* Bitrate */}
                      <div className="flex items-center gap-1">
                        <Sliders className="w-3 h-3 text-[#858585] shrink-0" />
                        <span className="font-medium text-[#858585]">Specs:</span>
                        <span className="text-[#F2F2F2] font-semibold">
                          {streamMetadata && streamMetadata.bitrate > 0 
                            ? (streamMetadata.bitrate / 1000).toFixed(0) + ' kbps' 
                            : 'Est. Premium VBR'} 
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Activity className="w-3 h-3 text-[#858585] shrink-0" />
                        <span className="font-medium text-[#858585]">Codec:</span>
                        <span className="text-[#F2F2F2] font-semibold">{streamMetadata && streamMetadata.codec ? streamMetadata.codec.toUpperCase() : 'MPEG-3'}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] font-sans text-[#858585] leading-normal mt-1">
                      Load standard linear format WAV PCM, FLAC Lossless, or encoded VBR MP3 calibration references.
                    </p>
                  )}
                </div>
              </div>

              {/* Deck 1 Main Reference Player Controls */}
              {fileName && (
                <div 
                  className="flex flex-col gap-2.5 bg-[#181818] border border-[#4a4a4a] p-3" 
                  style={{ height: '130px' }}
                  id="deck-1-media-controls"
                >
                  {/* Progress bar timeline slider */}
                  <div className="flex items-center gap-3 w-full" id="deck-timeline-slider-row">
                    <span className="text-[11px] font-mono text-[#B8B8B8] w-9 select-none tracking-tighter shrink-0">{formatTime(fileCurrentTime)}</span>
                    <input
                      id="timeline-progress-scrubber"
                      type="range"
                      min="0"
                      max={fileDuration || 100}
                      value={fileCurrentTime}
                      step="0.05"
                      onChange={handleTimelineScrub}
                      className="flex-grow h-1 accent-[#b20000] bg-[#121212] cursor-pointer outline-none"
                    />
                    <span className="text-[11px] font-mono text-[#B8B8B8] w-9 select-none tracking-tighter shrink-0">{formatTime(fileDuration)}</span>
                  </div>

                  {/* Playlist Queue Controller Strip */}
                  <div className="grid grid-cols-3 items-center w-full" id="playlist-queue-controller-strip">
                    {/* Left: stacked Loop and Autoplay toggles */}
                    <div 
                      className="flex flex-col gap-1.5 items-start shrink-0 select-none" 
                      style={{ marginTop: '8px' }}
                      id="playlist-left-toggles"
                    >
                      <button
                        type="button"
                        id="btn-toggle-loop"
                        onClick={() => {
                          setLoopTrack(!loopTrack);
                        }}
                        className={`w-[110px] h-6 flex items-center justify-center p-0 text-center border font-sans text-[10px] font-medium uppercase tracking-[0.8px] cursor-pointer transition-colors duration-150 shrink-0 ${
                          loopTrack
                            ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2]'
                            : 'bg-[#121212] border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2]'
                        }`}
                        title="Loop the currently active/playing reference track indefinitely"
                      >
                        LOOP: {loopTrack ? 'ON' : 'OFF'}
                      </button>
                      <button
                        type="button"
                        id="btn-toggle-autoplay"
                        onClick={() => {
                          setAutoplayNext(!autoplayNext);
                        }}
                        className={`w-[110px] h-6 flex items-center justify-center p-0 text-center border font-sans text-[10px] font-medium uppercase tracking-[0.8px] cursor-pointer transition-colors duration-150 shrink-0 ${
                          autoplayNext
                            ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2]'
                            : 'bg-[#121212] border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2]'
                        }`}
                        title="Automatically step and advance to play the subsequent track upon completion"
                      >
                        AUTOPLAY: {autoplayNext ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    {/* Middle: Centered Media button cluster */}
                    <div 
                      className="flex items-center gap-3 shrink-0 justify-center w-full" 
                      style={{ marginTop: '2px' }}
                      id="playlist-center-controls"
                    >
                      {/* Prev Track */}
                      <button
                        type="button"
                        id="btn-prev-track"
                        onClick={() => {
                          const currentIndex = playlist.findIndex(track => track.url === fileUrl);
                          if (currentIndex > 0) {
                            handlePlaylistItemClick(playlist[currentIndex - 1], isPlaying);
                          }
                          setAnimatePrev(true);
                          setTimeout(() => setAnimatePrev(false), 200);
                        }}
                        disabled={playlist.length <= 1 || playlist.findIndex(track => track.url === fileUrl) <= 0}
                        className="w-[34px] h-[34px] flex items-center justify-center border border-[#4a4a4a] bg-[#121212] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] transition-colors duration-150 shrink-0 p-0 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                        title="Back to previous track"
                      >
                        <SkipBack className="w-3.5 h-3.5 fill-current" />
                      </button>

                      {/* Play / pause */}
                      <button
                        type="button"
                        id="btn-play-pause"
                        onClick={() => {
                          if (togglePlaybackRef.current) {
                            togglePlaybackRef.current();
                          } else {
                            setIsPlaying(!isPlaying);
                          }
                        }}
                        className={`w-[46px] h-[46px] flex items-center justify-center shrink-0 transition-all select-none cursor-pointer duration-150 p-0 border ${
                          isPlaying
                            ? 'bg-[#b20000] border-[#b20000] text-[#F2F2F2] hover:opacity-90'
                            : 'bg-[#121212] border-2 border-[#b20000] text-[#b20000] hover:bg-[#b20000] hover:text-[#F2F2F2]'
                        }`}
                        title={isPlaying ? "Instantly pause reference file monitoring" : "Resume reference file monitoring"}
                      >
                        {isPlaying ? (
                          <Pause className="w-5 h-5 fill-white text-white" />
                        ) : (
                          <Play className="w-5 h-5 fill-current text-current translate-x-[1px]" />
                        )}
                      </button>

                      {/* Next Track */}
                      <button
                        type="button"
                        id="btn-next-track"
                        onClick={() => {
                          const currentIndex = playlist.findIndex(track => track.url === fileUrl);
                          if (currentIndex !== -1 && currentIndex < playlist.length - 1) {
                            handlePlaylistItemClick(playlist[currentIndex + 1], isPlaying);
                          }
                          setAnimateNext(true);
                          setTimeout(() => setAnimateNext(false), 200);
                        }}
                        disabled={playlist.length <= 1 || playlist.findIndex(track => track.url === fileUrl) === -1 || playlist.findIndex(track => track.url === fileUrl) === playlist.length - 1}
                        className="w-[34px] h-[34px] flex items-center justify-center border border-[#4a4a4a] bg-[#121212] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] transition-colors duration-150 shrink-0 p-0 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                        title="Skip forward to subsequent track"
                      >
                        <SkipForward className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VISUAL Tab Active - Theme visual settings moved here */}
          {studioTab === 'visual' && config && (
            <div className="animate-fade-in py-1 h-full flex flex-col min-h-0" id="visual-tab-pane">
              <div className="overflow-y-auto max-h-[260px] pr-1" id="visual-scroller">
                <VisualSettingsPanel
                  config={config}
                  setConfig={setConfig}
                  deck1ShowGrid={deck1ShowGrid}
                  setDeck1ShowGrid={setDeck1ShowGrid}
                  deck2ShowGrid={deck2ShowGrid}
                  setDeck2ShowGrid={setDeck2ShowGrid}
                />
              </div>
            </div>
          )}

          {/* SETTINGS Tab Active */}
          {studioTab === 'settings' && config && (
            <div className="animate-fade-in py-1 h-full flex flex-col min-h-0" id="settings-tab-pane">
              <div className="overflow-y-auto max-h-[220px] pr-1" id="settings-scroller">
                <SettingsPanel 
                  config={config}
                  setConfig={setConfig}
                  targetLoudness={targetLoudness}
                  setTargetLoudness={setTargetLoudness}
                  deck1ShowGrid={deck1ShowGrid}
                  setDeck1ShowGrid={setDeck1ShowGrid}
                  deck2ShowGrid={deck2ShowGrid}
                  setDeck2ShowGrid={setDeck2ShowGrid}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSourceSelectorMain = () => {
    // Formats reference badge code
    let formatBadge = 'NO REF ACTIVE';
    if (fileName) {
      if (streamMetadata && streamMetadata.sampleRate > 0) {
        const srStr = (streamMetadata.sampleRate / 1000).toFixed(1) + 'K';
        const codecStr = streamMetadata.codec ? streamMetadata.codec.toUpperCase() : 'AUDIO';
        formatBadge = `${codecStr} ${srStr}`;
      } else {
        const nameLower = fileName.toLowerCase();
        if (nameLower.endsWith('.wav')) {
          formatBadge = 'LINEAR PCM (WAV) 44.1K';
        } else if (nameLower.endsWith('.flac')) {
          formatBadge = 'FLAC LOSSLESS 44.1K';
        } else if (nameLower.endsWith('.m4a') || nameLower.endsWith('.aac') || nameLower.endsWith('.mp4')) {
          formatBadge = 'AAC AUDIO (M4A) 44.1K';
        } else if (nameLower.endsWith('.ogg')) {
          formatBadge = 'OGG VORBIS 44.1K';
        } else {
          formatBadge = 'MPEG AUDIO (MP3) 44.1K';
        }
      }
    }
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full items-stretch animate-fade-in" id="audio-deck-layouts-wrapper">
        {/* LHS Studio Deck Section (7 out of 12 columns wide) */}
        <div className="lg:col-span-7 flex flex-col bg-[#1a1a1a] border border-[#4a4a4a] text-left overflow-hidden lg:h-[350px] h-auto min-h-[350px]" id="studio-deck">
          {/* Studio Deck Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between p-3 bg-[#121212] border-b border-[#4a4a4a] z-10 gap-3 shrink-0" id="studio-deck-header">
            <div className="flex items-center gap-2.5">
              <div className="bg-[#181818] border border-[#4a4a4a] flex items-center justify-center overflow-hidden w-6 h-6 p-0.5">
                <img src="/breach_logo.png" alt="Studio Deck" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              </div>
              <h3 className="text-xs font-semibold tracking-[1.4px] text-[#F2F2F2] font-sans uppercase">
                Studio Deck
              </h3>
            </div>
            {/* Unified Studio Deck Tabs in Header */}
            <div className="flex items-center gap-2.5 shrink-0" id="header-signal-settings-tabs-with-control">
              {renderStudioDeckTabs('header-')}

              {/* Separator / Divider */}
              <div className="h-4 w-px bg-[#4a4a4a] shrink-0" />

              {/* Studio Deck Refresh/Reset control */}
              <ResetButton
                onClick={handleRefreshStudioDeck}
                title="Refresh Studio Deck: Restart playback or generator and reset to defaults"
                id="btn-refresh-studio-deck"
              />

              {/* Popout / Dock control */}
              {isDeckPoppedOut ? (
                <button
                  type="button"
                  onClick={() => setIsDeckPoppedOut?.(false)}
                  className="px-2.5 h-[28px] bg-[#181818] border border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] font-sans text-[11px] font-medium uppercase tracking-[0.8px] cursor-pointer flex items-center justify-center transition-colors duration-150"
                  id="btn-dock-quick-deck"
                >
                  DOCK
                </button>
              ) : (
                setIsDeckPoppedOut && (
                  <PopOutButton
                    onClick={() => setIsDeckPoppedOut(true)}
                    title="Pop out studio deck workspace"
                    id="btn-popout-studio-deck"
                  />
                )
              )}
            </div>
          </div>
          {/* Studio Deck Body */}
          <div className="flex-grow flex flex-col min-h-0 select-none">
            {isDeckPoppedOut ? (
              <div className="flex-grow flex flex-col items-center justify-center p-6 text-center gap-4 select-none bg-[#121212]" id="deck-dock-placeholder">
                <div className="h-10 w-10 bg-[#181818] border border-[#4a4a4a] flex items-center justify-center p-1.5 overflow-hidden">
                  <img src="/breach_logo.png" alt="Studio Deck" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                </div>
                <div className="space-y-1 max-w-xs">
                  <h3 className="text-[11px] font-semibold text-[#F2F2F2] font-sans tracking-[1.2px] uppercase">Studio Deck Popped Out</h3>
                  <p className="text-[10px] text-[#858585] font-sans leading-normal">
                    The audio source selector, signal generator, and calibration suite is active in a floating window.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDeckPoppedOut(false)}
                  className="px-3 py-1.5 text-[11px] uppercase font-sans font-medium tracking-[0.8px] bg-[#181818] text-[#b20000] border border-[#4a4a4a] hover:bg-[#b20000] hover:text-white transition-colors cursor-pointer"
                  id="btn-redock-deck"
                >
                  Dock Studio Deck
                </button>
              </div>
            ) : (
              renderStudioDeckBodyContents()
            )}
          </div>
        </div>

        {/* RHS Playlist Queue Card (5 out of 12 columns wide) */}
        <div 
          className="lg:col-span-5 flex flex-col bg-[#1a1a1a] border border-[#4a4a4a] text-left overflow-hidden lg:h-[350px] h-auto min-h-[350px] relative" 
          id="playlist-queue"
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
        >
          {/* Playlist Queue Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between p-3 bg-[#121212] border-b border-[#4a4a4a] z-10 gap-3 shrink-0" id="playlist-queue-header">
            <div className="flex items-center gap-2.5">
              <div className="bg-[#181818] border border-[#4a4a4a] flex items-center justify-center overflow-hidden w-6 h-6 p-0.5">
                <img src="/breach_logo.png" alt="Playlist" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              </div>
              <h3 className="text-xs font-semibold tracking-[1.4px] text-[#F2F2F2] font-sans uppercase">
                Playlist Queue
              </h3>
            </div>

            {/* Actions: + ADD FILE, + ADD LINK, Refresh/Wipe, Popout/Dock */}
            <div className="flex items-center gap-2 shrink-0 ml-auto" id="playlist-header-actions">
              {!isPlaylistPoppedOut && (
                <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center h-[28px] px-2.5 border border-[#4a4a4a] bg-[#181818] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] font-sans text-[11px] font-medium uppercase transition-colors duration-150 cursor-pointer tracking-[0.8px]"
                    title="Upload local files"
                    id="btn-add-file"
                  >
                    ADD FILE
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddUrlForm(!showAddUrlForm)}
                    className="flex items-center justify-center h-[28px] px-2.5 border border-[#4a4a4a] bg-[#181818] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] font-sans text-[11px] font-medium uppercase transition-colors duration-150 cursor-pointer tracking-[0.8px]"
                    title="Add track link"
                    id="btn-add-link"
                  >
                    ADD LINK
                  </button>

                  {/* Wipe Queue */}
                  <button
                    type="button"
                    onClick={() => {
                      playlist.forEach((track) => {
                        if (track.url && track.url.startsWith('blob:')) {
                          try {
                            AudioFileRegistry.revoke(track.url);
                          } catch (err) {
                            console.error('Failed to revoke object URL/registry reference on playlist wipe:', err);
                          }
                        }
                      });
                      setPlaylist([]);
                      setFileUrl('');
                      setFileName('');
                      setIsPlaying(false);
                      audioAnalyzer.stop();
                    }}
                    className="border border-[#4a4a4a] bg-[#181818] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] transition-colors duration-150 flex items-center justify-center cursor-pointer flex-shrink-0 h-[28px] w-[28px]"
                    title="Clear Playlist Queue"
                    id="btn-wipe-playlist"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                </>
              )}

              {/* Popout / Dock Trigger */}
              {isPlaylistPoppedOut ? (
                <button
                  type="button"
                  onClick={() => setIsPlaylistPoppedOut?.(false)}
                  className="px-2.5 h-[28px] bg-[#181818] border border-[#4a4a4a] text-[#B8B8B8] hover:bg-[#F2F2F2] hover:text-[#111111] hover:border-[#F2F2F2] font-sans text-[11px] font-medium uppercase tracking-[0.8px] cursor-pointer flex items-center justify-center transition-colors duration-150"
                  id="btn-dock-quick"
                >
                  DOCK
                </button>
              ) : (
                setIsPlaylistPoppedOut && (
                  <PopOutButton
                    id="btn-popout-playlist-queue"
                    onClick={() => setIsPlaylistPoppedOut(true)}
                    title="Pop out playlist queue workspace"
                  />
                )
              )}
            </div>
          </div>

          {/* Playlist Queue Body */}
          <div className="flex-grow flex flex-col min-h-0 select-none">
            {isPlaylistPoppedOut ? (
              <div className="flex-grow flex flex-col items-center justify-center p-6 text-center gap-4 select-none bg-[#121212]" id="playlist-dock-placeholder">
                <div className="h-10 w-10 bg-[#181818] border border-[#4a4a4a] flex items-center justify-center p-1.5 overflow-hidden">
                  <img src="/breach_logo.png" alt="Playlist" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                </div>
                <div className="space-y-1 max-w-xs">
                  <h3 className="text-[11px] font-semibold text-[#F2F2F2] font-sans tracking-[1.2px] uppercase">Playlist Popped Out</h3>
                  <p className="text-[10px] text-[#858585] font-sans leading-normal">
                    The playlist queue container has been popped out to an independent floating manager window.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPlaylistPoppedOut(false)}
                  className="px-3 py-1.5 text-[11px] uppercase font-sans font-medium tracking-[0.8px] bg-[#181818] text-[#b20000] border border-[#4a4a4a] hover:bg-[#b20000] hover:text-white transition-colors cursor-pointer"
                  id="btn-redock-playlist"
                >
                  Dock Playlist
                </button>
              </div>
            ) : (
              renderPlaylistQueueBodyContents()
            )}
          </div>
        </div>

        {/* Hidden Inputs */}
        <input 
          id="input-audio-picker"
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full relative" id="audio-source-manager" ref={containerRef}>
      {/* HTML Hidden Local Audio Node */}
      <audio 
        ref={audioRef}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={() => setIsPlaybackActive(true)}
        onPause={() => setIsPlaybackActive(false)}
        onEnded={() => {
          if (loopTrack) {
            if (audioRef.current) {
              audioRef.current.currentTime = 0;
              audioRef.current.play().catch(() => {});
            }
          } else if (autoplayNext) {
            const currentIndex = playlist.findIndex(track => track.url === fileUrl);
            if (currentIndex !== -1 && currentIndex < playlist.length - 1) {
              const nextTrack = playlist[currentIndex + 1];
              handlePlaylistItemClick(nextTrack, true);
            } else {
              setIsPlaying(false);
              setIsPlaybackActive(false);
            }
          } else {
            setIsPlaying(false);
            setIsPlaybackActive(false);
          }
        }}
        className="hidden"
      />

      {renderSourceSelectorMain()}

      {isDeckPoppedOut && (
        <FloatingWindow
          id="popout-deck"
          title="Studio Deck Workspace"
          subtitle="Live Audio Track Manager, Playlist & File Calibration Suite"
          onDock={() => setIsDeckPoppedOut?.(false)}
          defaultWidth={730}
          defaultHeight={330}
        >
          <div className="w-full h-full bg-[#1a1a1a] flex flex-col min-h-0" id="popout-deck-container">
            {/* Popout Studio Deck Toolbar with full tabs + Reset */}
            <div className="flex items-center justify-between px-3 py-2 bg-[#121212] border-b border-[#4a4a4a] shrink-0 gap-3" id="popout-deck-toolbar">
              <div className="flex items-center gap-1.5 overflow-x-auto flex-grow">
                {renderStudioDeckTabs('popout-')}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ResetButton
                  onClick={handleRefreshStudioDeck}
                  title="Refresh Studio Deck: Restart playback and reset to defaults"
                  id="btn-popout-refresh-studio-deck"
                />
              </div>
            </div>
            {renderStudioDeckBodyContents()}
          </div>
        </FloatingWindow>
      )}

      {isPlaylistPoppedOut && (
        <FloatingWindow
          id="popout-playlist"
          title="Playlist Queue Workspace"
          subtitle="Music Lab File & Playlist Stream Queue"
          onDock={() => setIsPlaylistPoppedOut?.(false)}
          defaultWidth={550}
          defaultHeight={350}
        >
          <div className="w-full h-full bg-black flex flex-col min-h-0" id="popout-playlist-container">
            {renderPlaylistQueueBodyContents()}
          </div>
        </FloatingWindow>
      )}
    </div>
  );
}
