'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from '@/components/Navbar';
import { PlayerRemote } from '@/components/PlayerRemote';
import { QueueView } from '@/components/QueueView';
import { ExploreView } from '@/components/ExploreView';
import { SmartRandomModal } from '@/components/SmartRandomModal';
import { VoiceSettingsPanel } from '@/components/VoiceSettingsPanel';
import { SettingsModal } from '@/components/SettingsModal';
import { IntermissionBanner } from '@/components/IntermissionBanner';
import { StreamsModal, StreamItem } from '@/components/StreamsModal';
import { Tv, Headphones, Settings, Sparkles, AlertTriangle, Key, Radio, Volume2 } from 'lucide-react';

export default function CinemaDashboard() {
  const [activeTab, setActiveTab] = useState<'remote' | 'settings'>('remote');
  const [playerState, setPlayerState] = useState<any>(null);
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [tokenHealth, setTokenHealth] = useState<any>(null);
  const [workerConnected, setWorkerConnected] = useState<boolean>(true);
  const [defaultQuality, setDefaultQuality] = useState<string>('720p');
  const [activeVoiceInfo, setActiveVoiceInfo] = useState<{ guildId?: string; vcId?: string; vcName?: string; guildName?: string }>({});
  const [isRandomModalOpen, setIsRandomModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [selectedStreamsMedia, setSelectedStreamsMedia] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Fetch live state & token health & settings
  const fetchState = useCallback(async () => {
    try {
      // 1. Fetch active settings FIRST so the player-state fetch below can
      // target the currently-selected guild, not whatever was selected on
      // the previous poll (or the hardcoded default on first load). Player
      // state is guild-scoped on the worker (one WorkerGuildSession per
      // guild) - fetching it without a guildId falls back to the app's
      // hardcoded DEFAULT_GUILD_ID, which used to make the remote silently
      // show/control the wrong server's session after switching VCs.
      let currentGuildId = activeVoiceInfo.guildId;
      const settingsRes = await fetch('/api/settings');
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        if (settingsData.settings) {
          if (settingsData.settings.defaultQuality) {
            setDefaultQuality(settingsData.settings.defaultQuality);
          }
          currentGuildId = settingsData.settings.selectedGuildId;
          setActiveVoiceInfo({
            guildId: settingsData.settings.selectedGuildId,
            vcId: settingsData.settings.selectedVoiceChannelId,
          });
        }
      }

      // 2. Fetch player state for that guild
      const stateUrl = currentGuildId ? `/api/player/state?guildId=${encodeURIComponent(currentGuildId)}` : '/api/player/state';
      const res = await fetch(stateUrl, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setPlayerState(data.state);
        // A null queue means this poll could not reach the worker, which is
        // not the same as the queue being empty - keep showing what we last
        // knew rather than blanking the list on a single failed poll.
        if (Array.isArray(data.queue)) {
          setQueueItems(data.queue);
        }
        setWorkerConnected(data.workerConnected !== false);
      }

      // 3. Fetch token health
      const tokenRes = await fetch('/api/token');
      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        setTokenHealth(tokenData);
      }
    } catch (err) {
      console.warn('State sync notice:', err);
    }
  }, [activeVoiceInfo.guildId]);

  // Real-time polling loop
  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 2000);
    return () => clearInterval(interval);
  }, [fetchState]);

  // Execute playback control action
  const handleControl = async (action: string, payload: any = {}) => {
    setLoading(true);
    try {
      const res = await fetch('/api/player/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload, guildId: activeVoiceInfo.guildId }),
      });
      const data = await res.json();
      if (data.state) {
        setPlayerState(data.state);
      }
    } catch (err) {
      console.error('Control error:', err);
    } finally {
      setLoading(false);
      fetchState();
    }
  };

  // Play a movie immediately using active defaultQuality.
  // `fromQueueIndex` is set when this came from a queue row's "Play Now": that
  // entry has to leave the queue, otherwise it is still sitting at the front
  // when the movie ends and the intermission "advances" straight back into the
  // title that just finished.
  const handlePlayMedia = async (
    mediaItem: any,
    qualityOverride?: string,
    fromQueueIndex?: number
  ) => {
    setLoading(true);
    try {
      const targetQuality = qualityOverride || defaultQuality || '720p';
      const res = await fetch('/api/player/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaItem,
          quality: targetQuality,
          guildId: activeVoiceInfo.guildId,
          voiceChannelId: activeVoiceInfo.vcId,
        }),
      });
      const data = await res.json();
      if (data.state) {
        setPlayerState(data.state);
      }
      if (data.success !== false && typeof fromQueueIndex === 'number') {
        await fetch('/api/queue', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index: fromQueueIndex, guildId: activeVoiceInfo.guildId }),
        });
      }
    } catch (err) {
      console.error('Play error:', err);
    } finally {
      setLoading(false);
      fetchState();
    }
  };

  // Play a specific chosen torrent stream
  const handlePlayStream = async (mediaItem: any, stream: StreamItem, targetQuality: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/player/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaItem,
          stream,
          quality: targetQuality || defaultQuality || '720p',
          guildId: activeVoiceInfo.guildId,
          voiceChannelId: activeVoiceInfo.vcId,
        }),
      });
      const data = await res.json();
      if (data.state) {
        setPlayerState(data.state);
      }
    } catch (err) {
      console.error('Play stream error:', err);
    } finally {
      setLoading(false);
      fetchState();
    }
  };

  // Add a movie to queue using active defaultQuality
  const handleQueueMedia = async (mediaItem: any, qualityOverride?: string) => {
    await queueMutate('POST', { mediaItem, quality: qualityOverride || defaultQuality || '720p' });
  };

  // Every queue mutation goes through here so that two things are always
  // true: the request carries the guild currently being watched, and the
  // list on screen updates from the response instead of waiting up to two
  // seconds for the next poll.
  //
  // The guildId matters more than it looks. The queue is stored per guild, and
  // several of these calls used to omit it entirely - so removing, clearing or
  // reordering while watching one server silently edited a different server's
  // queue (whatever DEFAULT_GUILD_ID points at) and the list on screen never
  // changed.
  const queueMutate = async (method: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/queue', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, guildId: activeVoiceInfo.guildId }),
      });
      const data = await res.json().catch(() => null);
      if (Array.isArray(data?.items)) {
        setQueueItems(data.items);
      } else {
        fetchState();
      }
    } catch (err) {
      console.error('Queue update error:', err);
      fetchState();
    }
  };

  // Add a specific chosen torrent stream to queue
  const handleQueueStream = async (mediaItem: any, stream: StreamItem, targetQuality: string) => {
    await queueMutate('POST', {
      mediaItem,
      stream,
      quality: targetQuality || defaultQuality || '720p',
    });
  };

  // Replace / Swap movie at index in queue
  const handleReplaceQueueItem = async (index: number, mediaItem: any) => {
    await queueMutate('PATCH', { index, mediaItem, quality: defaultQuality });
  };

  // Update item quality in queue
  const handleUpdateItemQuality = async (index: number, quality: string) => {
    await queueMutate('PATCH', { index, quality });
  };

  // Remove from queue
  const handleRemoveQueueItem = async (index: number) => {
    // Drop it on screen straight away; the response reconciles the real list.
    setQueueItems((prev) => prev.filter((_, i) => i !== index));
    await queueMutate('DELETE', { index });
  };

  // Clear queue
  const handleClearQueue = async () => {
    setQueueItems([]);
    await queueMutate('DELETE', { clearAll: true });
  };

  // Reorder queue
  const handleReorderQueue = async (fromIndex: number, toIndex: number) => {
    // Move it locally first so dragging feels immediate rather than snapping
    // back until the worker answers.
    setQueueItems((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    await queueMutate('PATCH', { fromIndex, toIndex });
  };

  // Skip intermission
  const handleSkipIntermission = async () => {
    await handleControl('SKIP_INTERMISSION');
  };

  const isIntermission = playerState?.status === 'INTERMISSION';
  const remainingIntermission = playerState?.intermissionRemaining || 0;
  const nextQueueItemName = queueItems[0]?.media?.name;

  const isStreamerTokenInvalid = tokenHealth && tokenHealth.streamer && tokenHealth.streamer.valid === false;

  return (
    <div className="min-h-screen flex flex-col bg-[#090a0f] text-gray-100">
      {/* Top Navbar */}
      <Navbar
        status={playerState?.status || 'IDLE'}
        workerConnected={workerConnected}
        onOpenSmartRandom={() => setIsRandomModalOpen(true)}
        onOpenSettings={() => setActiveTab('settings')}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 space-y-6">
        {/* Token Expired Alert Banner */}
        {isStreamerTokenInvalid && (
          <div className="p-4 rounded-2xl bg-rose-950/60 border border-rose-500/40 text-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xl animate-in fade-in">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-white">Streamer Account Token is Expired or Invalid!</h4>
                <p className="text-xs text-rose-300/80 mt-0.5">
                  The Go-Live streamer cannot join voice channels until a new Discord token is provided.
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('settings')}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-600/30 flex items-center gap-1.5 shrink-0 active:scale-95 transition-all"
            >
              <Key className="w-3.5 h-3.5" />
              <span>Update Token in Settings</span>
            </button>
          </div>
        )}

        {/* Navigation Tabs Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-2 rounded-2xl glass-panel border border-white/10">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setActiveTab('remote')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'remote'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Tv className="w-4 h-4" />
              <span>Cinema Remote & Queue</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'settings'
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Headphones className="w-4 h-4" />
              <span>Voice Channels & Settings</span>
              {isStreamerTokenInvalid && (
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            {/* Active Quality & VC Quick Indicator */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                {defaultQuality}
              </span>
              <button
                onClick={() => setActiveTab('settings')}
                className="text-[11px] px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 border border-white/5 flex items-center gap-1.5 font-mono"
                title="Click to change Voice Channel or Default Quality"
              >
                <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                <span className="truncate max-w-[130px]">
                  {activeVoiceInfo.vcId ? `VC Active` : `Set VC`}
                </span>
              </button>
            </div>

            <button
              onClick={() => setIsRandomModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-semibold transition-all active:scale-95 shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Smart Marathon</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Remote & Queue & Explore View */}
        {activeTab === 'remote' && (
          <div className="space-y-8 animate-in fade-in duration-200">
            {/* Intermission Banner if in intermission mode */}
            {isIntermission && (
              <IntermissionBanner
                remainingSeconds={remainingIntermission}
                nextItemName={nextQueueItemName}
                onSkip={handleSkipIntermission}
              />
            )}

            {/* Top Split: Player Remote (60%) & Queue (40%) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 xl:col-span-8">
                <PlayerRemote
                  state={playerState}
                  onControl={handleControl}
                  loading={loading}
                />
              </div>

              <div className="lg:col-span-5 xl:col-span-4">
                <QueueView
                  items={queueItems}
                  onRemove={handleRemoveQueueItem}
                  onClear={handleClearQueue}
                  onReorder={handleReorderQueue}
                  onOpenSmartRandom={() => setIsRandomModalOpen(true)}
                  onAddCustomMovie={(item, q) => handleQueueMedia(item, q)}
                  onUpdateItemQuality={handleUpdateItemQuality}
                  onReplaceItem={handleReplaceQueueItem}
                  onPlayNow={(item, index) => handlePlayMedia(item, undefined, index)}
                  loading={loading}
                />
              </div>
            </div>

            {/* Explore & Search Catalog Section */}
            <ExploreView
              onPlay={(item) => handlePlayMedia(item)}
              onQueue={(item) => handleQueueMedia(item)}
              onSelectStreams={(item) => setSelectedStreamsMedia(item)}
              loading={loading}
            />
          </div>
        )}

        {/* Tab 2: Dedicated Voice Channels & Discord Settings View */}
        {activeTab === 'settings' && (
          <div className="animate-in fade-in duration-200">
            <VoiceSettingsPanel
              initialTokenHealth={tokenHealth}
              onVoiceChannelChanged={(gid, vcid) => {
                setActiveVoiceInfo({ guildId: gid, vcId: vcid });
                fetchState();
              }}
              onTokenUpdated={() => fetchState()}
              onSettingsSaved={(s) => {
                if (s?.defaultQuality) setDefaultQuality(s.defaultQuality);
                fetchState();
              }}
            />
          </div>
        )}
      </main>

      {/* TorBox Debrid Torrent Stream Selection Modal */}
      <StreamsModal
        isOpen={!!selectedStreamsMedia}
        onClose={() => setSelectedStreamsMedia(null)}
        media={selectedStreamsMedia}
        onPlayStream={handlePlayStream}
        onQueueStream={handleQueueStream}
        defaultQuality={defaultQuality}
      />

      {/* Smart Random Movie Modal ("Cinema Marathon Mode") */}
      <SmartRandomModal
        isOpen={isRandomModalOpen}
        onClose={() => setIsRandomModalOpen(false)}
        onSuccess={() => fetchState()}
      />

      {/* Modal Settings Fallback */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onVoiceChannelChanged={() => fetchState()}
      />
    </div>
  );
}
