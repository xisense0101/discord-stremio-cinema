'use client';

import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Square,
  Volume2,
  Tv,
  MessageSquare,
  Sliders,
  Check,
  Clock,
  Sparkles,
  Headphones,
  Radio,
} from 'lucide-react';

interface PlayerRemoteProps {
  state: any;
  onControl: (action: string, payload?: any) => Promise<void>;
  loading: boolean;
}

export const PlayerRemote: React.FC<PlayerRemoteProps> = ({ state, onControl, loading }) => {
  const [seekingTime, setSeekingTime] = useState<number | null>(null);

  if (!state || state.status === 'IDLE') {
    return (
      <div className="glass-panel rounded-3xl p-8 text-center border border-white/10 flex flex-col items-center justify-center min-h-[340px] shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-gray-500 shadow-inner">
          <Tv className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-white mb-1">No Active Media Playing</h3>
        <p className="text-xs text-gray-400 max-w-sm mb-6">
          Search for a movie below or use the Smart Binge Picker to start streaming in Discord.
        </p>
      </div>
    );
  }

  const isPlaying = state.status === 'PLAYING';
  const currentTime = seekingTime !== null ? seekingTime : state.currentTime || 0;
  const duration = state.duration || 7200;
  const progressPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSeekingTime(Number(e.target.value));
  };

  const handleSeekCommit = async () => {
    if (seekingTime !== null) {
      await onControl('SEEK', { seconds: seekingTime });
      setSeekingTime(null);
    }
  };

  const qualityOptions = [
    { label: '4K UHD', value: '4k', desc: '3840x2160 • 12 Mbps' },
    { label: '2K QHD', value: '2k', desc: '2560x1440 • 8 Mbps' },
    { label: '1080p FHD', value: '1080p', desc: '1920x1080 • 5 Mbps' },
    { label: '720p HD', value: '720p', desc: '1280x720 • 2.5 Mbps' },
    { label: '480p SD', value: '480p', desc: '854x480 • 1.2 Mbps' },
  ];

  const currentQualityNorm = (state.resolution || '1080p').toLowerCase();
  const audioTracks = state.audioTracks || [];

  return (
    <div className="glass-panel-glow rounded-3xl p-6 lg:p-7 border border-white/15 relative overflow-hidden shadow-2xl space-y-6">
      {/* Ambient background glow */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Title & Status Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase font-semibold tracking-wider text-indigo-400 bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              {state.status}
            </span>
            <span className="text-xs text-gray-400 font-mono">
              FPS: {state.fps || 30} • {state.resolution || '1080p FHD'}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white mt-1.5 line-clamp-1">{state.title || 'Playing Stream'}</h2>
        </div>

        {/* Quick Stop Button */}
        <button
          onClick={() => onControl('STOP')}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 shadow-md shadow-rose-950/40"
        >
          <Square className="w-3.5 h-3.5" />
          <span>Stop Stream</span>
        </button>
      </div>

      {/* Scrubbing Timeline & Clock */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
          <span className="text-white font-semibold">{formatTime(currentTime)}</span>
          <span className="text-gray-500">{formatTime(duration)}</span>
        </div>

        <div className="relative group">
          <input
            type="range"
            min={0}
            max={duration}
            value={currentTime}
            onChange={handleSeekChange}
            onMouseUp={handleSeekCommit}
            onTouchEnd={handleSeekCommit}
            className="w-full h-2.5 bg-gray-800/80 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all shadow-inner"
            style={{
              background: `linear-gradient(to right, #6366f1 ${progressPercent}%, #1f2937 ${progressPercent}%)`,
            }}
          />
        </div>
      </div>

      {/* Main Transport Control Buttons */}
      <div className="flex items-center justify-center gap-4 py-2">
        <button
          onClick={() => onControl('REWIND', { seconds: 10 })}
          disabled={loading}
          className="w-12 h-12 rounded-2xl glass-panel hover:bg-white/10 flex items-center justify-center text-gray-300 hover:text-white transition-all active:scale-90 shadow-md"
          title="Rewind 10 seconds"
        >
          <RotateCcw className="w-5 h-5" />
        </button>

        <button
          onClick={() => onControl(isPlaying ? 'PAUSE' : 'RESUME')}
          disabled={loading}
          className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-xl shadow-indigo-500/35 flex items-center justify-center transition-all active:scale-95"
        >
          {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-0.5" />}
        </button>

        <button
          onClick={() => onControl('FORWARD', { seconds: 10 })}
          disabled={loading}
          className="w-12 h-12 rounded-2xl glass-panel hover:bg-white/10 flex items-center justify-center text-gray-300 hover:text-white transition-all active:scale-90 shadow-md"
          title="Forward 10 seconds"
        >
          <RotateCw className="w-5 h-5" />
        </button>
      </div>

      {/* SECTION 1: Stream Quality Switcher */}
      <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-300">
          <Tv className="w-4 h-4 text-indigo-400" />
          <span>Stream Resolution</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {qualityOptions.map((q) => {
            const active = currentQualityNorm.includes(q.value);
            return (
              <button
                key={q.value}
                onClick={() => onControl('SET_QUALITY', { quality: q.value })}
                disabled={loading}
                className={`py-2 px-1 rounded-xl text-center text-xs font-semibold transition-all ${
                  active
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-bold shadow-lg shadow-indigo-600/30 border border-indigo-400/30'
                    : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5'
                }`}
                title={q.desc}
              >
                {q.label.split(' ')[0]}
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 2: Audio & Subtitle Controls Side-By-Side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Audio Track Selection */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-950/30 via-indigo-950/20 to-transparent border border-purple-500/30 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-200">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-purple-400" />
              <span>Audio Track</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold">
              {audioTracks.length > 0 ? `${audioTracks.length} Available` : 'Default Stereo'}
            </span>
          </div>

          <div>
            <label className="text-[10px] uppercase font-semibold text-gray-400 block mb-1">
              Select Language & Format
            </label>
            <select
              value={state.activeAudioTrack !== undefined ? String(state.activeAudioTrack) : (state.activeAudio || '0')}
              onChange={(e) => onControl('SET_AUDIO', { trackId: e.target.value })}
              disabled={loading || audioTracks.length === 0}
              className="w-full bg-[#161924] border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500 transition-all shadow-inner"
            >
              {audioTracks.length > 0 ? (
                audioTracks.map((track: any, idx: number) => (
                  <option key={track.id || idx} value={track.id !== undefined ? track.id : String(idx)}>
                    🔊 {track.label || `Track ${idx + 1} (${track.language || 'Audio'})`}
                  </option>
                ))
              ) : (
                <option value="0">🔊 Default Stereo Audio (English)</option>
              )}
            </select>
          </div>
        </div>

        {/* Right: Subtitle & Delay Timing Micro-Adjuster */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-cyan-950/30 via-indigo-950/20 to-transparent border border-cyan-500/30 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-200">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-cyan-400" />
              <span>Subtitles</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold">
              Delay: {state.subtitleDelay > 0 ? `+${state.subtitleDelay}` : state.subtitleDelay || 0}s
            </span>
          </div>

          <div>
            <label className="text-[10px] uppercase font-semibold text-gray-400 block mb-1">
              Select Subtitle Track
            </label>
            <select
              value={state.activeSubtitle || 'Off'}
              onChange={(e) => onControl('SET_SUBTITLE', { language: e.target.value })}
              disabled={loading}
              className="w-full bg-[#161924] border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 mb-2.5 transition-all shadow-inner"
            >
              <option value="Off">Off (Disable Subtitles)</option>
              {(state.subtitles || []).map((sub: any, idx: number) => (
                <option key={idx} value={sub.label || sub.language}>
                  💬 {sub.label || sub.language}
                </option>
              ))}
            </select>
          </div>

          {/* Micro Delay Buttons */}
          <div className="flex items-center gap-1 pt-0.5">
            <button
              onClick={() => onControl('SET_SUBTITLE_DELAY', { delaySeconds: (state.subtitleDelay || 0) - 1.0 })}
              className="flex-1 py-1.5 px-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-mono border border-white/5 transition-all active:scale-95"
            >
              -1.0s
            </button>
            <button
              onClick={() => onControl('SET_SUBTITLE_DELAY', { delaySeconds: (state.subtitleDelay || 0) - 0.5 })}
              className="flex-1 py-1.5 px-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-mono border border-white/5 transition-all active:scale-95"
            >
              -0.5s
            </button>
            <button
              onClick={() => onControl('SET_SUBTITLE_DELAY', { delaySeconds: 0 })}
              className="flex-1 py-1.5 px-1 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/40 text-cyan-300 border border-cyan-500/40 text-[11px] font-mono font-bold transition-all active:scale-95 shadow-sm"
            >
              0s
            </button>
            <button
              onClick={() => onControl('SET_SUBTITLE_DELAY', { delaySeconds: (state.subtitleDelay || 0) + 0.5 })}
              className="flex-1 py-1.5 px-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-mono border border-white/5 transition-all active:scale-95"
            >
              +0.5s
            </button>
            <button
              onClick={() => onControl('SET_SUBTITLE_DELAY', { delaySeconds: (state.subtitleDelay || 0) + 1.0 })}
              className="flex-1 py-1.5 px-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-mono border border-white/5 transition-all active:scale-95"
            >
              +1.0s
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
