'use client';

import React, { useState } from 'react';
import {
  ListOrdered,
  Trash2,
  ArrowUp,
  ArrowDown,
  Film,
  Sparkles,
  Plus,
  Edit2,
  Search,
  Check,
  X,
  Tv,
  Clock,
  RefreshCw,
  Play,
} from 'lucide-react';
import { parseRuntimeMinutes } from '@/lib/random-movie';

interface QueueViewProps {
  items: any[];
  onRemove: (index: number) => Promise<void>;
  onClear: () => Promise<void>;
  onReorder: (fromIndex: number, toIndex: number) => Promise<void>;
  onOpenSmartRandom: () => void;
  onAddCustomMovie: (mediaItem: any, quality?: string) => Promise<void>;
  onUpdateItemQuality?: (index: number, quality: string) => Promise<void>;
  onReplaceItem?: (index: number, mediaItem: any) => Promise<void>;
  onPlayNow?: (mediaItem: any, index: number) => Promise<void>;
  loading: boolean;
}

export const QueueView: React.FC<QueueViewProps> = ({
  items,
  onRemove,
  onClear,
  onReorder,
  onOpenSmartRandom,
  onAddCustomMovie,
  onUpdateItemQuality,
  onReplaceItem,
  onPlayNow,
  loading,
}) => {
  const [isAddSearchOpen, setIsAddSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [swapSearchQuery, setSwapSearchQuery] = useState('');
  const [swapResults, setSwapResults] = useState<any[]>([]);

  // Search handler for inline add
  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (!q || q.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error('Queue search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Search handler for swap
  const handleSwapSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSwapSearchQuery(q);
    if (!q || q.length < 2) {
      setSwapResults([]);
      return;
    }

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSwapResults(data.results || []);
    } catch (err) {
      console.error('Swap search error:', err);
    }
  };

  const handleSelectAddMovie = async (movie: any) => {
    await onAddCustomMovie(movie);
    setSearchQuery('');
    setSearchResults([]);
    setIsAddSearchOpen(false);
  };

  const handleSwapMovie = async (index: number, replacementMovie: any) => {
    if (onReplaceItem) {
      await onReplaceItem(index, replacementMovie);
      setEditingIndex(null);
      setSwapSearchQuery('');
      setSwapResults([]);
    }
  };

  const handleQualityChange = async (index: number, newQuality: string) => {
    if (onUpdateItemQuality) {
      await onUpdateItemQuality(index, newQuality);
      setEditingIndex(null);
    }
  };

  // Calculate total runtime of queued items
  const totalMins = items.reduce((acc, it) => acc + parseRuntimeMinutes(it.media?.runtime) + 2, 0);
  const totalHours = Math.floor(totalMins / 60);
  const remainingMins = totalMins % 60;

  return (
    <div className="glass-panel rounded-2xl p-5 border border-white/10 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ListOrdered className="w-5 h-5 text-indigo-400" />
          <h3 className="font-bold text-white text-base">Playback Queue</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono font-bold">
            {items.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddSearchOpen(!isAddSearchOpen)}
            className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 font-medium flex items-center gap-1 transition-all"
            title="Add Custom Movie to Queue"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Movie</span>
          </button>

          {items.length > 0 && (
            <button
              onClick={onClear}
              disabled={loading}
              className="text-xs px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 flex items-center gap-1 transition-all"
              title="Clear all queued items"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Total Estimated Queue Duration Bar */}
      {items.length > 0 && (
        <div className="mb-3 px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between text-[11px] text-gray-400 font-mono">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            Total Runtime:
          </span>
          <span className="text-white font-semibold">
            ~{totalHours > 0 ? `${totalHours}h ` : ''}{remainingMins}m (with 2m breaks)
          </span>
        </div>
      )}

      {/* Inline Add Movie Search Bar */}
      {isAddSearchOpen && (
        <div className="mb-4 p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 animate-in fade-in duration-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-indigo-300">Add Your Choice to Queue</span>
            <button
              onClick={() => setIsAddSearchOpen(false)}
              className="text-gray-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Type movie name to add..."
              className="w-full bg-[#161924] border border-white/15 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Autocomplete Results */}
          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto pr-1">
              {searchResults.slice(0, 5).map((m) => (
                <div
                  key={m.id || m.imdbId}
                  onClick={() => handleSelectAddMovie(m)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-indigo-600/30 flex items-center justify-between gap-2 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {m.poster && (
                      <img src={m.poster} alt={m.name} className="w-6 h-8 object-cover rounded" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">{m.name}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{m.releaseInfo || m.year || 'Movie'}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-600 text-white shrink-0">
                    + Add
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Scrollable Queue List */}
      {items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center border border-dashed border-white/10 rounded-xl bg-white/[0.01]">
          <Film className="w-10 h-10 text-gray-600 mb-3" />
          <p className="text-sm text-gray-300 font-medium">Queue is empty</p>
          <p className="text-xs text-gray-500 max-w-xs mt-1 mb-4">
            Search for movies above or generate a continuous binge with our Smart Marathon Picker.
          </p>
          <button
            onClick={onOpenSmartRandom}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold transition-all flex items-center gap-1.5 shadow-md shadow-indigo-600/20 active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5" />
            🎲 Smart Marathon Picker
          </button>
        </div>
      ) : (
        <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[460px] pr-1.5 custom-scrollbar">
          {items.map((item, idx) => {
            const isEditing = editingIndex === idx;
            const runtimeMinutes = parseRuntimeMinutes(item.media?.runtime);
            const runtimeHours = Math.floor(runtimeMinutes / 60);
            const runtimeMins = runtimeMinutes % 60;

            return (
              <div
                key={item.id || idx}
                className={`p-3 rounded-xl border transition-all ${
                  isEditing
                    ? 'bg-indigo-950/40 border-indigo-500/50 shadow-lg'
                    : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/5'
                }`}
              >
                {/* Main Row */}
                <div className="flex items-center justify-between gap-3">
                  {/* Left: Index & Artwork & Title */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-bold text-gray-500 w-4 text-center">
                      {idx + 1}
                    </span>

                    {item.media?.poster ? (
                      <img
                        src={item.media.poster}
                        alt={item.media.name}
                        className="w-10 h-14 object-cover rounded-lg shadow-sm border border-white/10 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-14 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-gray-500 shrink-0">
                        <Film className="w-4 h-4" />
                      </div>
                    )}

                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white truncate group-hover:text-indigo-300 transition-colors">
                        {item.media?.name || 'Untitled'}
                      </h4>
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-1 font-mono flex-wrap">
                        <button
                          onClick={() => setEditingIndex(isEditing ? null : idx)}
                          className="px-1.5 py-0.2 rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 font-semibold flex items-center gap-1 border border-indigo-500/25"
                          title="Click to edit movie or quality"
                        >
                          <Tv className="w-2.5 h-2.5" />
                          {item.stream?.quality || '1080p'}
                        </button>
                        <span>•</span>
                        <span>{runtimeHours > 0 ? `${runtimeHours}h ` : ''}{runtimeMins}m</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Controls (Move Up/Down, Edit, Play Now, Delete) */}
                  <div className="flex items-center gap-1 shrink-0">
                    {onPlayNow && (
                      <button
                        onClick={() => onPlayNow(item.media, idx)}
                        disabled={loading}
                        title="Play this movie right now"
                        className="p-1.5 rounded-lg hover:bg-indigo-600/30 text-indigo-400 hover:text-white transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                    )}
                    {idx > 0 && (
                      <button
                        onClick={() => onReorder(idx, idx - 1)}
                        disabled={loading}
                        title="Move Up"
                        className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {idx < items.length - 1 && (
                      <button
                        onClick={() => onReorder(idx, idx + 1)}
                        disabled={loading}
                        title="Move Down"
                        className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => setEditingIndex(isEditing ? null : idx)}
                      disabled={loading}
                      title="Edit Item / Change Movie"
                      className={`p-1.5 rounded-lg transition-colors ${
                        isEditing ? 'bg-indigo-600 text-white' : 'hover:bg-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onRemove(idx)}
                      disabled={loading}
                      title="Remove from queue"
                      className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Inline Edit & Swap Panel when open */}
                {isEditing && (
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
                    {/* Quality Switcher */}
                    <div>
                      <div className="text-[11px] font-semibold text-gray-300 mb-1.5">
                        Stream Quality:
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {['4k', '2k', '1080p', '720p'].map((q) => {
                          const isSelected = (item.stream?.quality || '1080p').toLowerCase() === q;
                          return (
                            <button
                              key={q}
                              onClick={() => handleQualityChange(idx, q)}
                              className={`py-1 rounded text-center text-[11px] font-bold font-mono transition-all ${
                                isSelected
                                  ? 'bg-indigo-600 text-white shadow-md'
                                  : 'bg-white/5 hover:bg-white/10 text-gray-300'
                              }`}
                            >
                              {q.toUpperCase()}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Swap / Change Movie */}
                    <div>
                      <div className="text-[11px] font-semibold text-gray-300 mb-1.5 flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 text-indigo-400" />
                        Change / Swap with Another Movie:
                      </div>
                      <div className="relative">
                        <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={swapSearchQuery}
                          onChange={handleSwapSearchChange}
                          placeholder="Search movie to swap in place..."
                          className="w-full bg-[#161924] border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      {swapResults.length > 0 && (
                        <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto">
                          {swapResults.slice(0, 4).map((sm) => (
                            <div
                              key={sm.id || sm.imdbId}
                              onClick={() => handleSwapMovie(idx, sm)}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-indigo-600/30 flex items-center justify-between gap-2 cursor-pointer text-xs"
                            >
                              <span className="truncate text-white font-medium">{sm.name}</span>
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-600 text-white shrink-0">
                                Swap In
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
