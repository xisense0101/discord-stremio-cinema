'use client';

import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Film,
  Calendar,
  Star,
  Layers,
  Check,
  Loader2,
  Clock,
  Timer,
  PlaySquare,
} from 'lucide-react';

interface SmartRandomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const SmartRandomModal: React.FC<SmartRandomModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [mode, setMode] = useState<'duration' | 'count'>('duration');
  const [days, setDays] = useState(0);
  const [hours, setHours] = useState(6);
  const [count, setCount] = useState(3);

  const [startYear, setStartYear] = useState(2015);
  const [endYear, setEndYear] = useState(2025);
  const [minRating, setMinRating] = useState(6.5);
  const [genre, setGenre] = useState('all');
  const [quality, setQuality] = useState('1080p');

  const [loading, setLoading] = useState(false);
  const [resultMessage, setResultMessage] = useState('');
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (isOpen) {
      fetch('/api/settings')
        .then((res) => res.json())
        .then((data) => {
          if (data.settings?.defaultQuality) {
            setQuality(data.settings.defaultQuality);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const totalTargetHours = days * 24 + hours;
  const estimatedMovies = Math.max(1, Math.ceil((totalTargetHours * 60) / 122));

  const genres = [
    { label: 'All Genres', value: 'all' },
    { label: 'Action', value: 'Action' },
    { label: 'Sci-Fi', value: 'Sci-Fi' },
    { label: 'Thriller', value: 'Thriller' },
    { label: 'Drama', value: 'Drama' },
    { label: 'Comedy', value: 'Comedy' },
    { label: 'Adventure', value: 'Adventure' },
    { label: 'Animation', value: 'Animation' },
    { label: 'Horror', value: 'Horror' },
  ];

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setResultMessage('');

    try {
      const payload = {
        startYear,
        endYear,
        minRating,
        genre,
        quality,
        ...(mode === 'duration' ? { days, hours } : { count }),
      };

      const res = await fetch('/api/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setResultMessage(
          data.formattedDuration
            ? `🎉 Queued ${data.queuedCount} movies (~${data.formattedDuration} marathon)!`
            : `🎉 Queued ${data.queuedCount} movies successfully!`
        );
        onSuccess();
        setTimeout(() => {
          onClose();
          setResultMessage('');
        }, 2200);
      } else {
        setError(data.error || 'Failed to generate random binge queue');
      }
    } catch (err) {
      setError('Connection error generating random marathon queue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-xl glass-panel-glow rounded-3xl p-6 md:p-8 border border-white/20 relative shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Ambient Glow */}
        <div className="absolute top-0 right-0 w-60 h-60 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-white text-lg">Smart Cinema Marathon Picker</h3>
              <p className="text-xs text-gray-400">Auto-queue trending movies for continuous bingeing</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 rounded-xl border border-white/10 mb-5">
          <button
            type="button"
            onClick={() => setMode('duration')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              mode === 'duration'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Timer className="w-4 h-4" />
            Marathon Timer (Days & Hours)
          </button>

          <button
            type="button"
            onClick={() => setMode('count')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              mode === 'count'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" />
            Movie Count (1-5 Movies)
          </button>
        </div>

        {/* Alerts */}
        {resultMessage && (
          <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <Check className="w-4 h-4" />
            {resultMessage}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
            {error}
          </div>
        )}

        {/* Form Controls */}
        <div className="space-y-5">
          {/* Duration Mode Controls */}
          {mode === 'duration' ? (
            <div className="p-4 rounded-2xl bg-indigo-950/30 border border-indigo-500/20 space-y-4">
              <div className="flex items-center justify-between text-xs font-semibold text-indigo-300">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  Target Marathon Duration
                </span>
                <span className="font-mono text-white bg-indigo-500/20 px-2.5 py-0.5 rounded-full border border-indigo-500/30">
                  {days > 0 ? `${days}d ` : ''}
                  {hours}h 00m Total
                </span>
              </div>

              {/* Days & Hours Selection */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-400 block mb-1">Days</label>
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDays(d)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                          days === d
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white/5 hover:bg-white/10 text-gray-400'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-gray-400 block mb-1">Hours</label>
                  <input
                    type="number"
                    min={1}
                    max={23}
                    value={hours}
                    onChange={(e) => setHours(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full bg-[#161924] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              {/* Quick Hours Presets */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-gray-400">Quick:</span>
                {[2, 4, 6, 8, 12, 18, 24].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      setDays(Math.floor(h / 24));
                      setHours(h % 24 || 24);
                    }}
                    className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[11px] text-gray-300 font-mono"
                  >
                    {h}h
                  </button>
                ))}
              </div>

              {/* Intelligent Explanation Note */}
              <div className="text-[11px] text-indigo-200/80 bg-indigo-500/10 p-2.5 rounded-xl border border-indigo-500/15">
                💡 <span className="font-semibold text-indigo-200">Smart Binge Guarantee:</span> Will queue ~{estimatedMovies} movies to run continuously for ~{totalTargetHours} hours. If the timer elapses during a movie, it will **complete the full movie to the end** before finishing.
              </div>
            </div>
          ) : (
            /* Movie Count Mode */
            <div>
              <div className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-cyan-400" />
                Select Number of Movies
              </div>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setCount(num)}
                    className={`flex-1 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
                      count === num
                        ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                        : 'bg-white/5 hover:bg-white/10 text-gray-400'
                    }`}
                  >
                    {num} Movie{num > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Release Year Range (2015-2025) */}
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-gray-300 mb-2">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-indigo-400" />
                Release Year Window
              </span>
              <span className="font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                {startYear} — {endYear}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-gray-500">From Year</label>
                <input
                  type="number"
                  min={1970}
                  max={endYear}
                  value={startYear}
                  onChange={(e) => setStartYear(parseInt(e.target.value, 10))}
                  className="w-full bg-[#161924] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500">To Year</label>
                <input
                  type="number"
                  min={startYear}
                  max={2030}
                  value={endYear}
                  onChange={(e) => setEndYear(parseInt(e.target.value, 10))}
                  className="w-full bg-[#161924] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                />
              </div>
            </div>
          </div>

          {/* Genre Filter */}
          <div>
            <div className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
              <Film className="w-4 h-4 text-purple-400" />
              Genre Filter
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {genres.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGenre(g.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    genre === g.value
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Min Rating & Quality */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-gray-300 mb-1.5">
                <span className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-amber-400" />
                  Min Rating
                </span>
                <span className="font-mono text-amber-400">{minRating.toFixed(1)}+</span>
              </div>
              <input
                type="range"
                min={5.0}
                max={8.5}
                step={0.1}
                value={minRating}
                onChange={(e) => setMinRating(parseFloat(e.target.value))}
                className="w-full h-2 bg-[#161924] rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1.5">Stream Quality</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="w-full bg-[#161924] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white"
              >
                <option value="1080p">1080p FHD (Standard)</option>
                <option value="4k">4K UHD (2160p)</option>
                <option value="2k">2K QHD (1440p)</option>
                <option value="720p">720p HD</option>
              </select>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="mt-6 pt-4 border-t border-white/10">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold text-sm shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 active:scale-98 transition-all disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing Catalog & Resolving TorBox Streams...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {mode === 'duration'
                  ? `Generate & Queue ${totalTargetHours}h Marathon Binge (${startYear}–${endYear})`
                  : `Generate & Queue ${count} Random Movies (${startYear}–${endYear})`}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
