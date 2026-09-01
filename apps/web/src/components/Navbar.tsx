'use client';

import React from 'react';
import { Film, Radio, LogOut, Sparkles, Tv, Shield, Volume2, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface NavbarProps {
  status: string;
  workerConnected: boolean;
  onOpenSmartRandom: () => void;
  onOpenSettings: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  status,
  workerConnected,
  onOpenSmartRandom,
  onOpenSettings,
}) => {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch {}
  };

  const isStreaming = status === 'PLAYING' || status === 'PAUSED';
  const isIntermission = status === 'INTERMISSION';

  return (
    <header className="glass-panel sticky top-0 z-40 border-b border-white/10 px-4 lg:px-8 py-3.5 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Left: Branding & Status */}
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center shadow-md shadow-indigo-500/20">
            <Film className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white tracking-tight">Discord Cinema</span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/25">
                Go-Live
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <span
                className={`w-2 h-2 rounded-full ${
                  isStreaming
                    ? 'bg-emerald-400 animate-pulse'
                    : isIntermission
                    ? 'bg-amber-400 animate-ping'
                    : workerConnected
                    ? 'bg-indigo-400'
                    : 'bg-rose-400'
                }`}
              />
              <span>
                {isStreaming
                  ? 'Streaming Live (1080p FHD)'
                  : isIntermission
                  ? '🍿 Intermission Break'
                  : workerConnected
                  ? 'Streamer Ready'
                  : 'Worker Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Actions, Settings & Profile */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            onClick={onOpenSmartRandom}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600/30 to-purple-600/30 hover:from-indigo-600/50 hover:to-purple-600/50 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-all shadow-sm active:scale-95"
          >
            <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
            <span className="hidden sm:inline">🎲 Smart Marathon</span>
          </button>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            title="Cinema & Voice Channel Settings"
            className="p-2 sm:px-3 sm:py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-medium transition-all flex items-center gap-1.5 active:scale-95"
          >
            <Settings className="w-4 h-4 text-indigo-400" />
            <span className="hidden md:inline">Settings</span>
          </button>

          <div className="h-6 w-px bg-white/10 hidden sm:block" />

          {/* User profile */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="font-medium">senzu</span>
          </div>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            title="Logout"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/25 text-xs font-medium transition-all active:scale-95"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};
