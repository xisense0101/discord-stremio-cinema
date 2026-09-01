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
      <div className="glass-panel rounded-2xl p-8 text-center border border-white/10 flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-gray-500">
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

  return (
    <div className="glass-panel-glow rounded-2xl p-6 border border-white/15 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Title & Status Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-semibold tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 text-xs font-medium transition-all active:scale-95"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
          <span>Stop Stream</span>
        </button>
      </div>

      {/* Scrub Progress Bar */}
      <div className="space-y-2 mb-6">
        <div className="relative flex items-center group">
          <input
            type="range"
            min={0}
            max={duration}
            value={currentTime}
            onChange={handleSeekChange}
            onMouseUp={handleSeekCommit}
            onTouchEnd={handleSeekCommit}
            className="w-full h-2.5 bg-[#1a1d29] rounded-lg appearance-none cursor-pointer focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between text-xs font-mono text-gray-400">
          <span className="text-white font-medium">{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Main Playback Control Buttons */}
      <div className="flex items-center justify-center gap-4 sm:gap-6 py-2 mb-8">
        <button
          onClick={() => onControl('REWIND', { seconds: 10 })}
          disabled={loading}
          className="w-12 h-12 rounded-2xl glass-panel hover:bg-white/10 flex items-center justify-center text-gray-300 hover:text-white transition-all active:scale-90"
          title="Rewind 10 seconds"
        >
          <RotateCcw className="w-5 h-5" />
        </button>

        <button
          onClick={() => onControl(isPlaying ? 'PAUSE' : 'RESUME')}
          disabled={loading}
          className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-indigo-600 to-indigo-400 hover:from-indigo-500 hover:to-indigo-300 flex items-center justify-center text-white shadow-xl shadow-indigo-600/30 transition-all active:scale-95"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-7 h-7 fill-current" />
          ) : (
            <Play className="w-7 h-7 fill-current ml-0.5" />
          )}
        </button>

        <button
          onClick={() => onControl('FORWARD', { seconds: 10 })}
          disabled={loading}
          className="w-12 h-12 rounded-2xl glass-panel hover:bg-white/10 flex items-center justify-center text-gray-300 hover:text-white transition-all active:scale-90"
          title="Forward 10 seconds"
        >
          <RotateCw className="w-5 h-5" />
        </button>
      </div>

      {/* Bottom Grid: Quality & Subtitles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/10">
        {/* Quality Switcher */}
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-300 mb-3">
            <Tv className="w-4 h-4 text-indigo-400" />
            <span>Stream Resolution</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {qualityOptions.map((q) => {
              const active = currentQualityNorm.includes(q.value);
              return (
                <button
                  key={q.value}
                  onClick={() => onControl('SET_QUALITY', { quality: q.value })}
                  disabled={loading}
                  className={`py-2 px-1 rounded-lg text-center text-xs font-medium transition-all ${
                    active
                      ? 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/30'
                      : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'
                  }`}
                  title={q.desc}
                >
                  {q.label.split(' ')[0]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Subtitle & Delay Timing Micro-Adjuster */}
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-300 mb-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-cyan-400" />
              <span>Subtitles</span>
            </div>
            <span className="text-[11px] text-cyan-400 font-mono">
              Delay: {state.subtitleDelay > 0 ? `+${state.subtitleDelay}` : state.subtitleDelay || 0}s
            </span>
          </div>

          {/* Subtitle Select Dropdown */}
          <select
            value={state.activeSubtitle || 'Off'}
            onChange={(e) => onControl('SET_SUBTITLE', { language: e.target.value })}
            disabled={loading}
            className="w-full bg-[#161924] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 mb-3"
          >
            <option value="Off">Off (Disable Subtitles)</option>
            {(state.subtitles || []).map((sub: any, idx: number) => (
              <option key={idx} value={sub.label || sub.language}>
                {sub.label || sub.language}
              </option>
            ))}
          </select>

          {/* Micro Delay Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onControl('SET_SUBTITLE_DELAY', { delaySeconds: (state.subtitleDelay || 0) - 1.0 })}
              className="flex-1 py-1 px-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-mono"
            >
              -1.0s
            </button>
            <button
              onClick={() => onControl('SET_SUBTITLE_DELAY', { delaySeconds: (state.subtitleDelay || 0) - 0.5 })}
              className="flex-1 py-1 px-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-mono"
            >
              -0.5s
            </button>
            <button
              onClick={() => onControl('SET_SUBTITLE_DELAY', { delaySeconds: 0 })}
              className="flex-1 py-1 px-1 rounded bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-[11px] font-mono font-bold"
            >
              Reset 0s
            </button>
            <button
              onClick={() => onControl('SET_SUBTITLE_DELAY', { delaySeconds: (state.subtitleDelay || 0) + 0.5 })}
              className="flex-1 py-1 px-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-mono"
            >
              +0.5s
            </button>
            <button
              onClick={() => onControl('SET_SUBTITLE_DELAY', { delaySeconds: (state.subtitleDelay || 0) + 1.0 })}
              className="flex-1 py-1 px-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-mono"
            >
              +1.0s
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
