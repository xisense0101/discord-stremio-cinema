'use client';

import React, { useState, useEffect } from 'react';
import { Search, Play, Plus, Film, Star, Sparkles, Check, Loader2 } from 'lucide-react';

interface ExploreViewProps {
  onPlay: (media: any) => Promise<void>;
  onQueue: (media: any) => Promise<void>;
  loading: boolean;
}

export const ExploreView: React.FC<ExploreViewProps> = ({ onPlay, onQueue, loading }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionSuccessId, setActionSuccessId] = useState<string | null>(null);

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results || []);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);

  const handleQueueClick = async (item: any) => {
    await onQueue(item);
    setActionSuccessId(item.id || item.imdbId);
    setTimeout(() => setActionSuccessId(null), 2000);
  };

  return (
    <div className="glass-panel rounded-2xl p-6 border border-white/10">
      {/* Header & Search Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="font-bold text-white text-lg flex items-center gap-2">
            <Film className="w-5 h-5 text-indigo-400" />
            Search & Explore Catalog
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Search Cinemeta & TorBox debrid cached library instantly.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movie or TV show..."
            className="w-full bg-[#161924] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-all"
          />
          {searching && (
            <Loader2 className="w-4 h-4 text-indigo-400 animate-spin absolute right-3.5 top-1/2 -translate-y-1/2" />
          )}
        </div>
      </div>

      {/* Search Results Grid */}
      {results.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {results.map((item) => {
            const isSuccess = actionSuccessId === (item.id || item.imdbId);
            return (
              <div
                key={item.id || item.imdbId}
                className="group rounded-xl overflow-hidden bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 transition-all flex flex-col justify-between"
              >
                {/* Poster Image */}
                <div className="aspect-[2/3] relative overflow-hidden bg-[#161924]">
                  {item.poster ? (
                    <img
                      src={item.poster}
                      alt={item.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                      <Film className="w-8 h-8" />
                    </div>
                  )}

                  {/* Year & Rating Badge */}
                  <div className="absolute top-2 left-2 flex items-center gap-1">
                    {item.releaseInfo && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-white">
                        {item.releaseInfo}
                      </span>
                    )}
                    {item.rating && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/80 backdrop-blur-md text-black flex items-center gap-0.5">
                        <Star className="w-2.5 h-2.5 fill-black" />
                        {item.rating}
                      </span>
                    )}
                  </div>
                </div>

                {/* Info & Action Buttons */}
                <div className="p-3">
                  <h4 className="font-bold text-xs text-white truncate mb-2" title={item.name}>
                    {item.name}
                  </h4>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => onPlay(item)}
                      disabled={loading}
                      className="py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] flex items-center justify-center gap-1 active:scale-95 transition-all"
                      title="Play Immediately"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      Play
                    </button>

                    <button
                      onClick={() => handleQueueClick(item)}
                      disabled={loading}
                      className={`py-1.5 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-1 active:scale-95 transition-all ${
                        isSuccess
                          ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300'
                          : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300'
                      }`}
                      title="Add to Queue"
                    >
                      {isSuccess ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      {isSuccess ? 'Queued' : 'Queue'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : query.length >= 2 && !searching ? (
        <div className="p-12 text-center text-xs text-gray-500">
          No matching titles found for &quot;{query}&quot;. Try another search term.
        </div>
      ) : (
        <div className="p-12 text-center text-xs text-gray-500">
          Type in the search bar above to look up any movie or TV series on Cinemeta.
        </div>
      )}
    </div>
  );
};
