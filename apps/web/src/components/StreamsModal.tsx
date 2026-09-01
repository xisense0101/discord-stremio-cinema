'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Plus,
  Film,
  Zap,
  HardDrive,
  Users,
  Loader2,
  Check,
  Filter,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

export interface StreamItem {
  id: string;
  title: string;
  quality: '720p' | '1080p' | '4k' | '480p' | 'other';
  provider: string;
  url: string;
  sizeBytes?: number;
  seeds?: number;
  isCached?: boolean;
  details?: string;
}

interface StreamsModalProps {
  isOpen: boolean;
  onClose: () => void;
  media: any;
  onPlayStream: (media: any, stream: StreamItem, targetQuality: string) => Promise<void>;
  onQueueStream?: (media: any, stream: StreamItem, targetQuality: string) => Promise<void>;
  defaultQuality?: string;
}

export const StreamsModal: React.FC<StreamsModalProps> = ({
  isOpen,
  onClose,
  media,
  onPlayStream,
  onQueueStream,
  defaultQuality = '720p',
}) => {
  const [streams, setStreams] = useState<StreamItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qualityFilter, setQualityFilter] = useState<string>('all');
  const [playingStreamId, setPlayingStreamId] = useState<string | null>(null);
  const [queuedStreamId, setQueuedStreamId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !media || !media.imdbId) {
      setStreams([]);
      return;
    }

    const fetchStreams = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/streams?imdbId=${encodeURIComponent(media.imdbId)}&type=${media.type || 'movie'}`);
        const data = await res.json();
        if (data.success) {
          setStreams(data.streams || []);
        } else {
          setError(data.error || 'Failed to discover torrent streams');
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchStreams();
  }, [isOpen, media]);

  if (!isOpen || !media) return null;

  const filteredStreams = streams.filter((s) => {
    if (qualityFilter === 'all') return true;
    return s.quality === qualityFilter;
  });

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return null;
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  const getQualityBadge = (quality: string) => {
    const q = quality.toLowerCase();
    if (q === '720p') {
      return (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
          720p HD (Best for Discord)
        </span>
      );
    }
    if (q === '1080p') {
      return (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
          1080p FHD
        </span>
      );
    }
    if (q === '4k') {
      return (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
          4K UHD
        </span>
      );
    }
    if (q === '480p') {
      return (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
          480p SD
        </span>
      );
    }
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-gray-300 border border-white/10">
        {quality.toUpperCase()}
      </span>
    );
  };

  const handlePlay = async (stream: StreamItem) => {
    setPlayingStreamId(stream.id || stream.url);
    try {
      const streamQuality = stream.quality && stream.quality !== 'other' ? stream.quality : (defaultQuality || '720p');
      await onPlayStream(media, stream, streamQuality);
      onClose();
    } finally {
      setPlayingStreamId(null);
    }
  };

  const handleQueue = async (stream: StreamItem) => {
    if (!onQueueStream) return;
    setQueuedStreamId(stream.id || stream.url);
    try {
      const streamQuality = stream.quality && stream.quality !== 'other' ? stream.quality : (defaultQuality || '720p');
      await onQueueStream(media, stream, streamQuality);
      setTimeout(() => setQueuedStreamId(null), 2000);
    } finally {
      // Keep open or let user queue multiple
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-[#12141c] border border-white/15 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-start justify-between gap-4 bg-gradient-to-r from-indigo-900/30 via-transparent to-transparent">
          <div className="flex items-center gap-4">
            {media.poster && (
              <img
                src={media.poster}
                alt={media.name}
                className="w-14 h-20 object-cover rounded-xl border border-white/10 shadow-md shrink-0"
              />
            )}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 uppercase tracking-wider">
                  {media.type || 'Movie'}
                </span>
                {media.releaseInfo && (
                  <span className="text-xs text-gray-400 font-medium">({media.releaseInfo})</span>
                )}
              </div>
              <h3 className="text-xl font-bold text-white mt-1 line-clamp-1">{media.name}</h3>
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                Select a cached TorBox debrid torrent source to stream directly to Discord.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quality Filter Pills */}
        <div className="px-6 py-3 border-b border-white/5 bg-[#161924]/60 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400 font-semibold mr-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-indigo-400" />
              Filter:
            </span>
            {['all', '720p', '1080p', '4k', '480p'].map((q) => (
              <button
                key={q}
                onClick={() => setQualityFilter(q)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  qualityFilter === q
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5'
                }`}
              >
                {q === 'all' ? 'All Sources' : q === '720p' ? '720p (Fastest)' : q.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="text-xs text-gray-400 font-mono">
            {filteredStreams.length} {filteredStreams.length === 1 ? 'source' : 'sources'} available
          </div>
        </div>

        {/* Streams List Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
              <p className="text-sm font-semibold text-white">Searching TorBox Debrid Cache...</p>
              <p className="text-xs text-gray-500 mt-1">Discovering high-speed torrent video CDN streams.</p>
            </div>
          ) : error ? (
            <div className="py-16 text-center text-rose-400 text-xs">
              ⚠️ {error}
            </div>
          ) : filteredStreams.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-xs">
              No streams found matching the selected filter.
            </div>
          ) : (
            filteredStreams.map((stream, idx) => {
              const isPlaying = playingStreamId === (stream.id || stream.url);
              const isQueued = queuedStreamId === (stream.id || stream.url);
              const formattedSize = formatBytes(stream.sizeBytes);

              return (
                <div
                  key={stream.id || idx}
                  className="group p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-indigo-500/40 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  {/* Left: Stream Info */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getQualityBadge(stream.quality)}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                        <Zap className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                        Instant Debrid Stream
                      </span>
                      {formattedSize && (
                        <span className="text-[10px] font-mono text-gray-400 flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-md border border-white/5">
                          <HardDrive className="w-2.5 h-2.5 text-gray-500" />
                          {formattedSize}
                        </span>
                      )}
                      {stream.seeds !== undefined && stream.seeds > 0 && (
                        <span className="text-[10px] font-mono text-gray-400 flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-md border border-white/5">
                          <Users className="w-2.5 h-2.5 text-emerald-400" />
                          {stream.seeds} seeds
                        </span>
                      )}
                    </div>

                    <h4 className="text-xs font-semibold text-white group-hover:text-indigo-200 transition-colors line-clamp-2 leading-relaxed">
                      {stream.title}
                    </h4>

                    {stream.details && (
                      <p className="text-[11px] text-gray-400 line-clamp-1">{stream.details}</p>
                    )}
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                    <button
                      onClick={() => handlePlay(stream)}
                      disabled={isPlaying}
                      className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/25 transition-all"
                    >
                      {isPlaying ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                      Stream Now
                    </button>

                    {onQueueStream && (
                      <button
                        onClick={() => handleQueue(stream)}
                        disabled={isQueued}
                        className={`p-2 rounded-xl border text-xs font-semibold flex items-center justify-center active:scale-95 transition-all ${
                          isQueued
                            ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300'
                            : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300'
                        }`}
                        title="Add this stream to queue"
                      >
                        {isQueued ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#161924]/80 border-t border-white/10 flex items-center justify-between text-xs text-gray-400">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            720p HD is recommended for lowest latency & zero stutter.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-semibold transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
