'use client';

import React from 'react';
import { Popcorn, Play, FastForward, Clock } from 'lucide-react';

interface IntermissionBannerProps {
  remainingSeconds: number;
  nextItemName?: string;
  onSkip: () => void;
}

export const IntermissionBanner: React.FC<IntermissionBannerProps> = ({
  remainingSeconds,
  nextItemName,
  onSkip,
}) => {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const percent = Math.max(0, Math.min(100, ((120 - remainingSeconds) / 120) * 100));

  return (
    <div className="mb-6 rounded-2xl glass-panel border border-amber-500/30 p-5 bg-gradient-to-r from-amber-950/40 via-amber-900/20 to-transparent relative overflow-hidden shadow-xl">
      {/* Ambient Glow */}
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-lg shadow-amber-500/10">
            <Popcorn className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-amber-300 text-base">🍿 2-Minute Intermission Break</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 font-mono font-bold">
                {formatted}
              </span>
            </div>
            <p className="text-xs text-gray-300 mt-0.5">
              Grab snacks! Next up:{' '}
              <span className="text-white font-medium">{nextItemName || 'Next Queued Movie'}</span>
            </p>
          </div>
        </div>

        {/* Progress Bar & Skip Button */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="hidden lg:block w-36 h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-1000 ease-linear"
              style={{ width: `${percent}%` }}
            />
          </div>

          <button
            onClick={onSkip}
            className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-semibold text-xs transition-all shadow-md active:scale-95"
          >
            <FastForward className="w-4 h-4" />
            Skip Break & Play Now
          </button>
        </div>
      </div>
    </div>
  );
};
